# Shared skill library

Registry → Ortak skill kütüphanesi lists installed skills and lets you search by name, source or description. Choose a workspace to include its project skills. Installed skills open as read-only previews; the existing local registry editor still creates and edits Looper-owned definitions.

Settings → Workspace’ler → Varsayılan skill’ler assigns skills to a project. Save settings after selecting. New chat sessions capture these defaults, and the task service reads workspace defaults on its next poll. Existing chats retain the defaults with which they were started.

In chat, type `#` and choose a skill, for example `#agents:frontend-design`. It applies to that message together with workspace defaults. Explicit IDs preserve the selected source. Legacy `#frontend-design` names remain usable; when names collide, discovery order determines the match. Prefer qualified selections from autocomplete.

Discovery order:

1. `<repo>/.agents/skills`, `.codex/skills`, `.claude/skills`, `skills`
2. Looper’s `<registry>/skills`
3. `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills`

Each source is separately identified (`project-agents:design`, `registry:design`, `agents:design`, etc.). Nested skill directories are supported to four levels and directory symlinks are followed with cycle detection. Discovery does not scan plugin caches or arbitrarily traverse the home directory. Use installed skill roots, or link a plugin’s skill directory into one of those roots.

The full SKILL.md is supplied along with its absolute source directory. Relative references and scripts can be read there by an agent whose tools permit it; no skill directory is copied or modified. Script execution and special connector availability depend on the agent and session. Chat remains read-only. The preview shows scripts/references and declared tool requirements, but does not promise that every named tool exists in every ACP agent.

Role skills and project defaults are combined without duplicate physical skill files. Built-in role contracts resolve from the local registry before project/global aliases, preserving reviewer behavior. Used skill IDs are recorded with each run prompt and displayed in its summary. Chat displays a “Skills” entry for the skills actually supplied to that turn. A missing or invalid selected skill produces an error instead of silently substituting a different source.

CLI examples:

```sh
uv run python -m looper.main --list-skills --repo /path/to/repo
uv run python -m looper.main --list-skills --global-skills
uv run python -m looper.main --read-skill agents:frontend-design --global-skills
uv run python -m looper.main --chat --repo /path/to/repo --skill agents:frontend-design
```

The same installed skill files must exist on the machine running the agent. Sharing workspace settings does not install skills on another computer.
