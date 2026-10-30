import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import httpx
import pytest

from looper.bridge import Broker, clean_agent_env, mcp_server, proxy_request
from looper.issue_lock import IssueBusy, issue_lock
from looper.linear_client import LinearError
from looper.linear_tools import LinearTools, TOOLS


SCOPE = {"id": "ws", "project_id": "project", "repo": "/repo", "enabled": True,
         "ready": "Todo", "progress": "In Progress", "blocked": "Backlog", "label": "agent"}


class FakeTools(LinearTools):
    def __init__(self, state_dir):
        super().__init__("test-secret", dict(SCOPE), state_dir)
        self.issues = {}
        self.calls = []
        self.lose_create = False
        self.fail_create = False
        self.lose_update = False
        self.teams = [{"id": "team", "name": "Team", "states": [
            {"id": "s-" + name, "name": name} for name in ("Todo", "Backlog", "In Progress", "In Review")],
            "labels": [{"id": "l-agent", "name": "agent"}, {"id": "l-bug", "name": "bug"}]}]

    def get_metadata(self):
        return {"teams": deepcopy(self.teams)}

    def gql(self, query, variables=None):
        self.calls.append((query, deepcopy(variables)))
        if "issueCreate" in query:
            if self.fail_create:
                raise LinearError("timeout")
            p = variables["input"]
            issue = {"id": p["id"], "identifier": "ENG-1", "title": p["title"], "description": p["description"],
                     "project": {"id": p["projectId"]}, "team": {"id": p["teamId"]},
                     "state": {"id": p["stateId"], "name": p["stateId"][2:]}, "labels": {"nodes": []},
                     "updatedAt": "v1", "url": "https://linear.app/test/ENG-1", "priority": 0, "archivedAt": None}
            self.issues[issue["id"]] = issue
            if self.lose_create:
                raise LinearError("timeout after commit")
            return {"issueCreate": {"success": True, "issue": deepcopy(issue)}}
        if "issueUpdate" in query:
            issue = self.issues[variables["id"]]
            for key, value in variables["input"].items():
                if key == "stateId":
                    issue["state"] = {"id": value, "name": value[2:]}
                elif key == "labelIds":
                    issue["labels"]["nodes"] = [deepcopy(l) for l in self.teams[0]["labels"] if l["id"] in value]
                else:
                    issue[key] = value
            issue["updatedAt"] += "!"
            if self.lose_update:
                raise LinearError("timeout after commit")
            return {"issueUpdate": {"success": True, "issue": deepcopy(issue)}}
        if "issues(" in query:
            return {"issues": {"nodes": deepcopy(list(self.issues.values())), "pageInfo": {"hasNextPage": False, "endCursor": None}}}
        if "issue(id:" in query:
            issue = self.issues.get(variables["id"]) or next((i for i in self.issues.values() if i["identifier"] == variables["id"]), None)
            return {"issue": deepcopy(issue)}
        raise AssertionError(query)


@pytest.fixture
def tools(tmp_path):
    return FakeTools(tmp_path)


def draft(tools):
    return tools.call("linear_create_issue", {"request_id": "task-1", "title": "My task"})


def test_draft_edit_submit_and_idempotent_handoff(tools):
    issue = draft(tools)
    assert issue["state"]["name"] == "Backlog" and not issue["queue_eligible"]
    issue = tools.call("linear_update_issue", {"issue_id": issue["identifier"], "expected_updated_at": issue["updatedAt"],
                                             "description": "Acceptance criteria", "label_ids": ["l-bug"]})
    assert issue["description"] == "Acceptance criteria" and not issue["queue_eligible"]
    issue = tools.call("linear_submit_issue", {"issue_id": issue["id"], "expected_updated_at": issue["updatedAt"]})
    assert issue["queue_eligible"] and issue["state"]["name"] == "Todo"
    assert {l["name"] for l in issue["labels"]["nodes"]} == {"bug", "agent"}
    count = len([q for q, _ in tools.calls if "issueUpdate" in q])
    assert tools.call("linear_submit_issue", {"issue_id": issue["id"], "expected_updated_at": "old"}) == issue
    assert len([q for q, _ in tools.calls if "issueUpdate" in q]) == count


