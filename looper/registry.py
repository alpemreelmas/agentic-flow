"""Role + skill registry. Roles are data (markdown with frontmatter), not code.

`Registry` is the seam: LocalRegistry reads files (git-versioned); a remote
(gRPC) implementation can replace it later without touching the graph.
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import yaml

from .acp_executor import AGENTS

PERMISSIONS = ("auto", "ask")


class RegistryError(Exception):
    pass


@dataclass(frozen=True)
class Role:
    name: str
    description: str
    cli: str                    # key of acp_executor.AGENTS
    permissions: str            # auto = approve tool calls, ask = deny them
    skills: tuple[str, ...]
    prompt: str                 # system prompt (markdown body)


class Registry(Protocol):
    def get_role(self, name: str) -> Role: ...
    def list_roles(self) -> list[Role]: ...
    def get_skill(self, name: str) -> str: ...


def _split_frontmatter(path: Path) -> tuple[dict, str]:
    text = path.read_text()
    if not text.startswith("---\n") or "\n---" not in text[4:]:
        raise RegistryError(f"{path}: missing '---' frontmatter")
    head, _, body = text[4:].partition("\n---")
    try:
        meta = yaml.safe_load(head) or {}
    except yaml.YAMLError as e:  # typically an unquoted ": " inside a value such as description
        raise RegistryError(f"{path}: invalid frontmatter YAML (quote values containing ': '): {e}") from e
    if not isinstance(meta, dict):
        raise RegistryError(f"{path}: frontmatter must be a mapping")
    return meta, body.lstrip("\n").strip()


class LocalRegistry:
    """root/roles/<name>.md and root/skills/<name>/SKILL.md"""

    def __init__(self, root: str | Path, *, repo: str | None = None, skills=()):
        self.root = Path(root)
        self.repo = repo
        self.default_skills = tuple(skills)
        self.used_skills = []
        self._catalog = None

    def for_workspace(self, repo: str, skills=()):
        return LocalRegistry(self.root, repo=repo, skills=skills)


    def _role_from(self, path: Path) -> Role:
        meta, body = _split_frontmatter(path)
        cli = meta.get("cli", "claude")
        perms = meta.get("permissions", "auto")
        if cli not in AGENTS:
            raise RegistryError(f"{path}: unknown cli {cli!r}, expected one of {sorted(AGENTS)}")
        if perms not in PERMISSIONS:
            raise RegistryError(f"{path}: permissions must be one of {PERMISSIONS}")
        return Role(name=meta.get("name", path.stem), description=meta.get("description", ""),
                    cli=cli, permissions=perms, skills=tuple(meta.get("skills") or ()), prompt=body)

    def get_role(self, name: str) -> Role:
        path = self.root / "roles" / f"{name}.md"
        if not path.exists():
            raise RegistryError(f"role {name!r} not found at {path}")
        return self._role_from(path)

    def list_roles(self) -> list[Role]:
        return [self._role_from(p) for p in sorted((self.root / "roles").glob("*.md"))]

    def get_skill(self, name: str) -> str:
        from .skills import discover, resolve
        if self._catalog is None:
            self._catalog = discover(self.root, self.repo)
        skill = resolve(self._catalog, name)
        if not any(s["path"] == skill.path for s in self.used_skills):
            self.used_skills.append(skill.json())
        return skill.context()



def compose_prompt(registry: Registry, role: Role, task_prompt: str) -> str:
    """Role prompt + inlined skills + the task. Inlining works for every ACP CLI."""
    parts = [f"# Role: {role.name}\n{role.prompt}"]
    registry.used_skills = []
    selected = list(role.skills) + list(getattr(registry, "default_skills", ()))
    seen = set()
    for skill in selected:
        # Role contracts shipped in the registry retain their original meaning.
        identifier = skill
        if skill in role.skills and ":" not in skill and isinstance(registry, LocalRegistry):
            if (registry.root / "skills" / skill / "SKILL.md").is_file():
                identifier = "registry:" + skill
        context = registry.get_skill(identifier)
        if context not in seen:
            seen.add(context)
            parts.append(f"# Skill: {skill}\n{context}")
    parts.append(f"# Task\n{task_prompt}")
    return "\n\n".join(parts)
