"""Tests for the Anthropic SDK wrapper used by the auto-rename modal
(THI-67). The actual `messages.create` round-trip is NOT exercised — that's
a fee-per-call upstream API. We test the prompt builder, the response parser,
the cost math, and the missing-key surface."""

from __future__ import annotations

import pytest

from switchboard.services import anthropic_client
from switchboard.services.anthropic_client import (
    AnthropicConfigError,
    AnthropicResponseError,
    build_rename_prompt,
    estimate_cost,
    get_client,
    parse_rename_response,
)

# --- get_client / missing key ----------------------------------------------


def test_get_client_raises_without_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(anthropic_client.settings, "anthropic_api_key", None)
    anthropic_client.reset_client_for_tests()
    with pytest.raises(AnthropicConfigError):
        get_client()


# --- prompt builder --------------------------------------------------------


def test_build_rename_prompt_renders_basic_window() -> None:
    prompt = build_rename_prompt(
        [{"index": 1, "current_name": "shell"}],
    )
    assert "[index 1] current_name='shell'" in prompt
    # Schema instructions present.
    assert "Return ONLY a JSON object" in prompt
    assert '{"1": "fs-build"' in prompt


def test_build_rename_prompt_includes_branch_and_pr() -> None:
    prompt = build_rename_prompt(
        [
            {
                "index": 2,
                "current_name": "claude",
                "branch": "feature/x",
                "pr": 1234,
            }
        ],
    )
    assert "branch: feature/x, PR #1234" in prompt


def test_build_rename_prompt_omits_pr_label_when_no_pr() -> None:
    prompt = build_rename_prompt([{"index": 2, "current_name": "c", "branch": "feature/x"}])
    assert "branch: feature/x" in prompt
    # No `, PR #` suffix when PR is missing.
    assert "PR #" not in prompt


def test_build_rename_prompt_includes_excerpt_and_recap_when_present() -> None:
    prompt = build_rename_prompt(
        [
            {
                "index": 3,
                "current_name": "main",
                "recap": "running pytest tests/test_x.py",
                "recent_excerpt": "PASSED test_x.py::test_a",
            }
        ],
    )
    assert "recap: running pytest" in prompt
    assert "recent terminal excerpt:" in prompt
    assert "PASSED test_x.py::test_a" in prompt


def test_build_rename_prompt_truncates_long_recap() -> None:
    long = "x" * 1000
    prompt = build_rename_prompt([{"index": 1, "current_name": "a", "recap": long}])
    # The 300-char clamp is per-window; full string must NOT appear.
    assert "x" * 1000 not in prompt
    # But the truncated head SHOULD.
    assert "x" * 300 in prompt


# --- parse_rename_response -------------------------------------------------


def test_parse_rename_response_strips_json_fences() -> None:
    raw = '```json\n{"1": "fs-build", "2": "cohort-inv"}\n```'
    assert parse_rename_response(raw) == {"1": "fs-build", "2": "cohort-inv"}


def test_parse_rename_response_handles_plain_object() -> None:
    raw = '{"1": "x"}'
    assert parse_rename_response(raw) == {"1": "x"}


def test_parse_rename_response_handles_unlabeled_fence() -> None:
    raw = '```\n{"5":"only"}\n```'
    assert parse_rename_response(raw) == {"5": "only"}


def test_parse_rename_response_raises_on_invalid_json() -> None:
    with pytest.raises(AnthropicResponseError) as e:
        parse_rename_response("not json at all")
    # Raw payload preserved for diagnostic logging.
    assert "not json at all" in e.value.raw


def test_parse_rename_response_raises_on_non_object_json() -> None:
    with pytest.raises(AnthropicResponseError):
        parse_rename_response('["a", "b"]')


def test_parse_rename_response_coerces_null_values_to_empty_string() -> None:
    # The model sometimes returns null to mean "keep as-is"; we coerce to ""
    # and let the route render the row as a no-op rather than crashing on a
    # NoneType when building the suggestion.
    assert parse_rename_response('{"3": null}') == {"3": ""}


def test_parse_rename_response_stringifies_numeric_keys_and_values() -> None:
    # JSON dict keys are always strings, but values can be anything. Coerce
    # so the route doesn't have to type-guard each branch.
    assert parse_rename_response('{"1": 42}') == {"1": "42"}


# --- estimate_cost ---------------------------------------------------------


def test_estimate_cost_zero_tokens_is_zero() -> None:
    assert estimate_cost(0, 0) == 0.0


def test_estimate_cost_haiku_baseline() -> None:
    # 1 000 input + 100 output at $1/M in, $5/M out:
    #   1_000 * 1.0 / 1_000_000   = $0.001
    #   100 * 5.0 / 1_000_000     = $0.0005
    #   total                     = $0.0015
    assert estimate_cost(1_000, 100) == pytest.approx(0.0015, rel=1e-6)


def test_estimate_cost_scales_with_output_more_than_input() -> None:
    # 10k each: output should contribute 5x the input share.
    in_cost = 10_000 * 1.0 / 1_000_000
    out_cost = 10_000 * 5.0 / 1_000_000
    assert estimate_cost(10_000, 10_000) == pytest.approx(in_cost + out_cost, rel=1e-6)
    assert out_cost == 5 * in_cost