def test_foreign_issue_and_missing_scope_are_rejected(tools):
    issue = draft(tools)
    tools.issues[issue["id"]]["project"]["id"] = "foreign"
    for tool in ("linear_get_issue", "linear_update_issue", "linear_submit_issue"):
        args = {"issue_id": issue["id"]}
        if tool != "linear_get_issue":
            args["expected_updated_at"] = "v1"
        with pytest.raises(ValueError, match="unavailable"):
            tools.call(tool, args)
    tools.scope["project_id"] = ""
    with pytest.raises(ValueError, match="select its Linear project"):
        tools.call("linear_get_metadata", {})


def test_running_archived_and_stale_tasks_cannot_be_changed(tools):
    issue = draft(tools)
    for change, expected in [({"updatedAt": "v2"}, "changed"),
                              ({"state": {"id": "s-In Progress", "name": "In Progress"}}, "in-progress"),
                              ({"archivedAt": "today"}, "Archived")]:
        tools.issues[issue["id"]] = {**issue, **change}
        with pytest.raises(ValueError, match=expected):
            tools.call("linear_update_issue", {"issue_id": issue["id"], "expected_updated_at": "v1", "title": "new"})
    assert not any("issueUpdate" in q for q, _ in tools.calls)


def test_no_generic_submit_or_arbitrary_graphql(tools):
    issue = draft(tools)
    tools.issues[issue["id"]]["state"] = {"name": "Todo", "id": "s-Todo"}
    with pytest.raises(ValueError, match="linear_submit_issue"):
        tools.call("linear_update_issue", {"issue_id": issue["id"], "expected_updated_at": "v1", "label_ids": ["l-agent"]})
    for name, args in [("graphql", {}), ("linear_create_issue", {"request_id": "x", "title": "x", "state_id": "ready"}),
                       ("linear_update_issue", {"issue_id": "x", "expected_updated_at": "v1", "priority": True})]:
        with pytest.raises(ValueError):
            tools.call(name, args)


def test_explicit_team_required_for_multi_team_project(tools):
    tools.teams.append({**tools.teams[0], "id": "another"})
    with pytest.raises(ValueError, match="Select a team"):
        draft(tools)
    assert tools.call("linear_create_issue", {"request_id": "x", "title": "x", "team_id": "team"})["team"]["id"] == "team"


def test_missing_state_or_ambiguous_label_does_not_mutate(tools):
    tools.teams[0]["states"] = [s for s in tools.teams[0]["states"] if s["name"] != "Backlog"]
    with pytest.raises(ValueError, match="workflow state"):
        draft(tools)
    assert not tools.issues


@pytest.mark.parametrize("lost", [False, True])
def test_create_retries_reconcile_without_a_second_mutation(tools, lost):
    tools.lose_create = lost
    issue = draft(tools)
    assert draft(tools)["id"] == issue["id"]
    assert len([q for q, _ in tools.calls if "issueCreate" in q]) == 1
    with pytest.raises(ValueError, match="different task content"):
        tools.call("linear_create_issue", {"request_id": "task-1", "title": "changed"})


def test_unknown_create_outcome_is_never_blindly_retried(tools):
    tools.fail_create = True
    for _ in range(2):
        with pytest.raises(ValueError, match="uncertain"):
            draft(tools)
    assert len([q for q, _ in tools.calls if "issueCreate" in q]) == 1


def test_lost_update_response_reads_actual_result(tools):
    issue = draft(tools)
    tools.lose_update = True
    out = tools.call("linear_update_issue", {"issue_id": issue["id"], "expected_updated_at": "v1", "title": "Updated"})
    assert out["title"] == "Updated"
    assert len([q for q, _ in tools.calls if "issueUpdate" in q]) == 1


def test_issue_lock_blocks_chat_while_loop_holds_it(tools):
    issue = draft(tools)
    with issue_lock(tools.state_dir, issue["id"]):
        with pytest.raises(IssueBusy):
            tools.call("linear_update_issue", {"issue_id": issue["id"], "expected_updated_at": "v1", "title": "New"})
    assert not any("issueUpdate" in q for q, _ in tools.calls)


