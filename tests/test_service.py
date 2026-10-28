import json
import subprocess
import sys

import pytest

from looper.events import RunLog
from looper.service import AlreadyRunning, ServiceState, mark_interrupted


def test_second_instance_is_refused(tmp_path):
    a, b = ServiceState(tmp_path), ServiceState(tmp_path)
    a.acquire()
    with pytest.raises(AlreadyRunning):
        b.acquire()
    a.release()
    b.acquire()  # lock is free again once the first one is gone
    b.release()


def test_beat_writes_atomic_status(tmp_path):
    s = ServiceState(tmp_path)
    s.beat("idle", "next poll in 5s")
    data = json.loads((tmp_path / "status.json").read_text())
    assert data["phase"] == "idle" and data["pid"] > 0 and data["heartbeat"] >= data["started_at"]
    assert not list(tmp_path.glob("*.tmp"))


def test_lock_dies_with_the_process(tmp_path):
    code = "import sys;from looper.service import ServiceState;s=ServiceState(sys.argv[1]);s.acquire();print('held',flush=True);import os;os._exit(0)"
    r = subprocess.run([sys.executable, "-c", code, str(tmp_path)], capture_output=True, text=True)
    assert "held" in r.stdout
    s = ServiceState(tmp_path)
    s.acquire()  # a crashed holder doesn't wedge the service
    s.release()


def test_mark_interrupted_only_touches_unfinished_runs(tmp_path):
    RunLog(tmp_path, "done").emit("run_start", title="a")
    RunLog(tmp_path, "done").emit("run_end", status="review")
    RunLog(tmp_path, "stuck").emit("run_start", title="b")
    assert mark_interrupted(tmp_path) == ["stuck"]
    assert mark_interrupted(tmp_path) == []  # idempotent
    last = (tmp_path / "stuck.jsonl").read_text().splitlines()[-1]
    assert json.loads(last)["type"] == "interrupted"


def test_sigterm_stops_the_service_and_marks_it_stopped(tmp_path):
    import signal
    import time
    (tmp_path / "t.json").write_text("[]")
    p = subprocess.Popen([sys.executable, "-m", "looper.main", "--source", "file", "--tasks", str(tmp_path / "t.json"),
                          "--triage", "none", "--reviewers", "none", "--interval", "60", "--state", str(tmp_path / "st"),
                          "--db", str(tmp_path / "l.db"), "--runs", str(tmp_path / "runs")], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    status = tmp_path / "st" / "status.json"
    for _ in range(100):
        if status.exists() and json.loads(status.read_text()).get("phase") == "idle":
            break
        time.sleep(0.1)
    p.send_signal(signal.SIGTERM)
    assert p.wait(timeout=10) == 0, p.stderr.read().decode()
    assert json.loads(status.read_text())["phase"] == "stopped"


def test_linear_without_key_exits_with_a_readable_message(tmp_path):
    import os
    env = {k: v for k, v in os.environ.items() if k != "LINEAR_API_KEY"}
    r = subprocess.run([sys.executable, "-m", "looper.main", "--source", "linear", "--list-queue"], capture_output=True, text=True, env=env)
    assert r.returncode == 1 and "LINEAR_API_KEY is not set" in r.stderr and "Traceback" not in r.stderr
