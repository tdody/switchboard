"""Anthropic model pricing for the Claude 4.x family (THI-139).

Used by `services/claude_usage.compute_claude_usage` to turn token counts
into a USD dollar amount. List prices below are taken from
anthropic.com/pricing as of 2026-05-26 — when prices change, update the
PRICE_PER_MTOK table and the date in this docstring.

Two design choices worth flagging up front:

* Model IDs in the JSONL carry a date suffix (e.g.
  `claude-sonnet-4-6-20251001`). We match by family prefix so the table
  doesn't need an entry per release. `lookup()` does the prefix walk.

* The JSONL exposes a single `cache_creation_input_tokens` field with no
  tier indication. Anthropic publishes two cache-write tiers (5-min and
  1-hour); we default to the 5-min price, which is what most prompt caches
  hit. The discrepancy on long-cache turns is bounded — typical caches are
  < 5 min.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPrices:
    """USD per million tokens for one model family."""

    input: float
    output: float
    cache_write_5m: float
    cache_read: float


# Family prefix → prices. Order matters: `lookup()` walks this dict and
# matches the first prefix whose key is a startswith of the requested
# model id. Sort longest-prefix-first when adding new families to avoid a
# shorter prefix shadowing a longer one (e.g. don't add "claude" above
# "claude-opus-4").
PRICE_PER_MTOK: dict[str, ModelPrices] = {
    "claude-opus-4":   ModelPrices(input=15.0, output=75.0, cache_write_5m=18.75, cache_read=1.50),
    "claude-sonnet-4": ModelPrices(input=3.0,  output=15.0, cache_write_5m=3.75,  cache_read=0.30),
    "claude-haiku-4":  ModelPrices(input=1.0,  output=5.0,  cache_write_5m=1.25,  cache_read=0.10),
}

# 1 token = 1e-6 of a million-token unit. Pre-divided so cost_for() reads
# cleanly without scattering the conversion across the hot path.
_PER_TOKEN = 1e-6


def lookup(model: str) -> ModelPrices | None:
    """Find prices for a model id by family prefix.

    Returns None for unknown models so the caller can decide whether to
    log / surface the gap rather than silently double-counting at the
    wrong rate or crashing the whole `/api/usage` response.
    """
    if not model:
        return None
    for prefix, prices in PRICE_PER_MTOK.items():
        if model.startswith(prefix):
            return prices
    return None


def cost_for(
    prices: ModelPrices,
    *,
    input_tokens: int,
    cache_creation_tokens: int,
    cache_read_tokens: int,
    output_tokens: int,
) -> float:
    """Compute USD cost for one billed turn given known prices.

    Cache-creation tokens are priced at the 5-min tier — see the module
    docstring for why. Callers pass pre-validated non-negative token
    counts (the aggregator does the int() + or 0 coercion upstream).
    """
    return _PER_TOKEN * (
        prices.input * input_tokens
        + prices.cache_write_5m * cache_creation_tokens
        + prices.cache_read * cache_read_tokens
        + prices.output * output_tokens
    )