def test_workspace_disabled_or_reconfigured_revokes_scope(tools, tmp_path):
    tools.config_path = tmp_path / "config.json"
    config = {"workspaces": [dict(SCOPE)]}
    tools.config_path.write_text(json.dumps(config))
    tools.check_scope()
    config["workspaces"][0]["enabled"] = False
    tools.config_path.write_text(json.dumps(config))
    with pytest.raises(ValueError, match="disabled"):
        tools.check_scope()


def test_env_and_mcp_descriptor_contain_no_application_credentials(monkeypatch):
    for name in ("LINEAR_API_KEY", "GH_TOKEN", "GITHUB_TOKEN", "LOOPER_BRIDGE_DESCRIPTOR"):
        monkeypatch.setenv(name, "secret")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "provider-login")
    env = clean_agent_env()
    assert "LINEAR_API_KEY" not in env and "GH_TOKEN" not in env and "LOOPER_BRIDGE_DESCRIPTOR" not in env
    assert env["ANTHROPIC_API_KEY"] == "provider-login"
    server = mcp_server({"name": "looper_linear_test", "url": "http://127.0.0.1:1/tools", "token": "session-cap"})
    assert Path(server.command).is_absolute()
    assert "session-cap" not in str(server.args)
    assert "secret" not in server.model_dump_json()


def test_broker_auth_scope_events_and_revocation(tools):
    events = []
    broker = Broker(tools, events.append)
    descriptor = broker.start()
    try:
        assert len(proxy_request(descriptor, "tools/list")["tools"]) == len(TOOLS)
        response = proxy_request(descriptor, "tools/call", name="linear_create_issue", arguments={"request_id": "r", "title": "Draft"})
        assert not response["isError"]
        assert any(e["type"] == "linear_changed" for e in events)
        assert "test-secret" not in json.dumps(events)
        assert proxy_request({**descriptor, "token": "wrong"}, "tools/list")["isError"]
        assert proxy_request(descriptor, "tools/call", name="graphql", arguments={})["isError"]
        tools.key = None
        assert proxy_request(descriptor, "tools/call", name="linear_get_metadata", arguments={})["isError"]
    finally:
        broker.close()
    assert proxy_request(descriptor, "tools/list")["isError"]


def test_mcp_proxy_protocol_from_unrelated_cwd(tools, tmp_path):
    broker = Broker(tools)
    descriptor = broker.start()
    try:
        server = mcp_server(descriptor)
        env = {**clean_agent_env(), **{e.name: e.value for e in server.env}}
        requests = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}},
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
                        "name": "linear_create_issue", "arguments": {"request_id": "stdio", "title": "From MCP"}}}]
        out = subprocess.run([server.command, *server.args], input="\n".join(map(json.dumps, requests)) + "\n",
                             capture_output=True, text=True, env=env, cwd=tmp_path, timeout=15)
        assert out.returncode == 0, out.stderr
        responses = [json.loads(line) for line in out.stdout.splitlines()]
        assert [r["id"] for r in responses] == [1, 2, 3]
        assert responses[0]["result"]["protocolVersion"] == "2024-11-05"
        assert len(responses[1]["result"]["tools"]) == len(TOOLS)
        assert not responses[2]["result"]["isError"]
        assert len(tools.issues) == 1
    finally:
        broker.close()


def test_permission_only_allows_exact_bridge_identity():
    from looper.acp_executor import _Client
    client = _Client(True, True, policy="readonly")
    client.bridge_server, client.bridge_adapter = "looper_linear_test", "claude"
    options = [SimpleNamespace(kind="allow_once", option_id="yes")]
    def ask(meta, title="Bash"):
        call = SimpleNamespace(kind="other", title=title, field_meta=meta)
        return asyncio.run(client.request_permission("s", call, options)).outcome.outcome
    assert ask({"claudeCode": {"toolName": "mcp__looper_linear_test__linear_create_issue"}}) == "selected"
    assert ask({}, "mcp__looper_linear_test__linear_create_issue") == "cancelled"
    assert ask({"claudeCode": {"toolName": "mcp__other__linear_create_issue"}}) == "cancelled"
    assert ask({"claudeCode": {"toolName": "Bash"}}) == "cancelled"


