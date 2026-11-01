"""Preflight: is this machine able to run the loop? Read-only; every check returns ok / hint."""
import json
import shutil
import subprocess


def _run(cmd: list[str], timeout: int = 15) -> tuple[bool, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def _item(name: str, ok: bool, detail: str = "", hint: str = "") -> dict:
    return {"name": name, "ok": ok, "detail": detail, "hint": "" if ok else hint}


def _binary(name: str, hint: str, version_arg: str = "--version") -> dict:
    path = shutil.which(name)
    if not path:
        return _item(name, False, "bulunamadı", hint)
    ok, out = _run([path, version_arg])
    return _item(name, ok, (out.splitlines() or [path])[0] if ok else out, hint)


def run_checks() -> list[dict]:
    """Checks for the tools the loop shells out to. Linear is verified separately by --check."""
    items = [
        _binary("git", "git kurun (macOS: xcode-select --install)"),
        _binary("gh", "GitHub CLI kurun: https://cli.github.com"),
    ]
    if shutil.which("gh"):
        ok, out = _run(["gh", "auth", "status"])
        items.append(_item("gh auth", ok, (out.splitlines() or [""])[0], "`gh auth login` çalıştırın"))
    else:
        items.append(_item("gh auth", False, "gh yok", "önce gh kurun, sonra `gh auth login`"))
    items.append(_binary("node", "Node.js 20+ kurun: https://nodejs.org"))
    items.append(_binary("npx", "npx, Node.js ile gelir; Node.js kurun"))
    agent_hint = "ajan CLI'ını kurup giriş yapın (ör. `npm i -g @anthropic-ai/claude-code`, sonra `claude`)"
    agents = [_binary(n, agent_hint) for n in ("claude", "codex")]
    # one working agent CLI is enough; report a missing one as info, not failure
    if any(a["ok"] for a in agents):
        for a in agents:
            a["hint"] = "" if a["ok"] else "isteğe bağlı"
            a["optional"] = not a["ok"]
    items.extend(agents)
    return items


def report() -> str:
    items = run_checks()
    blocking = [i for i in items if not i["ok"] and not i.get("optional")]
    return json.dumps({"ok": not blocking, "items": items})
