"""Background-service plumbing: single-instance lock, heartbeat status file, cleanup of runs a
crash left half-written.

The desktop app and the service share nothing but files in the state dir:
  service.lock   held (flock) for the life of the process; a second `looper` exits instead of
                 running two loops over the same Linear queue
  status.json    {pid, started_at, heartbeat, phase, detail}; the UI treats a heartbeat older
                 than STALE_AFTER seconds as "not running", whatever the pid says
"""
import json
import os
import time
from pathlib import Path

from .events import RunLog

HEARTBEAT_EVERY = 5   # seconds between status.json refreshes while idle
STALE_AFTER = 20      # UI-side: older heartbeat == service is gone


class AlreadyRunning(RuntimeError):
    pass


class ServiceState:
    def __init__(self, state_dir: str | Path):
        self.dir = Path(state_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.status_path = self.dir / "status.json"
        self._lock = None
        self._started = time.time()

    def acquire(self) -> None:
        self._lock = open(self.dir / "service.lock", "a+")
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self._lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            self._lock.close()
            self._lock = None
            raise AlreadyRunning(f"another looper service holds {self.dir / 'service.lock'}") from e

    def beat(self, phase: str, detail: str = "") -> None:
        data = {"pid": os.getpid(), "started_at": self._started, "heartbeat": time.time(),
                "phase": phase, "detail": detail}
        tmp = self.status_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.replace(tmp, self.status_path)  # readers never see a half-written file

    def release(self) -> None:
        self.beat("stopped")
        if self._lock:
            self._lock.close()  # closing drops the flock
            self._lock = None


def mark_interrupted(runs_dir: str | Path) -> list[str]:
    """Runs with no run_end belong to a process that died. Tell the UI, so they stop showing as
    running. A resumed run continues the same file; the UI flips back to running on its next attempt."""
    marked = []
    for f in sorted(Path(runs_dir).glob("*.jsonl")):
        last = ""
        try:
            for line in f.read_text().splitlines():
                if line.strip():
                    last = line
            if not last or json.loads(last).get("type") in ("run_end", "interrupted"):
                continue
        except (OSError, json.JSONDecodeError):
            continue
        RunLog(runs_dir, f.stem).emit("interrupted", reason="the service stopped while this run was active")
        marked.append(f.stem)
    return marked
