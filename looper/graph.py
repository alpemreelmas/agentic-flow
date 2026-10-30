"""The per-task LangGraph. Routing is plain code; the model only acts inside `work` and `review`.

  claim -> triage --unclear / big & unapproved--> park -> END
              |
              +--proceed--> work -> verify --pass--> review --clean--> deliver --ok--> report -> END
                              ^        |               |                    |
                              |        |               +--blocking findings-+--delivery failed--> escalate
                              |        +--fail----------+
                              +--------- attempts < max
                                         attempts >= max -> escalate -> END

Verify failures and blocking review findings share one retry budget (`max_attempts`), so the
implementer and the reviewers can't ping-pong forever.
"""
import asyncio
import subprocess
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .acp_executor import run_prompt
from .events import RunLog, new_run_id
from .registry import LocalRegistry, compose_prompt
from .review import Finding, findings_json, git_diff, parse_review
from .triage import decide, format_comment, parse_triage, tracked_files, triage_prompt


class TaskState(TypedDict, total=False):
    skill_repo: str
    skills: list[str]
    task_id: str
    run_id: str         # names the runs/<run_id>.jsonl event log
    role: str           # registry role name; default "implementer"
    title: str
    description: str
    verify_cmd: str
    cwd: str
    workspace: str      # workspace name, shown next to the run in the UI
    feedback: str       # why the last step failed; empty = nothing to fix
    feedback_kind: str  # "verify" | "review" | "agent": decides how the retry prompt is worded
    review_notes: str   # non-blocking findings, passed on to the report
    summary: str        # implementer's last message
    verified: bool      # False when the task came without a human-written verification command
    labels: list[str]
    plan: str           # triage plan, passed to the implementer as guidance
    criteria: str       # triage acceptance criteria, passed to implementer and reviewers
    parked: bool        # triage stopped the task; park_comment explains why
    park_comment: str
    pr_url: str
    attempts: int


def _prompt(s: TaskState) -> str:
    p = f"Task: {s['title']}\n\n{s['description']}\n\nWork only inside the current directory. Make the change, don't ask questions."
    if s.get("plan"):
        p += f"\n\n## Plan from triage\nGuidance only. If it conflicts with the task text, the task text wins.\n{s['plan']}"
    if s.get("criteria"):
        p += f"\n\n## Acceptance criteria\n{s['criteria']}"
    if s.get("feedback"):
        head = {
            "verify": f"Your previous attempt failed verification (`{s['verify_cmd']}`). Output:",
            "review": "Code review found blocking issues with your previous attempt:",
            "agent": "Your previous attempt crashed:",
            "deliver": "Delivery failed:",
        }[s.get("feedback_kind") or "verify"]
        p += f"\n\n{head}\n{s['feedback']}\n\nFix it."
    return p


def _review_prompt(s: TaskState, diff: str) -> str:
    verification = (f"The human-provided verification command `{s['verify_cmd']}` passes."
                    if s.get("verified", True) else
                    "No human-provided verification command exists for this task; nothing but reviewers checked it.")
    criteria = f"## Acceptance criteria (from triage)\n{s['criteria']}\n\n" if s.get("criteria") else ""
    return (f"Review the change below against the task.\n\nTask: {s['title']}\n\n{s['description']}\n\n"
            f"{criteria}{verification}\n\n"
            f"## Diff\n```diff\n{diff}\n```\n\n"
            "Do not modify any files. End your reply with the JSON block described in your role.")


def _pr_body(s: TaskState, verified: bool) -> str:
    check = (f"**Verification:** `{s['verify_cmd']}` passed." if verified else
             "> **UNVERIFIED.** This task came without a verification command, so only the agent reviewers "
             "looked at it. Review it carefully before merging.")
    parts = [f"## {s['title']}", "", (s.get("description") or "").strip() or "_No description._", "", check]
    if s.get("criteria"):
        parts += ["", "### Acceptance criteria (from triage)", s["criteria"]]
    if s.get("review_notes"):
        parts += ["", "### Review notes (non-blocking)", s["review_notes"]]
    parts += ["", "### Agent summary", (s.get("summary") or "").strip() or "_None._",
              "", "_Opened by linear-looper. A human merges._"]
    return "\n".join(parts)


