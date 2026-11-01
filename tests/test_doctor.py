import json

from looper import doctor


def _fake(monkeypatch, present: set[str], gh_authed: bool = True):
    monkeypatch.setattr(doctor.shutil, "which", lambda n: f"/bin/{n}" if n in present else None)

    def run(cmd, timeout=15):
        if cmd[0].endswith("gh") and cmd[1:2] == ["auth"]:
            return gh_authed, "Logged in" if gh_authed else "not logged in"
        return True, f"{cmd[0]} 1.0"
    monkeypatch.setattr(doctor, "_run", run)


def test_all_present_is_ok(monkeypatch):
    _fake(monkeypatch, {"git", "gh", "node", "npx", "claude"})
    out = json.loads(doctor.report())
    assert out["ok"] is True
    codex = next(i for i in out["items"] if i["name"] == "codex")
    assert codex["optional"] and not codex["ok"]  # one agent CLI is enough


def test_missing_gh_blocks_and_hints(monkeypatch):
    _fake(monkeypatch, {"git", "node", "npx", "claude"})
    out = json.loads(doctor.report())
    assert out["ok"] is False
    gh = next(i for i in out["items"] if i["name"] == "gh")
    assert not gh["ok"] and "cli.github.com" in gh["hint"]


def test_unauthenticated_gh_blocks(monkeypatch):
    _fake(monkeypatch, {"git", "gh", "node", "npx", "claude"}, gh_authed=False)
    out = json.loads(doctor.report())
    assert out["ok"] is False
    assert any(i["name"] == "gh auth" and not i["ok"] for i in out["items"])


def test_no_agent_cli_blocks(monkeypatch):
    _fake(monkeypatch, {"git", "gh", "node", "npx"})
    out = json.loads(doctor.report())
    assert out["ok"] is False
    assert all(not i.get("optional") for i in out["items"] if i["name"] in ("claude", "codex"))
