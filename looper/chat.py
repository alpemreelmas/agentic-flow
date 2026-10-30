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
import os
import sys

import acp

from pathlib import Path

from .acp_executor import AGENTS, _Client, describe_config, initialize_connection, cancel_turn
from .bridge import clean_agent_env, mcp_server

PREAMBLE = (
    "You are a brainstorming partner for the project in the current directory. Think out loud with "
    "the user: ask clarifying questions, compare options with trade-offs, point at relevant files you "
    "have read. You may read and search the code; you cannot edit files or run commands, so do not "
    "try. If application Linear tools are connected, use them to read, create and edit tasks when "
    "the user requests it. Creating a task means a draft, not autonomous execution. ONLY call "
    "linear_submit_issue when the user explicitly asks to hand work to the autonomous loop. "
    "Read metadata before creating, and read the issue before editing/submitting; use its updatedAt. "
    "Use a unique request_id for each create and reuse it on retry, especially after a timeout. "
    "Use selected skills for task preparation. Never claim a write succeeded without a tool result. "
    "If tools are unavailable, explain the connection problem; do not pretend to create tasks.\n\n"
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


async def run_chat(agent: str, cwd: str, *, registry: str = "registry", skills=()) -> None:
    descriptor_text = os.environ.pop("LOOPER_BRIDGE_DESCRIPTOR", "")
    descriptor = json.loads(descriptor_text) if descriptor_text else None
    if descriptor and agent == "gemini":
        descriptor = None
        _emit({"type": "bridge_status", "available": False,
               "message": "Gemini adaptörü MCP izinlerinde araç kimliği iletmiyor; Linear araçları için Claude veya Codex ile sohbet açın."})
    client = _Client(auto_approve=True, quiet=True, on_event=_emit, policy="readonly", retain_messages=False)
    client.bridge_server = descriptor["name"] if descriptor else None
    client.bridge_adapter = agent
    cmd, *args = AGENTS[agent]
    async with acp.spawn_agent_process(client, cmd, *args, cwd=cwd, env=clean_agent_env()) as (conn, _proc):
        initialized = await initialize_connection(conn)
        servers = [mcp_server(descriptor)] if descriptor else []
        try:
            session = await asyncio.wait_for(conn.new_session(cwd=cwd, mcp_servers=servers), 30)
        except Exception:
            if not servers:
                raise
            client.bridge_server = None
            _emit({"type": "bridge_status", "available": False,
                   "message": "Agent MCP bağlantısını açamadı; Linear araçları kapalı. Sohbeti yeniden açmayı deneyin."})
            session = await asyncio.wait_for(conn.new_session(cwd=cwd, mcp_servers=[]), 30)
        modes = getattr(session, "modes", None)
        _emit({"type": "ready", "agent": agent, "cwd": cwd, "default_skills": list(skills),
               "bridge_available": bool(client.bridge_server),
               "protocol_version": initialized.protocol_version,
               "agent_info": initialized.agent_info.model_dump(mode="json") if initialized.agent_info else None,
               "modes": {"current": modes.current_mode_id, "available": [
                   {"id": m.id, "name": m.name, "description": m.description or ""} for m in modes.available_modes]} if modes else None,
               "config_options": describe_config(getattr(session, "config_options", None))})
        turn: asyncio.Task | None = None
        first = True

        async def do_turn(text: str, files: list[str], selected: list[str]):
            try:
                from .skills import compose, discover
                context, used = compose(discover(registry, cwd), [*skills, *selected])
                _emit({"type": "skills_used", "skills": used})
                blocks = [acp.text_block((context + "\n\n" if context else "") + text), *_file_blocks(cwd, files)]
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
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "prompt" and str(msg.get("text", "")).strip():
                if turn and not turn.done():
                    _emit({"type": "error", "error": "the agent is still answering"})
                    continue
                selected = msg.get("skills", [])
                if not isinstance(selected, list) or len(selected) > 32 or not all(isinstance(s, str) for s in selected):
                    _emit({"type": "error", "error": "Invalid skill selection"})
                    continue
                text = str(msg["text"])
                turn = asyncio.create_task(do_turn((PREAMBLE if first else "") + text, [str(f) for f in msg.get("files") or []], selected))
                first = False
            elif msg.get("type") == "set_mode" and isinstance(msg.get("id"), str):
                try:
                    if turn and not turn.done():
                        raise RuntimeError("Wait for the current reply before changing mode")
                    await asyncio.wait_for(conn.set_session_mode(session_id=session.session_id, mode_id=msg["id"]), 15)
                    _emit({"type": "mode", "id": msg["id"]})
                except Exception as e:
                    _emit({"type": "error", "error": f"could not change mode: {e}"})
            elif msg.get("type") == "set_config" and isinstance(msg.get("id"), str):
                try:
                    if turn and not turn.done():
                        raise RuntimeError("Wait for the current reply before changing model")
                    resp = await asyncio.wait_for(conn.set_config_option(config_id=msg["id"], session_id=session.session_id, value=msg.get("value")), 15)
                    if resp is not None:
                        _emit({"type": "config_options", "options": describe_config(resp.config_options)})
                except Exception as e:
                    _emit({"type": "error", "error": f"could not change {msg['id']}: {e}"})
            elif msg.get("type") == "cancel" and turn and not turn.done():
                try:
                    await cancel_turn(conn, session.session_id, turn)
                except Exception as e:
                    _emit({"type": "error", "error": f"Cancellation failed; close and reopen this chat: {e}"})
                    break
        if turn and not turn.done():
            turn.cancel()
            await asyncio.gather(turn, return_exceptions=True)
