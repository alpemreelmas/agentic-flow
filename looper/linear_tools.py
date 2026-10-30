"""Workspace-scoped service tools; no arbitrary GraphQL is accepted from agents."""
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid

from .issue_lock import issue_lock
from .linear_client import LinearClient, LinearError

FIELDS = """id identifier title description url updatedAt archivedAt priority
    project { id } team { id } state { id name } labels { nodes { id name } }"""
STRING = {"type": "string", "minLength": 1, "maxLength": 100000}


def _tool(name, description, properties=None, required=(), write=False):
    return {"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties or {},
                            "required": list(required), "additionalProperties": False},
            "annotations": {"readOnlyHint": not write, "destructiveHint": write, "openWorldHint": True}}


TOOLS = [
    _tool("linear_get_metadata", "Get this workspace's project teams, workflow states and label IDs."),
    _tool("linear_search_issues", "List/search issues in this project, including drafts without the agent label. Use get for identifiers.",
          {"query": STRING, "cursor": STRING}),
    _tool("linear_get_issue", "Read an issue by UUID or identifier; returns updatedAt for subsequent edits.",
          {"issue_id": STRING}, ["issue_id"]),
    _tool("linear_create_issue", "Create a draft, not an autonomous job. Reuse request_id on retry; never change it after an uncertain result.",
          {"request_id": STRING, "title": STRING, "description": {"type": "string", "maxLength": 100000},
           "team_id": STRING}, ["request_id", "title"], True),
    _tool("linear_update_issue", "Edit a task after reading it. Cannot edit a running task or submit it to the loop.",
          {"issue_id": STRING, "expected_updated_at": STRING, "title": STRING,
           "description": {"type": "string", "maxLength": 100000},
           "label_ids": {"type": "array", "items": STRING, "maxItems": 100},
           "priority": {"type": "integer", "minimum": 0, "maximum": 4}},
          ["issue_id", "expected_updated_at"], True),
    _tool("linear_submit_issue", "ONLY after the user requests autonomous handoff: apply the configured ready state and agent label. Does not start the daemon.",
          {"issue_id": STRING, "expected_updated_at": STRING}, ["issue_id", "expected_updated_at"], True),
]
TOOL_MAP = {t["name"]: t for t in TOOLS}


def validate_call(name, args):
    if name not in TOOL_MAP or not isinstance(args, dict):
        raise ValueError("Unknown tool or invalid arguments")
    schema = TOOL_MAP[name]["inputSchema"]
    if set(args) - set(schema["properties"]) or set(schema["required"]) - set(args):
        raise ValueError("Unexpected or missing tool arguments")
    for key, value in args.items():
        spec = schema["properties"][key]
        kind = spec["type"]
        if kind == "string" and (not isinstance(value, str) or len(value) > spec.get("maxLength", 100000)
                                 or len(value.strip()) < spec.get("minLength", 0)):
            raise ValueError(f"Invalid {key}")
        if kind == "integer" and (type(value) is not int or not spec["minimum"] <= value <= spec["maximum"]):
            raise ValueError(f"Invalid {key}")
        if kind == "array" and (not isinstance(value, list) or len(value) > spec["maxItems"]
                                or any(not isinstance(v, str) or not v or len(v) > 256 for v in value)):
            raise ValueError(f"Invalid {key}")


