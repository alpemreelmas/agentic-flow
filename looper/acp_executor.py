"""Runs one prompt against a local coding CLI over ACP (JSON-RPC on stdio).

No API key: each CLI uses its own logged-in session (claude / gemini / codex).
"""
import asyncio
import sys
from collections.abc import Callable
from dataclasses import dataclass

import acp
from acp import schema

# command to launch each agent in ACP mode
AGENTS: dict[str, list[str]] = {
    "claude": ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    "gemini": ["gemini", "--acp"],
    "codex": ["npx", "-y", "@zed-industries/codex-acp"],
}


@dataclass
class RunResult:
    text: str
    stop_reason: str


MAX_FIELD = 20_000  # chars per field; a runaway tool output must not bloat the log


def _cap(v):
    if isinstance(v, str):
        return v if len(v) <= MAX_FIELD else v[:MAX_FIELD] + f"\n… [{len(v) - MAX_FIELD} more chars truncated]"
    if isinstance(v, list):
        return [_cap(x) for x in v]
    if isinstance(v, dict):
        return {k: _cap(x) for k, x in v.items()}
    return v


def _tool_event(kind: str, update) -> dict:
    """Keep what the user wants to read later: the command, its output, and file diffs."""
    d = update.model_dump(mode="json", exclude_none=True)
    ev = {"type": "tool_call" if kind == "tool_call" else "tool_update", "id": d["tool_call_id"]}
    for key in ("title", "status", "content", "raw_input", "raw_output", "locations"):
        if key in d:
            ev[key] = _cap(d[key])
    if "kind" in d:
        ev["tool_kind"] = d["kind"]  # read / edit / execute ...
    return ev


# Tool kinds that only look. Everything else (edit, delete, move, execute, ...) can change something.
READ_ONLY_KINDS = {"read", "search", "fetch", "think"}


def _hint(command) -> str:
    return getattr(getattr(command.input, "root", command.input), "hint", "") or ""


def describe_config(options) -> list[dict]:
    """Session config options (model, thinking level, ...) as plain dicts for the UI. Grouped
    select options are flattened; boolean options carry no choices."""
    out = []
    for o in options or []:
        o = getattr(o, "root", o)
        d = {"id": o.id, "name": o.name, "description": o.description or "", "category": o.category if isinstance(o.category, str) else "",
             "type": o.type, "value": o.current_value, "choices": []}
        for ch in getattr(o, "options", None) or []:
            for leaf in getattr(ch, "options", None) or [ch]:  # a group holds .options; a plain choice is its own leaf
                d["choices"].append({"value": leaf.value, "name": leaf.name, "description": leaf.description or ""})
        out.append(d)
    return out


class _Client(acp.Client):
    """Our side of the protocol: collect output, answer permission requests.

    policy="readonly" (the chat): approve only tool calls of a read-only kind; deny anything else,
    including calls that don't say what they are.
    """

    def __init__(self, auto_approve: bool, quiet: bool, on_event: Callable[[dict], None] | None = None,
                 policy: str = ""):
        self.policy = policy
        self.auto_approve = auto_approve
        self.quiet = quiet
        self.on_event = on_event or (lambda ev: None)
        self.chunks: list[str] = []

    async def request_permission(self, session_id, tool_call, options, **kwargs):
        allow = next((o for o in options if o.kind == "allow_once"), None)
        granted = bool(self.auto_approve and allow)
        if self.policy == "readonly":
            granted = bool(allow and getattr(tool_call, "kind", None) in READ_ONLY_KINDS)
        self.on_event({"type": "permission", "title": tool_call.title, "granted": granted})
        if granted:
            self._log(f"  [allow] {tool_call.title}")
            return acp.RequestPermissionResponse(
                outcome=schema.AllowedOutcome(outcome="selected", option_id=allow.option_id)
            )
        self._log(f"  [deny]  {tool_call.title}")
        return acp.RequestPermissionResponse(outcome=schema.DeniedOutcome(outcome="cancelled"))

    async def session_update(self, session_id, update, **kwargs):
        kind = update.session_update
        text = getattr(getattr(update, "content", None), "text", None)
        if kind == "agent_message_chunk" and text:
            self.chunks.append(text)
            self.on_event({"type": "agent_message", "text": text})
        elif kind == "agent_thought_chunk" and text:
            self.on_event({"type": "agent_thought", "text": text})
        elif kind in ("tool_call", "tool_call_update"):
            if kind == "tool_call":
                self._log(f"  [tool]  {update.title}")
            self.on_event(_tool_event(kind, update))
        elif kind == "plan":
            self.on_event({"type": "plan", "entries": [e.content for e in update.entries]})
        elif kind == "available_commands_update":
            self.on_event({"type": "commands", "commands": [
                {"name": c.name, "description": c.description, "hint": _hint(c)} for c in update.available_commands]})
        elif kind == "current_mode_update":
            self.on_event({"type": "mode", "id": update.current_mode_id})
        elif kind == "config_option_update":
            self.on_event({"type": "config_options", "options": describe_config(update.config_options)})

    def _log(self, msg: str):
        if not self.quiet:
            print(msg, file=sys.stderr, flush=True)


async def run_prompt(agent: str, cwd: str, prompt: str, *, timeout: float = 1800,
                     auto_approve: bool = True, quiet: bool = False,
                     on_event: Callable[[dict], None] | None = None) -> RunResult:
    client = _Client(auto_approve, quiet, on_event)
    cmd, *args = AGENTS[agent]
    async with acp.spawn_agent_process(client, cmd, *args, cwd=cwd) as (conn, _proc):
        await conn.initialize(protocol_version=acp.PROTOCOL_VERSION)
        session = await conn.new_session(cwd=cwd, mcp_servers=[])
        resp = await asyncio.wait_for(
            conn.prompt(session_id=session.session_id, prompt=[acp.text_block(prompt)]),
            timeout=timeout,
        )
    return RunResult("".join(client.chunks), str(resp.stop_reason))
