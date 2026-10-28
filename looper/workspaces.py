"""Workspaces: a local git checkout plus the Linear project whose tasks belong in it.

The desktop app writes workspaces.json; the service reads it. A task is routed by its Linear
project. A task whose project matches no enabled workspace is NOT run: guessing a repo would write
code into the wrong one.
"""
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Workspace:
    name: str
    repo: str
    project_id: str | None = None
    enabled: bool = True


def load(path: str | Path) -> list[Workspace]:
    raw = json.loads(Path(path).read_text())
    return [Workspace(name=str(w["name"]), repo=str(w["repo"]), project_id=w.get("project_id") or None,
                      enabled=w.get("enabled", True) is not False) for w in raw]


def route(task: dict, workspaces: list[Workspace]) -> Workspace | None:
    """The enabled workspace for this task, or None (task is left alone).

    Match by Linear project. The one exception: a lone workspace with no project configured takes
    everything, which is how a single-repo setup keeps working without choosing a project.
    """
    pid = task.get("project_id")
    for w in workspaces:
        if w.project_id and w.project_id == pid:
            return w if w.enabled else None
    if len(workspaces) == 1 and workspaces[0].project_id is None and workspaces[0].enabled:
        return workspaces[0]
    return None
