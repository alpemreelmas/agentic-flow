"""Where tasks come from. FileSource runs with zero setup; LinearSource needs a Linear key."""
import json
import os
from pathlib import Path
from typing import NotRequired, Protocol, TypedDict

import httpx


class Task(TypedDict):
    id: str
    title: str
    description: str
    verify: str  # shell command; exit 0 = done
    role: NotRequired[str]  # registry role; default implementer
    verified: NotRequired[bool]  # False = no real verification command (draft PR)
    labels: NotRequired[list[str]]


class TaskSource(Protocol):
    def fetch_ready(self) -> list[Task]: ...
    def mark_in_progress(self, task_id: str) -> None: ...
    def comment(self, task_id: str, body: str) -> None: ...
    def finish(self, task_id: str, status: str, comment: str) -> None: ...


class FileSource:
    """tasks.json: [{"id","title","description","verify","status"}]. status: todo|in_progress|review|needs_human."""

    def __init__(self, path: str):
        self.path = Path(path)

    def _load(self) -> list[dict]:
        return json.loads(self.path.read_text())

    def _save(self, tasks: list[dict]) -> None:
        self.path.write_text(json.dumps(tasks, indent=2, ensure_ascii=False))

    def fetch_ready(self) -> list[Task]:
        return [t for t in self._load() if t.get("status", "todo") in ("todo", "in_progress")]

    def _set(self, task_id: str, status: str, comment: str = "") -> None:
        tasks = self._load()
        for t in tasks:
            if t["id"] == task_id:
                t["status"] = status
                if comment:
                    t["comment"] = comment
        self._save(tasks)

    def mark_in_progress(self, task_id: str) -> None:
        self._set(task_id, "in_progress")

    def comment(self, task_id: str, body: str) -> None:
        tasks = self._load()
        for t in tasks:
            if t["id"] == task_id:
                t.setdefault("notes", []).append(body)
        self._save(tasks)

    def finish(self, task_id: str, status: str, comment: str) -> None:
        self._set(task_id, status, comment)


class LinearSource:
    """Linear GraphQL. Needs LINEAR_API_KEY (a free personal key: Settings > Security & access > API).

    Picks issues that carry label `label` and sit in `ready` or `progress` state ("progress" so a
    crashed run resumes). Per issue:
      - verify command: a ```verify fenced block in the description, else `default_verify`
      - role: a label named `role:<name>` (e.g. role:reviewer), else the default role
    Finished tasks move to `review`; abandoned ones to `blocked`, which must NOT be a state this
    source polls, or the loop would pick the same task up forever.
    """
    URL = "https://api.linear.app/graphql"

    def __init__(self, label="agent", ready="Todo", progress="In Progress", review="In Review",
                 blocked="Backlog", default_verify="true"):
        self.h = {"Authorization": os.environ["LINEAR_API_KEY"]}  # personal keys take no "Bearer"
        self.label, self.ready, self.progress, self.default_verify = label, ready, progress, default_verify
        self.states = {"in_progress": progress, "review": review, "needs_human": blocked}
        if blocked in (ready, progress):
            raise ValueError(f"blocked state {blocked!r} is polled by the loop; pick another")
        self._team: dict[str, str] = {}

    def _gql(self, query: str, variables: dict | None = None) -> dict:
        r = httpx.post(self.URL, json={"query": query, "variables": variables or {}}, headers=self.h, timeout=30)
        r.raise_for_status()
        body = r.json()
        if body.get("errors"):  # Linear reports GraphQL errors with HTTP 200
            raise RuntimeError(body["errors"])
        return body["data"]

    def fetch_ready(self) -> list[Task]:
        q = """query($states:[String!]){ issues(first:100, filter:{state:{name:{in:$states}}}) {
                 nodes { id identifier title description team { id } labels { nodes { name } } } } }"""
        out = []
        for n in self._gql(q, {"states": [self.ready, self.progress]})["issues"]["nodes"]:
            labels = [l["name"] for l in n["labels"]["nodes"]]
            if self.label not in labels:  # filtered here: the nested label filter syntax is unverified
                continue
            self._team[n["id"]] = n["team"]["id"]
            desc = n["description"] or ""
            role = next((l.split(":", 1)[1] for l in labels if l.startswith("role:")), None)
            task = Task(id=n["id"], title=f'{n["identifier"]} {n["title"]}',
                        description=desc, verify=self._verify_cmd(desc), verified="```verify" in desc, labels=labels)
            if role:
                task["role"] = role
            out.append(task)
        return out

    def list_queue(self) -> list[dict]:
        """Read-only snapshot for the UI: every labelled issue in a state this loop cares about."""
        q = """query($states:[String!]){ issues(first:100, orderBy:updatedAt, filter:{state:{name:{in:$states}}}) {
                 nodes { id identifier title url updatedAt state { name } labels { nodes { name } } } } }"""
        states = list(dict.fromkeys([self.ready, self.progress, *self.states.values()]))
        out = []
        for n in self._gql(q, {"states": states})["issues"]["nodes"]:
            labels = [l["name"] for l in n["labels"]["nodes"]]
            if self.label not in labels:
                continue
            out.append({"id": n["id"], "identifier": n["identifier"], "title": n["title"], "url": n.get("url") or "",
                        "state": n["state"]["name"], "updated_at": n.get("updatedAt") or "", "labels": labels})
        return out

    def _verify_cmd(self, desc: str) -> str:
        if "```verify" in desc:
            return desc.split("```verify", 1)[1].split("```", 1)[0].strip()
        return self.default_verify

    def _set_state(self, issue_id: str, name: str) -> None:
        q = """query($t:ID!,$n:String!){ workflowStates(filter:{team:{id:{eq:$t}},name:{eq:$n}}){nodes{id}} }"""
        nodes = self._gql(q, {"t": self._team[issue_id], "n": name})["workflowStates"]["nodes"]
        if not nodes:
            raise RuntimeError(f"Linear has no workflow state named {name!r} on this team")
        self._gql("mutation($i:String!,$s:String!){issueUpdate(id:$i,input:{stateId:$s}){success}}",
                  {"i": issue_id, "s": nodes[0]["id"]})

    def mark_in_progress(self, task_id: str) -> None:
        self._set_state(task_id, self.states["in_progress"])

    def comment(self, task_id: str, body: str) -> None:
        self._gql("mutation($i:String!,$b:String!){commentCreate(input:{issueId:$i,body:$b}){success}}",
                  {"i": task_id, "b": body})

    def finish(self, task_id: str, status: str, comment: str) -> None:
        self.comment(task_id, comment)
        self._set_state(task_id, self.states[status])

    def diagnose(self) -> str:
        """Read-only setup check: who am I, which states exist per team, what would be picked up."""
        d = self._gql("query { viewer { name } teams { nodes { name states { nodes { name } } } } }")
        lines = [f"signed in as {d['viewer']['name']}"]
        wanted = {self.ready, self.progress, *self.states.values()}
        for t in d["teams"]["nodes"]:
            have = {s["name"] for s in t["states"]["nodes"]}
            lines.append(f"team {t['name']}: states {sorted(have)}")
            for missing in sorted(wanted - have):
                lines.append(f"  ! state {missing!r} does not exist on this team")
        lines.append(f"issues that would be picked up now (label {self.label!r}): {len(self.fetch_ready())}")
        return "\n".join(lines)
