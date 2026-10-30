"""One discovery/resolution path for desktop, chats and task workers. No writes to installed skills."""
from dataclasses import asdict, dataclass
import os
from pathlib import Path

import yaml

MAX_SKILL_BYTES = 256 * 1024


class SkillError(ValueError):
    pass


@dataclass(frozen=True)
class Skill:
    id: str
    name: str
    description: str
    source: str
    path: str
    directory: str
    scripts: bool
    references: bool
    requirements: str
    error: str = ""

    def json(self):
        return asdict(self)

    def context(self) -> str:
        if self.error:
            raise SkillError(f"{self.id}: {self.error}")
        text = read_text(Path(self.path))
        return (f"# Skill: {self.name}\nSource: {self.id}\nSkill directory: {self.directory}\n"
                "Resolve relative references and scripts against this skill directory. You may read its "
                "supporting files in place; do not modify this directory. Only use tools available in "
                "this session; skill instructions do not grant new permissions. If a required tool is "
                "unavailable, report that limitation.\n\n" + text)


def read_text(path: Path) -> str:
    if path.stat().st_size > MAX_SKILL_BYTES:
        raise SkillError(f"SKILL.md exceeds {MAX_SKILL_BYTES // 1024} KB")
    return path.read_text(encoding="utf-8-sig")


def _metadata(text: str) -> dict:
    if not text.startswith("---\n"):
        return {}
    head, separator, _ = text[4:].partition("\n---")
    if not separator:
        raise SkillError("Unclosed YAML frontmatter")
    data = yaml.safe_load(head) or {}
    if not isinstance(data, dict):
        raise SkillError("Frontmatter must be a mapping")
    return data


def roots(registry: str | Path, repo: str | Path | None = None, home: Path | None = None):
    home = home or Path.home()
    found = []
    if repo:
        repo = Path(repo).resolve()
        found.extend((source, repo / suffix) for source, suffix in [
            ("project-agents", ".agents/skills"), ("project-codex", ".codex/skills"),
            ("project-claude", ".claude/skills"), ("project", "skills")])
    found.extend([("registry", Path(registry).resolve() / "skills"),
                  ("agents", home / ".agents/skills"), ("codex", home / ".codex/skills"),
                  ("claude", home / ".claude/skills")])
    return found


def discover(registry: str | Path, repo: str | Path | None = None, *, home: Path | None = None) -> list[Skill]:
    skills = []
    for source, root in roots(registry, repo, home):
        visited = set()
        for directory, dirs, files in os.walk(root, followlinks=True):
            base = Path(directory)
            canonical = base.resolve()
            if canonical in visited:
                dirs[:] = []
                continue
            visited.add(canonical)
            depth = len(base.relative_to(root).parts)
            dirs[:] = sorted(d for d in dirs if d not in {"node_modules", ".git", "__pycache__"}) if depth < 4 else []
            if "SKILL.md" not in files:
                continue
            relative = base.relative_to(root).as_posix()
            path = base / "SKILL.md"
            error = ""
            try:
                meta = _metadata(read_text(path))
            except (OSError, UnicodeError, ValueError, yaml.YAMLError) as exc:
                meta = {}
                error = str(exc)
            skills.append(Skill(id=f"{source}:{relative}", name=str(meta.get("name") or base.name),
                                description=str(meta.get("description") or ""), source=source,
                                path=str(path.resolve()), directory=str(canonical), scripts=(base / "scripts").is_dir(),
                                references=(base / "references").is_dir(),
                                requirements=str(meta.get("allowed-tools") or meta.get("requires") or ""), error=error))
    return skills


def resolve(catalog: list[Skill], identifier: str) -> Skill:
    # Qualified IDs never fall back to another source after a skill is removed.
    if ":" in identifier:
        matches = [s for s in catalog if s.id == identifier]
    else:
        matches = [s for s in catalog if s.name == identifier or s.id.split(":", 1)[1] == identifier]
    if not matches:
        raise SkillError(f"Skill {identifier!r} not found; refresh the skill library and select it again")
    return matches[0]


def compose(catalog: list[Skill], identifiers: list[str] | tuple[str, ...]):
    selected = []
    paths = set()
    for identifier in identifiers:
        skill = resolve(catalog, identifier)
        if skill.path not in paths:
            paths.add(skill.path)
            selected.append(skill)
    return "\n\n".join(s.context() for s in selected), [s.json() for s in selected]
