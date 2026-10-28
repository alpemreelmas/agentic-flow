"""Append-only JSONL run log. One file per run: <runs_dir>/<run_id>.jsonl.

This file is the contract between the Python loop and the desktop UI: the UI
tails it, so the two never need a server. One JSON object per line:
  {"ts": <unix seconds>, "type": "...", ...}
Types: run_start, attempt_start, agent_message, agent_thought, tool_call,
tool_update, permission, plan, agent_error, verify, run_end.
"""
import json
import re
import time
from pathlib import Path


def new_run_id(task_id: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]", "-", task_id)[:40]
    return f"{time.strftime('%Y%m%dT%H%M%S')}-{slug}"


class RunLog:
    def __init__(self, runs_dir: str | Path, run_id: str):
        self.path = Path(runs_dir) / f"{run_id}.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, type: str, **data) -> None:
        line = json.dumps({"ts": time.time(), "type": type, **data}, ensure_ascii=False)
        with self.path.open("a") as f:  # open per line: a crash never loses earlier events
            f.write(line + "\n")
