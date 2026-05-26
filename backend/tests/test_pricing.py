"""Tests for the Anthropic pricing table + lookup (THI-139).

Numbers here are pinned to the values in `services/pricing.py`. If the
pricing table is updated, this file should be updated in the same commit.
"""

from __future__ import annotations

from switchboard.services import pricing


def test_lookup_matches_family_prefix() -> None:
    # Dated release IDs match by the family prefix — that's the whole point
    # of using `startswith` instead of an exact key.
    assert pricing.lookup("claude-opus-4-7-20251015") is pricing.PRICE_PER_MTOK["claude-opus-4"]
    assert pricing.lookup("claude-sonnet-4-6") is pricing.PRICE_PER_MTOK["claude-sonnet-4"]
    assert pricing.lookup("claude-haiku-4-5-20251001") is pricing.PRICE_PER_MTOK["claude-haiku-4"]


def test_lookup_unknown_returns_none() -> None:
    assert pricing.lookup("") is None
    assert pricing.lookup("gpt-5") is None
    # A future Anthropic family we haven't priced yet returns None rather
    # than silently matching the closest entry — the caller has to opt
    # into the gap by adding a table row.
    assert pricing.lookup("claude-future-9-1") is None


def test_cost_for_sonnet_combines_all_four_token_types() -> None:
    # 1000 input @ $3/MTok      = $0.003
    # 2000 cache_write @ $3.75  = $0.0075
    # 4000 cache_read @ $0.30   = $0.0012
    # 500 output @ $15          = $0.0075
    # total                       $0.0192
    sonnet = pricing.PRICE_PER_MTOK["claude-sonnet-4"]
    cost = pricing.cost_for(
        sonnet,
        input_tokens=1000,
        cache_creation_tokens=2000,
        cache_read_tokens=4000,
        output_tokens=500,
    )
    assert cost == 0.0192


def test_cost_for_opus_is_higher_than_sonnet() -> None:
    # Same token counts; Opus should bill more — sanity-check the table
    # ordering (regression guard for a copy-paste mistake in the table).
    opus = pricing.PRICE_PER_MTOK["claude-opus-4"]
    sonnet = pricing.PRICE_PER_MTOK["claude-sonnet-4"]
    args = {
        "input_tokens": 1000,
        "cache_creation_tokens": 0,
        "cache_read_tokens": 0,
        "output_tokens": 500,
    }
    assert pricing.cost_for(opus, **args) > pricing.cost_for(sonnet, **args)


def test_cost_for_zero_tokens_is_zero() -> None:
    sonnet = pricing.PRICE_PER_MTOK["claude-sonnet-4"]
    cost = pricing.cost_for(
        sonnet,
        input_tokens=0,
        cache_creation_tokens=0,
        cache_read_tokens=0,
        output_tokens=0,
    )
    assert cost == 0.0
