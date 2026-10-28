import pytest

from looper.registry import LocalRegistry, RegistryError, compose_prompt

REG = "registry"


def test_lists_shipped_roles():
    assert {r.name for r in LocalRegistry(REG).list_roles()} == {"implementer", "tech-reviewer", "product-reviewer", "product-manager"}


def test_tech_reviewer_is_read_only_and_has_skill():
    r = LocalRegistry(REG).get_role("tech-reviewer")
    assert r.permissions == "ask" and r.skills == ("review-output-contract", "review-checklist")


def test_compose_inlines_role_skill_and_task():
    reg = LocalRegistry(REG)
    out = compose_prompt(reg, reg.get_role("tech-reviewer"), "do X")
    assert "# Role: tech-reviewer" in out and "security" in out and out.endswith("# Task\ndo X")


def test_unknown_role_and_bad_cli(tmp_path):
    (tmp_path / "roles").mkdir()
    (tmp_path / "roles" / "bad.md").write_text("---\ncli: nope\n---\nbody")
    reg = LocalRegistry(tmp_path)
    with pytest.raises(RegistryError, match="not found"):
        reg.get_role("ghost")
    with pytest.raises(RegistryError, match="unknown cli"):
        reg.get_role("bad")


def test_bad_yaml_gives_an_actionable_error(tmp_path):
    (tmp_path / "roles").mkdir()
    (tmp_path / "roles" / "r.md").write_text("---\ndescription: a diff: broken\n---\nbody")
    with pytest.raises(RegistryError, match="quote values"):
        LocalRegistry(tmp_path).get_role("r")
