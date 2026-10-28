import asyncio
from types import SimpleNamespace

import acp

from looper.acp_executor import _Client


def _ask(kind):
    client = _Client(auto_approve=True, quiet=True, policy="readonly")
    opts = [SimpleNamespace(kind="allow_once", option_id="yes")]
    call = SimpleNamespace(title="t", kind=kind)
    return asyncio.run(client.request_permission("s", call, opts))


def test_readonly_policy_allows_looking_and_denies_everything_else():
    for kind in ("read", "search", "fetch", "think"):
        assert _ask(kind).outcome.outcome == "selected", kind
    for kind in ("edit", "delete", "move", "execute", "other", None):
        assert _ask(kind).outcome.outcome == "cancelled", kind


def test_default_policy_is_unchanged_for_the_loop():
    client = _Client(auto_approve=True, quiet=True)
    opts = [SimpleNamespace(kind="allow_once", option_id="yes")]
    out = asyncio.run(client.request_permission("s", SimpleNamespace(title="t", kind="execute"), opts))
    assert out.outcome.outcome == "selected"


def test_describe_config_flattens_groups_and_keeps_category():
    from acp import schema
    from looper.acp_executor import describe_config
    opt = schema.SessionConfigOptionSelect(
        id="model", name="Model", category="model", current_value="a", type="select",
        options=[schema.SessionConfigSelectOption(value="a", name="Alpha"), schema.SessionConfigSelectOption(value="b", name="Beta", description="fast")])
    d = describe_config([opt])[0]
    assert d["category"] == "model" and d["value"] == "a"
    assert [c["value"] for c in d["choices"]] == ["a", "b"] and d["choices"][1]["description"] == "fast"


def test_file_mentions_cannot_escape_the_workspace(tmp_path):
    from looper.chat import _file_blocks
    (tmp_path / "ok.py").write_text("x")
    (tmp_path.parent / "secret.txt").write_text("s")
    blocks = _file_blocks(str(tmp_path), ["ok.py", "../secret.txt", "/etc/hosts", "missing.py"])
    assert [b.name for b in blocks] == ["ok.py"]
