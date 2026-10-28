"""Review helpers: get the change as a diff, and turn a reviewer's reply into findings.

Reviewers are read-only roles. They never fetch the change themselves; the harness computes the
diff and puts it in the prompt, so a reviewer needs no shell access (and gets none).
"""
import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

MAX_DIFF = 60_000  # chars; past this the reviewer gets a truncated diff and is told so

# Build/run byproducts (e.g. verify running python leaves __pycache__) are never part of "the change".
# Exclude them from what reviewers see; the deliver step must use the same list when it commits.
NOISE = (":(exclude)*__pycache__*", ":(exclude)*.pyc", ":(exclude)*node_modules*", ":(exclude)*.DS_Store")

_JSON_BLOCK =re.compile(r"```json\s*(\{.*?\})\s*```", re.S)


@dataclass(frozen=True)
class Finding:
    severity: str  # "blocking" | "minor"
    file: str
    line: int
    text: str
    reviewer: str

    def render(self) -> str:
        where = f"{self.file}:{self.line}" if self.file and self.line else self.file
        return f"[{self.reviewer}] {where + ': ' if where else ''}{self.text}"


def extract_json(text: str) -> dict | None:
    """The object in the last ```json fenced block of an agent reply, or None."""
    blocks = _JSON_BLOCK.findall(text)
    if not blocks:
        return None
    try:
        data = json.loads(blocks[-1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def parse_review(text: str, reviewer: str) -> tuple[list[Finding], bool]:
    """Findings from the last ```json block in the reply. Returns (findings, parsed_ok).

    Only the findings' own severity decides blocking; the reviewer's overall verdict is ignored,
    so a reviewer that says "changes requested" over nitpicks can't start a rework loop.
    """
    data = extract_json(text)
    if data is None:
        return [], False
    raw = data.get("findings")
    findings = []
    for f in raw if isinstance(raw, list) else []:
        if not isinstance(f, dict):
            continue
        line = f.get("line")
        findings.append(Finding(
            severity="blocking" if f.get("severity") == "blocking" else "minor",
            file=str(f.get("file") or ""),
            line=line if isinstance(line, int) else 0,
            text=str(f.get("text") or ""),
            reviewer=reviewer,
        ))
    return findings, True


def findings_json(findings: list[Finding]) -> list[dict]:
    return [asdict(f) for f in findings]


def git_diff(cwd: str, limit: int = MAX_DIFF) -> str | None:
    """Uncommitted change in `cwd` vs HEAD, new files included. None when cwd isn't a git checkout."""
    if not (Path(cwd) / ".git").exists():  # a file (not a dir) in linked worktrees
        return None
    run = lambda *a: subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True)  # noqa: E731
    run("add", "-N", ".", *NOISE)  # intent-to-add, so untracked files show up in the diff
    out = run("diff", "HEAD", "--", ".", *NOISE).stdout
    if len(out) > limit:
        out = out[:limit] + f"\n… [diff truncated, {len(out) - limit} more chars]"
    return out
