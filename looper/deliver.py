"""Deliver a finished task: commit, push the branch, open (or update) a pull request.

This is plain harness code. The agent never gets push rights or credentials: it only edits files in
the worktree, and this module turns that into a PR. A human merges; nothing here ever merges or
force-pushes.
"""
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .review import NOISE

PROTECTED = {"main", "master"}  # never commit straight onto these


@dataclass
class Delivery:
    ok: bool = True
    url: str | None = None
    note: str = ""  # shown in the run log; on failure it is the reason


class Deliverer(Protocol):
    def deliver(self, *, cwd: str, title: str, body: str, draft: bool) -> Delivery: ...


class DeliveryError(Exception):
    pass


class GitHubDeliverer:
    """git + the `gh` CLI (already logged in as the user). Idempotent: re-running on the same
    branch pushes new commits and reuses the open PR instead of creating another."""

    def __init__(self, timeout: float = 120):
        self.timeout = timeout

    def _run(self, cwd: str, *cmd: str) -> str:
        try:
            r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=self.timeout)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise DeliveryError(f"`{' '.join(cmd[:2])}` could not run: {e}") from e
        if r.returncode != 0:
            raise DeliveryError(f"`{' '.join(cmd[:3])}` failed: {(r.stderr or r.stdout).strip()[-800:]}")
        return r.stdout.strip()

    def deliver(self, *, cwd: str, title: str, body: str, draft: bool) -> Delivery:
        if not (Path(cwd) / ".git").exists():
            return Delivery(note="not a git checkout; nothing to deliver")
        try:
            return self._deliver(cwd, title, body, draft)
        except DeliveryError as e:
            return Delivery(ok=False, note=str(e))

    def _deliver(self, cwd: str, title: str, body: str, draft: bool) -> Delivery:
        git = lambda *a: self._run(cwd, "git", *a)  # noqa: E731
        branch = git("rev-parse", "--abbrev-ref", "HEAD")
        if branch in PROTECTED or branch == "HEAD":
            raise DeliveryError(f"refusing to deliver from branch {branch!r}; expected an agent work branch")

        base = self._run(cwd, "gh", "repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name")
        git("fetch", "-q", "origin", base)

        git("add", "-A", "--", ".", *NOISE)
        has_staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=cwd).returncode != 0
        if has_staged:
            git("commit", "-q", "-m", title, "-m", "Committed by linear-looper.")

        if int(git("rev-list", "--count", f"origin/{base}..HEAD")) == 0:
            return Delivery(note=f"no changes versus origin/{base}; nothing to deliver")

        git("push", "-q", "-u", "origin", "HEAD")  # never --force

        existing = self._run(cwd, "gh", "pr", "list", "--head", branch, "--state", "open", "--json", "url",
                             "-q", ".[].url").splitlines()
        if existing:
            return Delivery(url=existing[0], note="pushed to the existing PR")
        create = ["gh", "pr", "create", "--title", title, "--body", body, "--head", branch, "--base", base]
        out = self._run(cwd, *create, *(["--draft"] if draft else []))
        return Delivery(url=out.splitlines()[-1], note="opened a draft PR" if draft else "opened a PR")
