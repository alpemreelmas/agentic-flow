"""Run the eval sets against the real agents (subscription CLIs, no API key).

  uv run python -m evals.run triage --runs 3
  uv run python -m evals.run review --runs 3 --agent claude
  uv run python -m evals.run compare evals/results/a.json evals/results/b.json
  uv run python -m evals.run triage --dry-run          # counts the agent calls, runs none

Nothing here writes to Linear or GitHub: triage and review get a throwaway copy of the fixture repo and
read-only roles. Each result file records a hash of the role and skill files, so two runs can be tied
to the prompts that produced them.
"""
import argparse
import asyncio
import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import yaml

from looper.acp_executor import run_prompt
from looper.graph import _review_prompt
from looper.registry import LocalRegistry, compose_prompt
from looper.review import parse_review
from looper.triage import parse_triage, triage_prompt, tracked_files

from .grade import Grade, grade_review, grade_triage, summarize

HERE = Path(__file__).parent
REGISTRY = HERE.parent / "registry"
REVIEWERS = ("tech-reviewer", "product-reviewer")
FIXTURE_FILES = {str(p.relative_to(HERE / "fixture")) for p in (HERE / "fixture").rglob("*") if p.is_file()}


def load_cases(stage: str) -> list[dict]:
    cases = yaml.safe_load((HERE / "cases" / f"{stage}.yaml").read_text())
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids)), f"duplicate case ids in {stage}.yaml"
    return cases


def prompt_hash(roles: tuple[str, ...]) -> dict[str, str]:
    """Short hash of each role file plus the skills it uses: changes whenever the prompt text changes."""
    reg, out = LocalRegistry(REGISTRY), {}
    for name in roles:
        role = reg.get_role(name)
        text = (REGISTRY / "roles" / f"{name}.md").read_text() + "".join(reg.get_skill(s) for s in role.skills)
        out[name] = hashlib.sha256(text.encode()).hexdigest()[:10]
    return out


def make_repo() -> str:
    """A fresh git checkout of the fixture project in a temp dir."""
    d = Path(tempfile.mkdtemp(prefix="looper-eval-"))
    shutil.copytree(HERE / "fixture", d, dirs_exist_ok=True)
    for cmd in (["init", "-q"], ["add", "."], ["-c", "user.name=eval", "-c", "user.email=e@e", "commit", "-qm", "fixture"]):
        subprocess.run(["git", *cmd], cwd=d, check=True, capture_output=True)
    return str(d)


async def one_triage(case: dict, agent: str, timeout: float) -> tuple[Grade, float]:
    reg, cwd, t0 = LocalRegistry(REGISTRY), make_repo(), time.time()
    try:
        role = reg.get_role("product-manager")
        prompt = compose_prompt(reg, role, triage_prompt(
            title=case["title"], labels=case.get("labels", []), description=case["description"],
            has_human_verify=False, forced_big=False, files=tracked_files(cwd)))
        res = await run_prompt(agent, cwd, prompt, timeout=timeout, auto_approve=False, quiet=True)
        return grade_triage(parse_triage(res.text), case["expect"]), time.time() - t0
    except Exception as e:
        return Grade(False, f"agent error: {e!r}"), time.time() - t0
    finally:
        shutil.rmtree(cwd, ignore_errors=True)


async def one_review(case: dict, agent: str, timeout: float) -> tuple[Grade, float]:
    reg, cwd, t0 = LocalRegistry(REGISTRY), make_repo(), time.time()
    state = {"title": case["title"], "description": case["description"], "criteria": case.get("criteria", ""),
             "verified": False}
    findings, parsed = [], True
    try:
        for name in REVIEWERS:
            prompt = compose_prompt(reg, reg.get_role(name), _review_prompt(state, case["diff"]))
            res = await run_prompt(agent, cwd, prompt, timeout=timeout, auto_approve=False, quiet=True)
            f, ok = parse_review(res.text, name)
            findings += f
            parsed = parsed and ok
        return grade_review(findings, parsed, case["bug"]), time.time() - t0
    except Exception as e:
        return Grade(False, f"agent error: {e!r}"), time.time() - t0
    finally:
        shutil.rmtree(cwd, ignore_errors=True)


