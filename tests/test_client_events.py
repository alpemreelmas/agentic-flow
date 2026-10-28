import asyncio

from acp import schema

from looper.acp_executor import _Client


def collect(*updates):
    events = []
    client = _Client(auto_approve=True, quiet=True, on_event=events.append)
    for u in updates:
        asyncio.run(client.session_update("s1", u))
    return events, client


def test_maps_real_acp_updates_to_events():
    events, client = collect(
        schema.AgentMessageChunk(session_update="agent_message_chunk",
                                 content=schema.TextContentBlock(type="text", text="hi")),
        schema.AgentThoughtChunk(session_update="agent_thought_chunk",
                                 content=schema.TextContentBlock(type="text", text="hmm")),
        schema.ToolCallStart(session_update="tool_call", tool_call_id="t1", title="Terminal"),
        schema.ToolCallProgress(session_update="tool_call_update", tool_call_id="t1", status="completed"),
        schema.AgentPlanUpdate(session_update="plan", entries=[
            schema.PlanEntry(content="step one", priority="medium", status="pending")]),
    )
    assert [e["type"] for e in events] == ["agent_message", "agent_thought", "tool_call", "tool_update", "plan"]
    assert events[2]["title"] == "Terminal" and events[4]["entries"] == ["step one"]
    assert client.chunks == ["hi"]  # only the message text becomes the run summary


def test_tool_events_keep_command_output_and_diff():
    events, _ = collect(
        schema.ToolCallStart(session_update="tool_call", tool_call_id="t1", title="Terminal", kind="execute",
                             raw_input={"command": "ls calc*"}),
        schema.ToolCallProgress(
            session_update="tool_call_update", tool_call_id="t1", status="completed",
            content=[
                schema.ContentToolCallContent(type="content",
                                              content=schema.TextContentBlock(type="text", text="calc.py")),
                schema.FileEditToolCallContent(type="diff", path="calc.py", old_text="a - b", new_text="a + b"),
            ],
            raw_output="calc.py"),
    )
    start, update = events
    assert start["raw_input"] == {"command": "ls calc*"} and start["tool_kind"] == "execute"
    assert update["status"] == "completed" and update["raw_output"] == "calc.py"
    assert [c["type"] for c in update["content"]] == ["content", "diff"]
    assert update["content"][1]["new_text"] == "a + b"


def test_huge_tool_output_is_truncated():
    from looper.acp_executor import MAX_FIELD

    events, _ = collect(schema.ToolCallProgress(
        session_update="tool_call_update", tool_call_id="t1", raw_output="x" * (MAX_FIELD * 2)))
    assert len(events[0]["raw_output"]) < MAX_FIELD + 100 and "truncated" in events[0]["raw_output"]
