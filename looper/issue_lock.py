"""Cross-process issue lock shared by desktop bridges and the task loop."""
from contextlib import contextmanager
import hashlib
from pathlib import Path


class IssueBusy(RuntimeError):
    pass


@contextmanager
def issue_lock(state_dir, issue_id):
    root = Path(state_dir) / "issue-locks"
    root.mkdir(parents=True, exist_ok=True)
    path = root / hashlib.sha256(issue_id.encode()).hexdigest()
    with path.open("a+b") as handle:
        if __import__("os").name == "nt":
            import msvcrt
            handle.seek(0)
            handle.write(b"\0")
            handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise IssueBusy("This issue is being processed; retry after the run finishes") from None
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise IssueBusy("This issue is being processed; retry after the run finishes") from None
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)