async def run_stage(stage: str, agent: str, runs: int, jobs: int, timeout: float, only: set[str]) -> dict:
    cases = [c for c in load_cases(stage) if not only or c["id"] in only]
    fn = one_triage if stage == "triage" else one_review
    sem = asyncio.Semaphore(jobs)

    async def go(case):
        async with sem:
            g, secs = await fn(case, agent, timeout)
            print(f"  {'ok  ' if g.ok else 'FAIL'} {case['id']:<26} {secs:5.1f}s  {g.detail}", flush=True)
            return {"ok": g.ok, "detail": g.detail, "seconds": round(secs, 1)}

    results = await asyncio.gather(*[go(c) for c in cases for _ in range(runs)])
    out, i = {}, 0
    for c in cases:
        out[c["id"]] = results[i:i + runs]
        i += runs
    roles = ("product-manager",) if stage == "triage" else REVIEWERS
    return {"stage": stage, "agent": agent, "runs": runs, "when": time.strftime("%Y-%m-%d %H:%M"),
            "prompts": prompt_hash(roles), "cases": out}


def report(res: dict) -> None:
    per = {k: [r["ok"] for r in v] for k, v in res["cases"].items()}
    s = summarize(per)
    print(f"\n{res['stage']} / {res['agent']} / {res['runs']} run(s) per case   prompts: {res['prompts']}")
    for k, v in per.items():
        print(f"  {sum(v)}/{len(v)}  {k}")
    print(f"  overall {s.passed}/{s.total} = {s.rate:.0%}")
    if res["stage"] == "review":
        cases = {c["id"]: c for c in load_cases("review")}
        for label, want in (("bugs caught", True), ("false alarms avoided", False)):
            flat = [r["ok"] for k, v in res["cases"].items() if cases[k]["bug"] == want for r in v]
            print(f"  {label}: {sum(flat)}/{len(flat)}")
    secs = [r["seconds"] for v in res["cases"].values() for r in v]
    print(f"  avg {sum(secs) / len(secs):.0f}s per call")


def compare(a_path: str, b_path: str) -> None:
    a, b = (json.loads(Path(p).read_text()) for p in (a_path, b_path))
    print(f"A {a['when']} prompts {a['prompts']}\nB {b['when']} prompts {b['prompts']}")
    for k in sorted(set(a["cases"]) | set(b["cases"])):
        rate = lambda r, k=k: (lambda v: f"{sum(x['ok'] for x in v)}/{len(v)}" if v else "-")(r["cases"].get(k, []))  # noqa: E731
        print(f"  {k:<26} A {rate(a):<5} B {rate(b):<5}")
    sa, sb = (summarize({k: [x["ok"] for x in v] for k, v in r["cases"].items()}) for r in (a, b))
    print(f"  overall A {sa.rate:.0%}  B {sb.rate:.0%}  ({sb.rate - sa.rate:+.0%})")


def main() -> None:
    p = argparse.ArgumentParser(prog="evals")
    p.add_argument("stage", choices=["triage", "review", "compare"])
    p.add_argument("files", nargs="*", help="compare: two result files")
    p.add_argument("--agent", default="claude")
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--jobs", type=int, default=2, help="agent calls in parallel")
    p.add_argument("--timeout", type=float, default=300)
    p.add_argument("--only", default="", help="comma-separated case ids")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    if a.stage == "compare":
        compare(*a.files)
        return
    only = {x for x in a.only.split(",") if x}
    cases = [c for c in load_cases(a.stage) if not only or c["id"] in only]
    calls = len(cases) * a.runs * (1 if a.stage == "triage" else len(REVIEWERS))
    print(f"{a.stage}: {len(cases)} cases x {a.runs} runs = {calls} agent call(s) with {a.agent}")
    if a.dry_run:
        return
    res = asyncio.run(run_stage(a.stage, a.agent, a.runs, a.jobs, a.timeout, only))
    report(res)
    out = HERE / "results" / f"{a.stage}-{a.agent}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps(res, indent=2))
    print(f"saved {out}")


if __name__ == "__main__":
    main()
