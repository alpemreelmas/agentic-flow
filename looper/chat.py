"""Brainstorming chat over ACP. One long-lived agent session, driven through JSON lines.

stdin  (from the desktop app):  {"type":"prompt","text":"..."}  |  {"type":"cancel"}
stdout (to the desktop app):    the same event objects the run log uses (agent_message, agent_thought,
                                tool_call, tool_update, permission, plan) plus
                                {"type":"ready"} | {"type":"turn_end","stop_reason":...} | {"type":"error","error":...}

The agent runs in the workspace's repo so it can read the code, but under a read-only permission
policy: it cannot edit files or run commands. Brainstorming never changes the checkout.
"""
import asyncio
import json
import sys

import acp

from pathlib import Path

from .acp_executor import AGENTS, _Client, describe_config

PREAMBLE = (
    "You are a brainstorming partner for the project in the current directory. Think out loud with "
    "the user: ask clarifying questions, compare options with trade-offs, point at relevant files you "
    "have read. You may read and search the code; you cannot edit files or run commands, so do not "
    "try. When an idea is ready, say how it would be written up as a Linear task.\n\n"
)


def _emit(ev: dict) -> None:
    print(json.dumps(ev, ensure_ascii=False), flush=True)


async def _stdin_lines():
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    while line := await reader.readline():
        yield line.decode("utf-8", "replace").strip()


def _file_blocks(cwd: str, files: list[str]) -> list:
    """@-mentioned files as resource links. Anything that resolves outside the workspace is dropped:
    the chat can point the agent at project files only."""
    root = Path(cwd).resolve()
    blocks = []
    for f in files[:20]:
        p = (root / f).resolve()
        if p.is_file() and root in p.parents:
            blocks.append(acp.resource_link_block(name=f, uri=p.as_uri()))
    return blocks


async def run_chat(agent: str, cwd: str) -> None:
    client = _Client(auto_approve=True, quiet=True, on_event=_emit, policy="readonly")
    cmd, *args = AGENTS[agent]
    async with acp.spawn_agent_process(client, cmd, *args, cwd=cwd) as (conn, _proc):
        await conn.initialize(protocol_version=acp.PROTOCOL_VERSION)
        session = await conn.new_session(cwd=cwd, mcp_servers=[])
        modes = getattr(session, "modes", None)
        _emit({"type": "ready", "agent": agent, "cwd": cwd,
               "modes": {"current": modes.current_mode_id, "available": [
                   {"id": m.id, "name": m.name, "description": m.description or ""} for m in modes.available_modes]} if modes else None,
               "config_options": describe_config(getattr(session, "config_options", None))})
        turn: asyncio.Task | None = None
        first = True

        async def do_turn(text: str, files: list[str]):
            try:
                blocks = [acp.text_block(text), *_file_blocks(cwd, files)]
                resp = await conn.prompt(session_id=session.session_id, prompt=blocks)
                _emit({"type": "turn_end", "stop_reason": str(resp.stop_reason)})
            except asyncio.CancelledError:
                _emit({"type": "turn_end", "stop_reason": "cancelled"})
            except Exception as e:  # keep the chat alive; the UI shows the error
                _emit({"type": "error", "error": str(e)})
                _emit({"type": "turn_end", "stop_reason": "error"})

        async for line in _stdin_lines():
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "prompt" and str(msg.get("text", "")).strip():
                if turn and not turn.done():
                    _emit({"type": "error", "error": "the agent is still answering"})
                    continue
                text = str(msg["text"])
                turn = asyncio.create_task(do_turn((PREAMBLE if first else "") + text, [str(f) for f in msg.get("files") or []]))
                first = False
            elif msg.get("type") == "set_mode" and isinstance(msg.get("id"), str):
                try:
                    await conn.set_session_mode(session_id=session.session_id, mode_id=msg["id"])
                    _emit({"type": "mode", "id": msg["id"]})
                except Exception as e:
                    _emit({"type": "error", "error": f"could not change mode: {e}"})
            elif msg.get("type") == "set_config" and isinstance(msg.get("id"), str):
                try:
                    resp = await conn.set_config_option(config_id=msg["id"], session_id=session.session_id, value=msg.get("value"))
                    if resp is not None:
                        _emit({"type": "config_options", "options": describe_config(resp.config_options)})
                except Exception as e:
                    _emit({"type": "error", "error": f"could not change {msg['id']}: {e}"})
            elif msg.get("type") == "cancel" and turn and not turn.done():
                cancel = getattr(conn, "cancel", None)
                if cancel:
                    await cancel(session_id=session.session_id)
                turn.cancel()
        if turn and not turn.done():
            turn.cancel()