class LinearTools:
    def __init__(self, key, scope, state_dir, config_path=None):
        self.key = key
        self.scope = scope
        self.state_dir = Path(state_dir)
        self.config_path = Path(config_path) if config_path else None

    def check_scope(self):
        if not self.key:
            raise ValueError("Connect Linear in Settings, then retry")
        if not self.scope.get("project_id") or not self.scope.get("enabled"):
            raise ValueError("Enable this workspace and select its Linear project in Settings, then reopen the chat")
        if self.config_path:
            config = json.loads(self.config_path.read_text())
            workspace = next((w for w in config.get("workspaces", []) if w.get("id") == self.scope["id"]), None)
            if not workspace or not workspace.get("enabled") or any(
                    workspace.get(k) != self.scope.get(k) for k in ("repo", "project_id")):
                raise ValueError("Workspace changed or was disabled; reopen this chat")
            for key in ("ready", "progress", "blocked", "label"):
                if config.get(key, self.scope[key]) != self.scope[key]:
                    raise ValueError("Loop configuration changed; reopen this chat")
        if self.scope["blocked"] in (self.scope["ready"], self.scope["progress"]):
            raise ValueError("Draft state must differ from the loop's polled states")

    def gql(self, query, variables=None):
        return LinearClient(self.key).gql(query, variables)

    def call(self, name, args):
        validate_call(name, args)
        self.check_scope()
        return getattr(self, name.removeprefix("linear_"))(**args)

    def _connection(self, query, variables, field):
        nodes, after = [], None
        while True:
            page = self.gql(query, {**variables, "after": after})
            for part in field.split("."):
                page = page[part]
            nodes.extend(page["nodes"])
            if not page["pageInfo"]["hasNextPage"]:
                return nodes
            cursor = page["pageInfo"]["endCursor"]
            if not cursor or cursor == after:
                raise LinearError("Linear pagination did not advance")
            after = cursor

    def get_metadata(self):
        project = self.gql("query($id:String!){project(id:$id){id name}}",
                           {"id": self.scope["project_id"]})["project"]
        if not project:
            raise ValueError("Configured Linear project is unavailable")
        teams = self._connection("""query($id:String!,$after:String){project(id:$id){teams(first:100,after:$after){
            nodes{id name} pageInfo{hasNextPage endCursor}}}}""", {"id": self.scope["project_id"]}, "project.teams")
        labels = self._connection("""query($after:String){issueLabels(first:100,after:$after){
            nodes{id name team{id}} pageInfo{hasNextPage endCursor}}}""", {}, "issueLabels")
        for team in teams:
            team["states"] = self._connection("""query($team:ID!,$after:String){workflowStates(first:100,after:$after,
                filter:{team:{id:{eq:$team}}}){nodes{id name} pageInfo{hasNextPage endCursor}}}""",
                {"team": team["id"]}, "workflowStates")
            team["labels"] = [l for l in labels if not l.get("team") or l["team"]["id"] == team["id"]]
        return {"project": {"id": project["id"], "name": project["name"]}, "teams": teams,
                "draft_state": self.scope["blocked"], "ready_state": self.scope["ready"], "loop_label": self.scope["label"]}

    def _team(self, team_id=None):
        teams = self.get_metadata()["teams"]
        if team_id is None and len(teams) == 1:
            return teams[0]
        team = next((t for t in teams if t["id"] == team_id), None)
        if team is None:
            raise ValueError("Select a team from linear_get_metadata; this project may have multiple teams")
        return team

    @staticmethod
    def _state(team, name):
        states = [s for s in team["states"] if s["name"] == name]
        if len(states) != 1:
            raise ValueError(f"Team must have exactly one workflow state named {name!r}")
        return states[0]["id"]

    def _present(self, issue):
        out = dict(issue)
        out["queue_eligible"] = (not issue.get("archivedAt") and issue["state"]["name"] in (self.scope["ready"], self.scope["progress"])
                                 and any(l["name"] == self.scope["label"] for l in issue["labels"]["nodes"]))
        return out

    def get_issue(self, issue_id):
        issue = self.gql(f"query($id:String!){{issue(id:$id){{{FIELDS}}}}}", {"id": issue_id})["issue"]
        if not issue or (issue.get("project") or {}).get("id") != self.scope["project_id"]:
            raise ValueError("Issue is unavailable in this workspace's project")
        return self._present(issue)

    def search_issues(self, query=None, cursor=None):
        filters = {"project": {"id": {"eq": self.scope["project_id"]}}}
        if query:
            filters["title"] = {"containsIgnoreCase": query}
        result = self.gql(f"""query($filter:IssueFilter!,$after:String){{issues(first:50,after:$after,
            filter:$filter){{nodes{{{FIELDS}}} pageInfo{{hasNextPage endCursor}}}}}}""",
            {"filter": filters, "after": cursor})["issues"]
        return {"issues": [self._present(i) for i in result["nodes"]], "pageInfo": result["pageInfo"]}

    def create_issue(self, request_id, title, description="", team_id=None):
        team = self._team(team_id)
        payload = {"title": title, "description": description, "teamId": team["id"],
                   "projectId": self.scope["project_id"], "stateId": self._state(team, self.scope["blocked"]), "labelIds": []}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        self.state_dir.mkdir(parents=True, exist_ok=True)
        # Record the UUID before the network call. A failed/uncertain request is never sent again.
        with issue_lock(self.state_dir, "create:" + self.scope["project_id"] + ":" + request_id):
            with sqlite3.connect(self.state_dir / "bridge-mutations.sqlite") as db:
                db.execute("CREATE TABLE IF NOT EXISTS creates (project TEXT, request TEXT, digest TEXT, issue TEXT, PRIMARY KEY(project, request))")
                row = db.execute("SELECT digest, issue FROM creates WHERE project=? AND request=?",
                                 (self.scope["project_id"], request_id)).fetchone()
                if row:
                    if row[0] != digest:
                        raise ValueError("request_id already used with different task content")
                    try:
                        return self.get_issue(row[1])
                    except (LinearError, ValueError):
                        raise ValueError("Previous create outcome is uncertain; check Linear for issue UUID " + row[1]
                                         + ". Do not retry with a new request_id") from None
                issue_id = str(uuid.uuid4())
                db.execute("INSERT INTO creates VALUES (?,?,?,?)", (self.scope["project_id"], request_id, digest, issue_id))
            try:
                result = self.gql("mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{" + FIELDS + "}}}",
                                  {"input": {**payload, "id": issue_id}})["issueCreate"]
                if not result["success"] or not result.get("issue"):
                    raise LinearError("Linear did not confirm task creation")
                return self._present(result["issue"])
            except LinearError:
                try:
                    return self.get_issue(issue_id)
                except (LinearError, ValueError):
                    raise ValueError("Create outcome is uncertain; check Linear for issue UUID " + issue_id
                                     + ". Reuse the same request_id to reconcile; do not create another task") from None

    def _editable(self, issue, expected_updated_at):
        if issue.get("archivedAt") or issue["state"]["name"] == self.scope["progress"]:
            raise ValueError("Archived or in-progress tasks cannot be edited from chat")
        if issue["updatedAt"] != expected_updated_at:
            raise ValueError("Issue changed since it was read; read it again before editing")

    def _update(self, issue_id, payload):
        try:
            result = self.gql("mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{" + FIELDS + "}}}",
                              {"id": issue_id, "input": payload})["issueUpdate"]
            if not result["success"]:
                raise LinearError("Linear did not confirm task update")
            return self._present(result["issue"])
        except LinearError:
            actual = self.get_issue(issue_id)
            matches = all(actual.get(k) == v for k, v in payload.items() if k not in ("stateId", "labelIds"))
            matches &= "stateId" not in payload or actual["state"]["id"] == payload["stateId"]
            matches &= "labelIds" not in payload or set(payload["labelIds"]) == {l["id"] for l in actual["labels"]["nodes"]}
            if matches:
                return actual
            raise ValueError("Update outcome is uncertain; read the issue before retrying") from None

    def update_issue(self, issue_id, expected_updated_at, **changes):
        original = self.get_issue(issue_id)
        with issue_lock(self.state_dir, original["id"]):
            issue = self.get_issue(original["id"])
            self._editable(issue, expected_updated_at)
            if not changes:
                raise ValueError("Provide at least one field to update")
            if "label_ids" in changes:
                team = self._team(issue["team"]["id"])
                labels = {l["id"]: l["name"] for l in team["labels"]}
                ids = changes.pop("label_ids")
                if any(i not in labels for i in ids):
                    raise ValueError("Select label IDs from this team's metadata")
                if issue["state"]["name"] in (self.scope["ready"], self.scope["progress"]) and self.scope["label"] in [labels[i] for i in ids]:
                    raise ValueError("Use linear_submit_issue to hand work to the loop")
                changes["labelIds"] = ids
            return self._update(issue["id"], changes)

    def submit_issue(self, issue_id, expected_updated_at):
        original = self.get_issue(issue_id)
        with issue_lock(self.state_dir, original["id"]):
            issue = self.get_issue(original["id"])
            if issue["queue_eligible"] and issue["state"]["name"] == self.scope["ready"]:
                return issue
            self._editable(issue, expected_updated_at)
            team = self._team(issue["team"]["id"])
            labels = [l for l in team["labels"] if l["name"] == self.scope["label"]]
            if len(labels) != 1:
                raise ValueError("Team must have exactly one accessible loop label named " + self.scope["label"])
            return self._update(issue["id"], {"stateId": self._state(team, self.scope["ready"]),
                                "labelIds": list(dict.fromkeys([l["id"] for l in issue["labels"]["nodes"]] + [labels[0]["id"]]))})
