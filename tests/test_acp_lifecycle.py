import asyncio
from types import SimpleNamespace

import acp
import pytest

from looper.acp_executor import _Client, cancel_turn, initialize_connection


def test_initialize_rejects_incompatible_protocol_and_advertises_no_file_writes():
    class Connection:
        async def initialize(self, **kwargs):
            assert kwargs['client_capabilities'].fs is None
            assert kwargs['client_capabilities'].terminal is False
            return SimpleNamespace(protocol_version=acp.PROTOCOL_VERSION + 1)
    with pytest.raises(RuntimeError, match='version mismatch'):
        asyncio.run(initialize_connection(Connection()))


def test_initialize_is_bounded():
    class Connection:
        async def initialize(self, **kwargs):
            await asyncio.sleep(10)
    with pytest.raises(TimeoutError):
        asyncio.run(initialize_connection(Connection(), timeout=.01))


def test_cancel_waits_for_agent_acknowledgement():
    async def scenario():
        acknowledged = asyncio.Event()
        async def answer():
            await acknowledged.wait()
            return 'cancelled'
        class Connection:
            async def cancel(self, **kwargs):
                acknowledged.set()
        turn = asyncio.create_task(answer())
        await cancel_turn(Connection(), 'session', turn, grace=.1)
        assert turn.result() == 'cancelled'
    asyncio.run(scenario())


def test_cancel_unresponsive_agent_drains_local_task():
    async def scenario():
        class Connection:
            async def cancel(self, **kwargs):
                pass
        turn = asyncio.create_task(asyncio.sleep(10))
        with pytest.raises(TimeoutError):
            await cancel_turn(Connection(), 'session', turn, grace=.01)
        assert turn.cancelled()
    asyncio.run(scenario())


def test_chat_stream_does_not_retain_duplicate_message_buffer():
    from acp import schema
    client = _Client(True, True, retain_messages=False)
    asyncio.run(client.session_update('s', schema.AgentMessageChunk(
        session_update='agent_message_chunk', content=schema.TextContentBlock(type='text', text='hi'))))
    assert client.chunks == []
