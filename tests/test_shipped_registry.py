"""The shipped role and skill texts are code in disguise: the harness parses what they tell the model
to write. These tests fail if a prompt edit drifts away from the parsers."""
from looper.registry import LocalRegistry
from looper.review import extract_json, parse_review
from looper.triage import parse_triage

REG = LocalRegistry("registry")


def test_every_role_loads_and_every_referenced_skill_exists():
    roles = REG.list_roles()
    assert roles
    for role in roles:
        assert role.prompt.strip(), role.name
        for skill in role.skills:
            assert REG.get_skill(skill).strip(), f"{role.name} -> {skill}"


def test_both_reviewers_share_the_output_contract_and_cannot_write():
    for name in ("tech-reviewer", "product-reviewer"):
        role = REG.get_role(name)
        assert "review-output-contract" in role.skills and role.permissions == "ask"


def test_contract_example_is_parsed_by_the_review_parser():
    findings, ok = parse_review(REG.get_skill("review-output-contract"), "tech-reviewer")
    assert ok and len(findings) == 1 and findings[0].severity == "blocking"
    assert findings[0].file == "src/billing/invoice.py" and findings[0].line == 42


def test_product_manager_example_is_parsed_by_the_triage_parser():
    role = REG.get_role("product-manager")
    assert role.permissions == "ask"
    t = parse_triage(role.prompt)
    assert t is not None and t.actionable and t.size == "small"
    assert t.plan and t.acceptance_criteria and t.proposed_verify == "pytest tests/test_invoices.py -q"


def test_examples_are_plain_json_objects():
    assert isinstance(extract_json(REG.get_role("product-manager").prompt), dict)
