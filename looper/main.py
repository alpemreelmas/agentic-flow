"""Outer loop: poll the task source, run the graph once per ready task."""
import argparse
import asyncio
import json
import os
import re
import signal
import subprocess
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from .deliver import GitHubDeliverer
from .graph import build_graph
from .registry import LocalRegistry
from .service import AlreadyRunning, ServiceState, HEARTBEAT_EVERY, mark_interrupted
from .sources import FileSource, LinearSource


def workdir(repo: Path, task_id: str) -> str:
    """Isolated git worktree per task if repo is git; otherwise work in place."""
    if not (repo / ".git").exists():
        return str(repo)
    slug = re.sub(r"[^A-Za-z0-9_-]", "-", task_id)[:40]
    wt = repo / ".worktrees" / slug
    if not wt.exists():
        subprocess.run(["git", "worktree", "add", "-b", f"agent/{slug}", str(wt)], cwd=repo, check=True,
                       capture_output=True)
    return str(wt)


async def amain(a: argparse.Namespace):
    if a.source == "linear" and not os.environ.get("LINEAR_API_KEY"):
        raise SystemExit("LINEAR_API_KEY is not set. Add the key in Ayarlar (it is stored in the system keychain).")
    source = FileSource(a.tasks) if a.source == "file" else LinearSource(
        label=a.label, ready=a.linear_ready, progress=a.linear_progress,
        review=a.linear_review, blocked=a.linear_blocked)
    if a.list_queue:
        if a.source != "linear":
            raise SystemExit("--list-queue only applies to --source linear")
        print(json.dumps(source.list_queue()))
        return
    if a.check:
        print(source.diagnose() if a.source == "linear" else "--check only applies to --source linear")
        return
    repo = Path(a.repo).resolve()
    state = ServiceState(a.state)
    try:
        state.acquire()
    except AlreadyRunning as e:
        print(f"[service] {e}", flush=True)
        return
    if os.name != "nt":  # SIGTERM from the UI's Stop: unwind through `finally` so status.json says stopped
        main_task = asyncio.current_task()
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, main_task.cancel)
    try:
        for rid in mark_interrupted(a.runs):
            print(f"[service] marked interrupted run {rid}", flush=True)
        await _serve(a, source, repo, state)
    except asyncio.CancelledError:
        pass
    finally:
        state.release()


async def _serve(a, source, repo, state):
    async with AsyncSqliteSaver.from_conn_string(a.db) as cp:
        graph = build_graph(source, LocalRegistry(a.registry), runs_dir=a.runs, agent_override=a.agent,
                            max_attempts=a.max_attempts, timeout=a.timeout,
                            ask_permissions=a.ask_permissions, quiet=a.quiet, checkpointer=cp,
                            reviewers=tuple(r for r in a.reviewers.split(",") if r and r != "none"),
                            deliverer=GitHubDeliverer() if a.deliver == "github" else None,
                            triager=None if a.triage == "none" else a.triage)
        while True:
            state.beat("polling")
            tasks = source.fetch_ready()
            print(f"[poll] {len(tasks)} ready task(s)", flush=True)
            for t in tasks:
                cfg = {"configurable": {"thread_id": t["id"]}}
                snap = await graph.aget_state(cfg)
                state.beat("running", t["title"])
                print(f"[run] {t['title']} ({'resume' if snap.next else 'new'})", flush=True)
                inp = None if snap.next else {  # crashed mid-run -> resume from checkpoint
                    "task_id": t["id"], "role": t.get("role") or "implementer",
                    "title": t["title"], "description": t["description"],
                    "verify_cmd": t["verify"], "verified": t.get("verified", True), "labels": t.get("labels") or [], "cwd": workdir(repo, t["id"])}
                out = await graph.ainvoke(inp, cfg)
                print(f"[done] {t['title']}: {'OK' if not out.get('feedback') else 'escalated'}", flush=True)
            if a.once:
                return
            for left in range(a.interval, 0, -HEARTBEAT_EVERY):
                state.beat("idle", f"next poll in {left}s")
                await asyncio.sleep(min(HEARTBEAT_EVERY, left))


def cli():
    p = argparse.ArgumentParser(prog="looper")
    p.add_argument("--agent", choices=["claude", "gemini", "codex"], default=None,
                   help="override the CLI every role would use")
    p.add_argument("--registry", default="registry", help="dir with roles/ and skills/")
    p.add_argument("--runs", default="runs", help="dir for per-run JSONL event logs (the UI reads these)")
    p.add_argument("--source", choices=["file", "linear"], default="file")
    p.add_argument("--tasks", default="tasks.json")
    p.add_argument("--label", default="agent", help="Linear label to pick up")
    p.add_argument("--linear-ready", default="Todo", help="state the loop picks tasks from")
    p.add_argument("--linear-progress", default="In Progress")
    p.add_argument("--linear-review", default="In Review", help="state for finished tasks")
    p.add_argument("--linear-blocked", default="Backlog", help="state for tasks the loop gave up on (not polled)")
    p.add_argument("--list-queue", action="store_true", help="print the labelled Linear issues as JSON, then exit")
    p.add_argument("--check", action="store_true", help="read-only Linear setup check, then exit")
    p.add_argument("--repo", default=".")
    p.add_argument("--db", default="looper.db")
    p.add_argument("--state", default=".looper", help="dir for service.lock and status.json (the UI reads status.json)")
    p.add_argument("--reviewers", default="tech-reviewer,product-reviewer",
                   help="comma-separated review roles run after verify passes; 'none' disables")
    p.add_argument("--triage", default="product-manager",
                   help="role that triages a task before any code is written; 'none' disables")
    p.add_argument("--deliver", choices=["none", "github"], default="none",
                   help="github: commit, push the work branch and open a PR via gh (never merges)")
    p.add_argument("--max-attempts", type=int, default=3)
    p.add_argument("--timeout", type=float, default=1800)
    p.add_argument("--interval", type=int, default=300)
    p.add_argument("--once", action="store_true")
    p.add_argument("--quiet", action="store_true")
    p.add_argument("--ask-permissions", action="store_true", help="deny tool calls instead of auto-approving")
    asyncio.run(amain(p.parse_args()))


if __name__ == "__main__":
    cli()
