"""Triage: before any code is written, a read-only product-manager role decides whether a task is
clear, how big it is, and what the plan is. The harness (not the model) turns that into one of
three outcomes, so the model can't talk its way past the approval gate:

  needs_info      the task is unclear                       -> comment the questions, park, stop
  needs_approval  big, and a human hasn't approved it       -> comment the plan, park, stop
  proceed         clear and small (or already approved)     -> comment the plan, then implement

A task counts as approved when its description holds a human-written ```verify block, or it carries
the label `approved`. The model's proposed verification command is only ever written into the
comment; it is never executed by the harness.
"""
import subprocess
from dataclasses import dataclass

from .review import extract_json

MAX_FILES = 300


@dataclass(frozen=True)
class Triage:
    actionable: bool
    size: str  # "small" | "big"
    summary: str
    questions: tuple[str, ...]
    assumptions: tuple[str, ...]
    plan: tuple[str, ...]
    acceptance_criteria: tuple[str, ...]
    proposed_verify: str | None
    risks: tuple[str, ...]


def _strs(v) -> tuple[str, ...]:
    return tuple(str(x).strip() for x in v if str(x).strip()) if isinstance(v, list) else ()


def parse_triage(text: str) -> Triage | None:
    """None when the reply has no usable block (the caller then skips triage rather than guessing)."""
    data = extract_json(text)
    if data is None or not isinstance(data.get("actionable"), bool):
        return None
    questions = _strs(data.get("questions"))
    if not data["actionable"] and not questions:
        questions = ("The task looks unclear but triage did not say what is missing. "
                     "Please describe the expected outcome.",)
    verify = data.get("proposed_verify")
    return Triage(
        actionable=data["actionable"],
        size=data.get("size") if data.get("size") in ("small", "big") else "big",  # unsure -> ask a human
        summary=str(data.get("summary") or "").strip(),
        questions=questions,
        assumptions=_strs(data.get("assumptions")),
        plan=_strs(data.get("plan")),
        acceptance_criteria=_strs(data.get("acceptance_criteria")),
        proposed_verify=verify.strip() if isinstance(verify, str) and verify.strip() else None,
        risks=_strs(data.get("risks")),
    )


def decide(t: Triage, *, approved: bool, forced_big: bool) -> str:
    if not t.actionable:
        return "needs_info"
    if (t.size == "big" or forced_big) and not approved:
        return "needs_approval"
    return "proceed"


def tracked_files(cwd: str, limit: int = MAX_FILES) -> list[str]:
    r = subprocess.run(["git", "ls-files"], cwd=cwd, capture_output=True, text=True)
    files = r.stdout.splitlines() if r.returncode == 0 else []
    return files[:limit] + ([f"... and {len(files) - limit} more"] if len(files) > limit else [])


def triage_prompt(*, title: str, labels: list[str], description: str, has_human_verify: bool,
                  forced_big: bool, files: list[str]) -> str:
    return "\n".join([
        f"Triage this task.\n\nTitle: {title}",
        f"Labels: {', '.join(labels) or 'none'}" + ("  (label `big` forces size big)" if forced_big else ""),
        f"Human-approved verification command in the description: {'yes' if has_human_verify else 'no'}",
        "", "Description:", description.strip() or "(empty)", "",
        "Tracked files in the repository:", "\n".join(files) or "(not a git checkout)", "",
        "Do not modify any files. End your reply with the JSON block described in your role.",
    ])


def _numbered(items) -> str:
    return "\n".join(f"{i}. {x}" for i, x in enumerate(items, 1))


def _bullets(items) -> str:
    return "\n".join(f"- {x}" for x in items)


def format_comment(t: Triage, kind: str, *, forced_big: bool = False, has_human_verify: bool = False) -> str:
    """The Linear comment. Markdown, readable on its own."""
    size = "big" if t.size == "big" or forced_big else "small"
    status = {
        "proceed": "Proceeding with the implementation. Review this plan afterwards and tell me if I started down the wrong path.",
        "needs_info": "Stopped. I need answers before building this. Edit the description with your answers and move the issue back to Todo.",
        "needs_approval": "Stopped. This is a big task and needs your approval first.",
    }[kind]
    parts = [f"### Triage ({size})", "", status]
    if t.summary:
        parts += ["", t.summary]
    for title, body in [("Questions", _numbered(t.questions)), ("Assumptions", _bullets(t.assumptions)),
                        ("Plan", _numbered(t.plan)), ("Acceptance criteria", _bullets(t.acceptance_criteria)),
                        ("Risks", _bullets(t.risks))]:
        if body:
            parts += ["", f"**{title}**", body]
    if t.proposed_verify and not has_human_verify:
        parts += ["", "**Proposed verification** (not executed by me; you decide)", f"```verify\n{t.proposed_verify}\n```"]
    if kind == "needs_approval":
        parts += ["", "To approve: add a `verify` block (edit the proposal if needed) to the issue description, "
                      "or add the label `approved`, then move the issue back to Todo."]
    elif kind == "proceed" and t.proposed_verify and not has_human_verify:
        parts += ["", "This run is **unverified** (draft PR). Add the block above to the description to get a verified run next time."]
    return "\n".join(parts)
