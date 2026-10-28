import pytest

from looper import sources
from looper.sources import LinearSource


class FakeLinear:
    """Stands in for httpx.post; routes on the GraphQL operation and records every call."""

    def __init__(self, issues=(), states=("Todo", "In Progress", "In Review", "Backlog"), errors=None):
        self.issues, self.states, self.errors, self.calls = list(issues), list(states), errors, []

    def post(self, url, json, headers, timeout):
        self.calls.append(json)
        q, v = json["query"], json["variables"]
        if self.errors:
            data = {"errors": self.errors}
        elif "issues(" in q:
            data = {"data": {"issues": {"nodes": self.issues}}}
        elif "workflowStates" in q:
            nodes = [{"id": f"sid-{v['n']}"}] if v["n"] in self.states else []
            data = {"data": {"workflowStates": {"nodes": nodes}}}
        elif "viewer" in q:
            data = {"data": {"viewer": {"name": "Alp"}, "teams": {"nodes": [
                {"name": "Eng", "states": {"nodes": [{"name": s} for s in self.states]}}]}}}
        else:
            data = {"data": {"ok": {"success": True}}}
        return type("R", (), {"raise_for_status": lambda s: None, "json": lambda s: data})()


def issue(id, labels, desc="", n=1):
    return {"id": id, "identifier": f"ENG-{n}", "title": f"t{id}", "description": desc,
            "team": {"id": "team1"}, "labels": {"nodes": [{"name": l} for l in labels]}}


@pytest.fixture
def linear(monkeypatch):
    monkeypatch.setenv("LINEAR_API_KEY", "lin_api_test")

    def make(fake, **kw):
        monkeypatch.setattr(sources.httpx, "post", fake.post)
        return LinearSource(**kw)
    return make


def test_fetch_filters_label_and_reads_role_and_verify_block(linear):
    fake = FakeLinear(issues=[
        issue("a", ["agent", "role:reviewer"], "Check it\n```verify\npytest -q\n```", 1),
        issue("b", ["bug"], "no agent label", 2),
        issue("c", ["agent"], "plain", 3),
    ])
    tasks = linear(fake).fetch_ready()
    assert [t["id"] for t in tasks] == ["a", "c"]
    assert tasks[0]["role"] == "reviewer" and tasks[0]["verify"] == "pytest -q"
    assert "role" not in tasks[1] and tasks[1]["verify"] == "true"
    assert fake.calls[0]["variables"] == {"states": ["Todo", "In Progress"]}
    assert tasks[0]["title"] == "ENG-1 ta"


def test_finish_comments_then_moves_to_review_state(linear):
    fake = FakeLinear(issues=[issue("a", ["agent"])])
    src = linear(fake)
    src.fetch_ready()
    src.finish("a", "review", "all good")
    after_fetch = fake.calls[1:]
    assert ["commentCreate" in c["query"] for c in after_fetch] == [True, False, False]
    assert ["workflowStates" in c["query"] for c in after_fetch] == [False, True, False]
    assert ["issueUpdate" in c["query"] for c in after_fetch] == [False, False, True]
    assert fake.calls[1]["variables"] == {"i": "a", "b": "all good"}
    assert fake.calls[2]["variables"] == {"t": "team1", "n": "In Review"}
    assert fake.calls[3]["variables"] == {"i": "a", "s": "sid-In Review"}


def test_gave_up_task_goes_to_a_state_the_loop_does_not_poll(linear):
    fake = FakeLinear(issues=[issue("a", ["agent"])])
    src = linear(fake)
    src.fetch_ready()
    src.finish("a", "needs_human", "stuck")
    assert fake.calls[-1]["variables"]["s"] == "sid-Backlog"
    with pytest.raises(ValueError, match="polled"):
        linear(fake, blocked="Todo")


def test_graphql_errors_and_missing_states_are_loud(linear):
    with pytest.raises(RuntimeError, match="boom"):
        linear(FakeLinear(errors=[{"message": "boom"}])).fetch_ready()
    fake = FakeLinear(issues=[issue("a", ["agent"])], states=("Todo",))
    src = linear(fake)
    src.fetch_ready()
    with pytest.raises(RuntimeError, match="In Review"):
        src.finish("a", "review", "x")


def test_diagnose_reports_missing_states(linear):
    out = linear(FakeLinear(states=("Todo", "In Progress"))).diagnose()
    assert "signed in as Alp" in out and "'In Review' does not exist" in out and "'Backlog' does not exist" in out


def test_issue_without_a_verify_block_is_marked_unverified(linear):
    fake = FakeLinear(issues=[issue("a", ["agent"], "```verify\npytest\n```", 1), issue("b", ["agent"], "plain", 2)])
    a, b = linear(fake).fetch_ready()
    assert a["verified"] is True and b["verified"] is False


def test_list_queue_is_read_only_label_filtered_and_covers_all_states(linear):
    issues = [
        {**issue("a", ["agent"], n=1), "url": "https://linear.app/x/ENG-1", "updatedAt": "2026-01-02", "state": {"name": "Todo"}},
        {**issue("b", ["bug"], n=2), "state": {"name": "Todo"}},
        {**issue("c", ["agent", "big"], n=3), "state": {"name": "Backlog"}},
    ]
    fake = FakeLinear(issues=issues)
    q = linear(fake).list_queue()
    assert [(i["identifier"], i["state"]) for i in q] == [("ENG-1", "Todo"), ("ENG-3", "Backlog")]
    assert q[0]["url"].endswith("ENG-1") and q[1]["labels"] == ["agent", "big"]
    assert fake.calls[0]["variables"]["states"] == ["Todo", "In Progress", "In Review", "Backlog"]
    assert all("mutation" not in c["query"] for c in fake.calls)