def test_chat_injects_bridge_without_leaking_env_and_preserves_skills(monkeypatch, tmp_path):
    from looper import chat
    captured, events = {}, []
    descriptor = {"name": "looper_linear_test", "url": "http://127.0.0.1:1/tools", "token": "cap"}
    monkeypatch.setenv("LOOPER_BRIDGE_DESCRIPTOR", json.dumps(descriptor))
    monkeypatch.setenv("LINEAR_API_KEY", "should-not-leak")
    class Connection:
        async def initialize(self, **kwargs):
            import acp
            return SimpleNamespace(protocol_version=acp.PROTOCOL_VERSION, agent_info=None)
        async def new_session(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(session_id="s", modes=None, config_options=[])
    @asynccontextmanager
    async def spawn(client, *args, **kwargs):
        assert "LINEAR_API_KEY" not in kwargs["env"] and "LOOPER_BRIDGE_DESCRIPTOR" not in kwargs["env"]
        assert client.bridge_server == descriptor["name"]
        yield Connection(), None
    async def lines():
        if False:
            yield ""
    monkeypatch.setattr(chat.acp, "spawn_agent_process", spawn)
    monkeypatch.setattr(chat, "_stdin_lines", lines)
    monkeypatch.setattr(chat, "_emit", events.append)
    asyncio.run(chat.run_chat("claude", str(tmp_path), skills=["product-owner"]))
    assert captured["mcp_servers"][0].name == descriptor["name"]
    assert next(e for e in events if e["type"] == "ready")["default_skills"] == ["product-owner"]


def test_broker_process_key_removal_and_parent_eof(tmp_path):
    entry = Path(__file__).resolve().parents[1] / "scripts" / "entry.py"
    process = subprocess.Popen([sys.executable, str(entry), "--bridge-broker"], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=tmp_path,
                               env=clean_agent_env())
    try:
        process.stdin.write(json.dumps({"key": "private-key", "scope": SCOPE, "state_dir": str(tmp_path)}) + "\n")
        process.stdin.flush()
        descriptor = json.loads(process.stdout.readline())
        assert descriptor["type"] == "bridge_ready" and "private-key" not in json.dumps(descriptor)
        assert proxy_request(descriptor, "tools/list")["tools"]
        process.stdin.write(json.dumps({"type": "key", "key": None}) + "\n")
        process.stdin.flush()
        assert not json.loads(process.stdout.readline())["available"]
        assert proxy_request(descriptor, "tools/list")["isError"]
        process.stdin.close()
        assert process.wait(timeout=10) == 0, process.stderr.read()
        assert proxy_request(descriptor, "tools/list")["isError"]
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_issue_lock_is_shared_across_processes(tmp_path):
    with issue_lock(tmp_path, "shared-issue"):
        result = subprocess.run([sys.executable, "-c", """
import sys
from looper.issue_lock import issue_lock, IssueBusy
try:
    with issue_lock(sys.argv[1], 'shared-issue'): pass
except IssueBusy:
    sys.exit(7)
""", str(tmp_path)], capture_output=True, text=True, timeout=10)
        assert result.returncode == 7, result.stderr


def test_metadata_paginates_and_does_not_expose_other_teams_labels(tmp_path):
    tools = LinearTools("key", SCOPE, tmp_path)
    calls = []
    def gql(query, variables):
        calls.append((query, variables))
        if "teams(" in query:
            return {"project": {"teams": {"nodes": [{"id": "team", "name": "Team"}],
                                          "pageInfo": {"hasNextPage": False}}}}
        if "project(id:" in query:
            return {"project": {"id": "project", "name": "Project"}}
        if "issueLabels" in query:
            if variables["after"] is None:
                return {"issueLabels": {"nodes": [{"id": "foreign", "name": "Private", "team": {"id": "other"}}],
                                        "pageInfo": {"hasNextPage": True, "endCursor": "next"}}}
            return {"issueLabels": {"nodes": [{"id": "global", "name": "Global", "team": None}],
                                    "pageInfo": {"hasNextPage": False}}}
        if "workflowStates" in query:
            return {"workflowStates": {"nodes": [{"id": "state", "name": "Todo"}],
                                       "pageInfo": {"hasNextPage": False}}}
        raise AssertionError(query)
    tools.gql = gql
    metadata = tools.call("linear_get_metadata", {})
    assert [l["id"] for l in metadata["teams"][0]["labels"]] == ["global"]
    assert any(v.get("after") == "next" for _, v in calls)
