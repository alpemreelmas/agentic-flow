import asyncio
import json
import os
import stat
import subprocess

import pytest
from langgraph.checkpoint.memory import MemorySaver

from looper import graph as graph_mod
from looper.acp_executor import RunResult
from looper.deliver import Delivery, GitHubDeliverer
from looper.registry import LocalRegistry


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A real bare 'origin', a clone on branch agent/t1, and a fake `gh` that records its calls."""
    for k in ("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"):
        monkeypatch.setenv(k, "t")
    for k in ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"):
        monkeypatch.setenv(k, "t@example.com")
    origin, work, bin_ = tmp_path / "origin.git", tmp_path / "work", tmp_path / "bin"
    git(tmp_path, "init", "-q", "--bare", "-b", "master", str(origin))
    git(tmp_path, "clone", "-q", str(origin), str(work))
    (work / "a.py").write_text("x = 1\n")
    git(work, "add", "-A")
    git(work, "commit", "-qm", "base")
    git(work, "push", "-q", "origin", "HEAD:master")
    git(work, "checkout", "-q", "-b", "agent/t1")

    bin_.mkdir()
    gh = bin_ / "gh"
    gh.write_text('#!/bin/sh\necho "$@" >> "$GH_LOG"\ncase "$1 $2" in\n'
                  '  "repo view") echo master ;;\n'
                  '  "pr list") [ -f "$GH_EXISTING" ] && cat "$GH_EXISTING" ;;\n'
                  '  "pr create") echo "Creating pull request..." >&2; echo https://github.com/o/r/pull/7 ;;\n'
                  'esac\nexit 0\n')  # like the real gh, an empty `pr list` still exits 0
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_}:{os.environ['PATH']}")
    monkeypatch.setenv("GH_LOG", str(tmp_path / "gh.log"))
    monkeypatch.setenv("GH_EXISTING", str(tmp_path / "existing"))

    class E:
        pass
    e = E()
    e.origin, e.work, e.log, e.existing = origin, work, tmp_path / "gh.log", tmp_path / "existing"
    e.gh_calls = lambda: e.log.read_text().splitlines() if e.log.exists() else []
    return e


def deliver(e, draft=False):
    return GitHubDeliverer().deliver(cwd=str(e.work), title="DEV-1 Fix add()", body="body", draft=draft)


def test_commits_pushes_and_opens_pr_without_build_noise(env):
    (env.work / "a.py").write_text("x = 2\n")
    (env.work / "__pycache__").mkdir()
    (env.work / "__pycache__" / "a.pyc").write_bytes(b"\x00bin")
    d = deliver(env)
    assert d.ok and d.url == "https://github.com/o/r/pull/7"
    assert "agent/t1" in git(env.work, "ls-remote", "--heads", str(env.origin))
    assert git(env.work, "ls-tree", "-r", "--name-only", "HEAD").split() == ["a.py"]
    create = [c for c in env.gh_calls() if c.startswith("pr create")][0]
    assert "--draft" not in create and "--base master" in create and "--head agent/t1" in create


def test_unverified_task_gets_a_draft_pr(env):
    (env.work / "a.py").write_text("x = 2\n")
    deliver(env, draft=True)
    assert "--draft" in [c for c in env.gh_calls() if c.startswith("pr create")][0]


def test_rerun_pushes_to_the_existing_pr_instead_of_opening_another(env):
    (env.work / "a.py").write_text("x = 2\n")
    deliver(env)
    env.existing.write_text("https://github.com/o/r/pull/7\n")  # the PR now exists
    (env.work / "a.py").write_text("x = 3\n")
    d = deliver(env)
    assert d.ok and d.url.endswith("/pull/7") and "existing PR" in d.note
    assert len([c for c in env.gh_calls() if c.startswith("pr create")]) == 1
    assert git(env.work, "rev-list", "--count", "origin/master..origin/agent/t1") == "2"


def test_nothing_changed_means_nothing_delivered(env):
    d = deliver(env)
    assert d.ok and d.url is None and "nothing to deliver" in d.note
    assert "agent/t1" not in git(env.work, "ls-remote", "--heads", str(env.origin))


def test_refuses_to_commit_onto_master_and_ignores_non_git_dirs(env, tmp_path):
    git(env.work, "checkout", "-q", "master")
    (env.work / "a.py").write_text("x = 9\n")
    d = deliver(env)
    assert not d.ok and "refusing" in d.note
    plain = tmp_path / "plain"
    plain.mkdir()
    assert GitHubDeliverer().deliver(cwd=str(plain), title="t", body="b", draft=False).ok


def test_push_failure_is_reported_not_raised(env):
    (env.work / "a.py").write_text("x = 2\n")
    git(env.work, "remote", "set-url", "origin", str(env.origin) + "-gone")
    d = deliver(env)
    assert not d.ok and "failed" in d.note


# ---- inside the graph -------------------------------------------------------------------------

class Src:
    def __init__(self): self.calls = []
    def mark_in_progress(self, tid): pass
    def finish(self, tid, status, comment): self.calls.append((status, comment))


class FakeDeliverer:
    def __init__(self, result): self.result, self.seen = result, None
    def deliver(self, **kw):
        self.seen = kw
        return self.result


def run_graph(tmp_path, monkeypatch, deliverer, verified=True):
    async def fake(agent, cwd, prompt, **kw):
        (tmp_path / "ok").write_text("x")
        return RunResult("made the change", "end_turn")

    monkeypatch.setattr(graph_mod, "run_prompt", fake)
    src = Src()
    g = graph_mod.build_graph(src, LocalRegistry("registry"), runs_dir=tmp_path / "runs", agent_override=None,
                              max_attempts=3, timeout=5, ask_permissions=False, quiet=True,
                              checkpointer=MemorySaver(), deliverer=deliverer)
    asyncio.run(g.ainvoke({"task_id": "t1", "title": "DEV-1 Fix add()", "description": "Fix it.",
                           "verify_cmd": "test -f ok", "verified": verified, "cwd": str(tmp_path)},
                          {"configurable": {"thread_id": "t1"}}))
    events = [json.loads(l) for f in (tmp_path / "runs").glob("*.jsonl") for l in f.read_text().splitlines()]
    return src, events


def test_pr_url_goes_to_the_linear_comment_and_the_run_log(tmp_path, monkeypatch):
    d = FakeDeliverer(Delivery(url="https://github.com/o/r/pull/7", note="opened a PR"))
    src, events = run_graph(tmp_path, monkeypatch, d)
    status, comment = src.calls[-1]
    assert status == "review" and "PR: https://github.com/o/r/pull/7" in comment
    assert d.seen["draft"] is False and d.seen["title"] == "DEV-1 Fix add()"
    assert "`test -f ok` passed" in d.seen["body"] and "made the change" in d.seen["body"]
    assert [e for e in events if e["type"] == "deliver"][0]["url"].endswith("/pull/7")


def test_unverified_task_is_marked_everywhere(tmp_path, monkeypatch):
    d = FakeDeliverer(Delivery(url="https://github.com/o/r/pull/8"))
    src, _ = run_graph(tmp_path, monkeypatch, d, verified=False)
    assert d.seen["draft"] is True and d.seen["title"] == "[UNVERIFIED] DEV-1 Fix add()"
    assert "UNVERIFIED" in d.seen["body"]
    assert "UNVERIFIED" in src.calls[-1][1]


def test_failed_delivery_needs_a_human_and_says_where_the_work_is(tmp_path, monkeypatch):
    src, events = run_graph(tmp_path, monkeypatch, FakeDeliverer(Delivery(ok=False, note="push failed: denied")))
    status, comment = src.calls[-1]
    assert status == "needs_human" and "delivery failed" in comment and "push failed: denied" in comment
    assert str(tmp_path) in comment
    assert events[-1]["type"] == "run_end" and events[-1]["status"] == "needs_human"


def test_no_deliverer_configured_behaves_as_before(tmp_path, monkeypatch):
    src, events = run_graph(tmp_path, monkeypatch, None)
    assert src.calls[-1][0] == "review" and not any(e["type"] == "deliver" for e in events)