def build_graph(source, registry, *, runs_dir, agent_override: str | None, max_attempts: int, timeout: float,
                ask_permissions: bool, quiet: bool, checkpointer, reviewers: tuple[str, ...] = (), deliverer=None, triager: str | None = None):
    def log_for(s: TaskState) -> RunLog:
        return RunLog(runs_dir, s["run_id"])

    async def claim(s: TaskState):
        source.mark_in_progress(s["task_id"])
        run_id = new_run_id(s["task_id"])
        RunLog(runs_dir, run_id).emit("run_start", task_id=s["task_id"], title=s["title"],
                                      role=s.get("role") or "implementer", workspace=s.get("workspace", ""))
        # A thread can be re-run (the user moves the issue back to Todo), so reset everything a
        # previous run may have left behind; stale `parked` or `pr_url` would corrupt this run.
        return {"attempts": 0, "feedback": "", "feedback_kind": "", "review_notes": "", "summary": "",
                "plan": "", "criteria": "", "parked": False, "park_comment": "", "pr_url": "", "run_id": run_id}

    def scoped_registry(s):
        return registry.for_workspace(s.get("skill_repo", s["cwd"]), s.get("skills", ())) if isinstance(registry, LocalRegistry) else registry

    async def triage(s: TaskState):
        if not triager:
            return {}
        log = log_for(s)
        labels = s.get("labels") or []
        forced_big = "big" in labels
        has_human_verify = s.get("verified", True)
        approved = has_human_verify or "approved" in labels
        try:
            role = registry.get_role(triager)
            cli = agent_override or role.cli
            log.emit("triage_start", role=triager, cli=cli)
            files = await asyncio.to_thread(tracked_files, s["cwd"])
            scoped = scoped_registry(s)
            prompt = compose_prompt(scoped, role, triage_prompt(
                title=s["title"], labels=labels, description=s.get("description") or "",
                has_human_verify=has_human_verify, forced_big=forced_big, files=files))
            log.emit("prompt", role=triager, text=prompt, skills=getattr(scoped, "used_skills", []))
            res = await run_prompt(cli, s["cwd"], prompt, timeout=timeout,
                                   auto_approve=role.permissions == "auto" and not ask_permissions,
                                   quiet=quiet, on_event=lambda ev: log.emit(**ev))
            t = parse_triage(res.text)
        except Exception as e:  # triage is advice; its failure must not stop the task, but must be visible
            log.emit("agent_error", error=repr(e))
            log.emit("triage_skipped", reason=f"triage failed: {e!r}")
            return {}
        if t is None:
            log.emit("triage_skipped", reason="reply had no parsable JSON block")
            return {}
        kind = decide(t, approved=approved, forced_big=forced_big)
        comment = format_comment(t, kind, forced_big=forced_big, has_human_verify=has_human_verify)
        log.emit("triage_result", decision=kind, size=t.size, actionable=t.actionable, summary=t.summary,
                 questions=list(t.questions), plan=list(t.plan), criteria=list(t.acceptance_criteria),
                 risks=list(t.risks), proposed_verify=t.proposed_verify)
        if kind != "proceed":
            return {"parked": True, "park_comment": comment}
        try:
            source.comment(s["task_id"], comment)
        except Exception as e:  # a failed note must not stop the work
            log.emit("agent_error", error=f"could not post the triage note: {e!r}")
        return {"plan": "\n".join(f"{i}. {x}" for i, x in enumerate(t.plan, 1)),
                "criteria": "\n".join(f"- {x}" for x in t.acceptance_criteria)}

    async def park(s: TaskState):
        log_for(s).emit("run_end", status="needs_human", attempts=0)
        source.finish(s["task_id"], "needs_human", s["park_comment"])

    async def work(s: TaskState):
        log = log_for(s)
        try:
            role = registry.get_role(s.get("role") or "implementer")
            cli = agent_override or role.cli
            log.emit("attempt_start", attempt=s["attempts"] + 1, role=role.name, cli=cli)
            scoped = scoped_registry(s)
            prompt = compose_prompt(scoped, role, _prompt(s))
            log.emit("prompt", role=role.name, text=prompt, skills=getattr(scoped, "used_skills", []))  # exactly what the agent was sent
            res = await run_prompt(cli, s["cwd"], prompt, timeout=timeout,
                                   auto_approve=role.permissions == "auto" and not ask_permissions,
                                   quiet=quiet, on_event=lambda ev: log.emit(**ev))
            log.emit("attempt_end", stop_reason=res.stop_reason)
            return {"attempts": s["attempts"] + 1, "summary": res.text, "feedback": ""}
        except Exception as e:  # agent crash/timeout counts as a failed attempt, not a dead loop
            log.emit("agent_error", error=repr(e))
            return {"attempts": s["attempts"] + 1, "summary": "", "feedback": f"agent error: {e!r}",
                    "feedback_kind": "agent"}

    async def verify(s: TaskState):
        if s.get("feedback_kind") == "agent" and s.get("feedback"):
            return {}  # the agent never finished; nothing to verify, keep the error as feedback
        r = await asyncio.to_thread(subprocess.run, s["verify_cmd"], shell=True, cwd=s["cwd"],
                                    capture_output=True, text=True, timeout=600)
        out = (r.stdout + r.stderr)[-4000:]
        feedback = "" if r.returncode == 0 else out or f"exit {r.returncode}"
        log_for(s).emit("verify", ok=not feedback, command=s["verify_cmd"], exit_code=r.returncode, output=out)
        return {"feedback": feedback, "feedback_kind": "verify"}

    async def review(s: TaskState):
        log = log_for(s)
        diff = await asyncio.to_thread(git_diff, s["cwd"])
        if not diff or not diff.strip():
            log.emit("review_skipped", reason="not a git checkout" if diff is None else "no changes to review")
            return {"feedback": "", "review_notes": ""}
        findings: list[Finding] = []
        for name in reviewers:  # sequential: parallel reviewers would interleave in one run log
            try:
                role = registry.get_role(name)
                cli = agent_override or role.cli
                log.emit("review_start", reviewer=name, cli=cli)
                scoped = scoped_registry(s)
                prompt = compose_prompt(scoped, role, _review_prompt(s, diff))
                log.emit("prompt", role=name, text=prompt, skills=getattr(scoped, "used_skills", []))
                res = await run_prompt(cli, s["cwd"], prompt, timeout=timeout,
                                       auto_approve=role.permissions == "auto" and not ask_permissions,
                                       quiet=quiet, on_event=lambda ev: log.emit(**ev))
                found, parsed = parse_review(res.text, name)
                if not parsed:
                    found = [Finding("minor", "", 0, "reviewer reply had no parsable JSON block; not enforced", name)]
                log.emit("review_result", reviewer=name, parsed=parsed, findings=findings_json(found))
                findings += found
            except Exception as e:  # a crashed reviewer must not block delivery, but it must be visible
                log.emit("agent_error", error=repr(e))
                findings.append(Finding("minor", "", 0, f"reviewer failed: {e!r}", name))
        blocking = [f for f in findings if f.severity == "blocking"]
        minor = [f for f in findings if f.severity != "blocking"]
        return {"feedback": "\n".join(f.render() for f in blocking), "feedback_kind": "review",
                "review_notes": "\n".join(f.render() for f in minor)}

    async def deliver(s: TaskState):
        if deliverer is None:
            return {}
        verified = s.get("verified", True)
        d = await asyncio.to_thread(
            deliverer.deliver, cwd=s["cwd"], draft=not verified,
            title=s["title"] if verified else f"[UNVERIFIED] {s['title']}", body=_pr_body(s, verified))
        log_for(s).emit("deliver", ok=d.ok, url=d.url, note=d.note, draft=not verified)
        if not d.ok:
            return {"feedback": d.note, "feedback_kind": "deliver"}
        return {"pr_url": d.url or ""}

    async def report(s: TaskState):
        log_for(s).emit("run_end", status="review", attempts=s["attempts"])
        head = (f"Done in {s['attempts']} attempt(s), verify passed." if s.get("verified", True) else
                f"Done in {s['attempts']} attempt(s). **UNVERIFIED**: no verification command was given.")
        pr = f"\n\nPR: {s['pr_url']}" if s.get("pr_url") else ""
        notes = f"\n\nReview notes (non-blocking):\n{s['review_notes']}" if s.get("review_notes") else ""
        source.finish(s["task_id"], "review", f"{head}{pr}{notes}\n\n{s['summary']}")

    async def escalate(s: TaskState):
        log_for(s).emit("run_end", status="needs_human", attempts=s["attempts"])
        if s.get("feedback_kind") == "deliver":
            msg = (f"The work is finished and verified, but delivery failed:\n\n{s['feedback']}\n\n"
                   f"The changes are in `{s['cwd']}`.")
        else:
            msg = f"Gave up after {s['attempts']} attempts.\n\n{s['feedback']}"
        source.finish(s["task_id"], "needs_human", msg)

    def after_triage(s: TaskState) -> str:
        return "park" if s.get("parked") else "work"

    def retry_or_escalate(s: TaskState) -> str:
        return "escalate" if s["attempts"] >= max_attempts else "work"

    def after_verify(s: TaskState) -> str:
        if s["feedback"]:
            return retry_or_escalate(s)
        return "review" if reviewers else "deliver"

    def after_review(s: TaskState) -> str:
        return retry_or_escalate(s) if s["feedback"] else "deliver"

    def after_deliver(s: TaskState) -> str:
        return "escalate" if s.get("feedback") else "report"

    g = StateGraph(TaskState)
    for name, fn in [("claim", claim), ("triage", triage), ("park", park), ("work", work), ("verify", verify), ("review", review),
                     ("deliver", deliver), ("report", report), ("escalate", escalate)]:
        g.add_node(name, fn)
    g.add_edge(START, "claim")
    g.add_edge("claim", "triage")
    g.add_conditional_edges("triage", after_triage, ["park", "work"])
    g.add_edge("park", END)
    g.add_edge("work", "verify")
    g.add_conditional_edges("verify", after_verify, ["review", "deliver", "work", "escalate"])
    g.add_conditional_edges("review", after_review, ["deliver", "work", "escalate"])
    g.add_conditional_edges("deliver", after_deliver, ["report", "escalate"])
    g.add_edge("report", END)
    g.add_edge("escalate", END)
    return g.compile(checkpointer=checkpointer)
