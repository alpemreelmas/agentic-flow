import json

from looper.workspaces import Workspace, load, route


def test_routes_by_project_and_ignores_unmatched():
    web, api = Workspace("web", "/r/web", "p1"), Workspace("api", "/r/api", "p2")
    assert route({"project_id": "p2"}, [web, api]) is api
    assert route({"project_id": "zzz"}, [web, api]) is None
    assert route({}, [web, api]) is None  # no project: never guess a repo


def test_disabled_workspace_does_not_take_its_tasks():
    web = Workspace("web", "/r/web", "p1", enabled=False)
    assert route({"project_id": "p1"}, [web, Workspace("api", "/r/api", "p2")]) is None


def test_lone_workspace_without_project_takes_everything():
    solo = Workspace("default", "/r")
    assert route({"project_id": "x"}, [solo]) is solo and route({}, [solo]) is solo
    assert route({}, [solo, Workspace("web", "/r/web", "p1")]) is None  # catch-all only when alone
    assert route({}, [Workspace("default", "/r", enabled=False)]) is None


def test_load_reads_the_file_the_app_writes(tmp_path):
    f = tmp_path / "w.json"
    f.write_text(json.dumps([{"name": "web", "repo": "/r/web", "project_id": "p1", "enabled": False}, {"name": "x", "repo": "/r/x"}]))
    assert load(f) == [Workspace("web", "/r/web", "p1", False), Workspace("x", "/r/x", None, True)]
