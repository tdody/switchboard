# THI-139 — Total Claude session cost in `/usage`

**Linear:** [THI-139](https://linear.app/thibault-dody/issue/THI-139/total-claude-session-cost-in-usage)
**Date:** 2026-05-26
**Status:** Draft

## Summary

Add a USD dollar amount to the `/api/usage` response and surface it next to
the existing tokens pill in the Header. The cost is computed locally from
the per-record `model` + `usage` token counts already being walked by
`compute_claude_usage` — no new file IO, no TUI scrape.

## Background

`services/claude_usage.py:47` (`compute_claude_usage`) reads every recent
`~/.claude/projects/*.jsonl` and aggregates token counts within the rolling
`window_hours` window (default 5 h) into `ClaudeUsage`. Per-record
`message.model` is available alongside `message.usage` but is not currently
read — only the four token counters are. The dashboard renders a pill in
the Header showing tokens / messages / reset countdown (THI-110) but no
dollar figure.

The Claude TUI status line shows `💰 $X.XX` per-pane (e.g. the THI-131
brain-emoji capture: `💰 $8.33`), but that is per-session, not aggregate,
and is not surfaced in Switchboard today.

## Non-goals

* **Per-pane cost.** This ticket is the *aggregate* rolling-window cost. A
  per-pane breakdown is a separate ticket.
* **TUI scrape.** The `/usage` TUI screen doesn't include a $ total. We
  compute from jsonl, not from the scrape.
* **Historical / lifetime totals.** Only the current rolling window
  (matches the existing `compute_claude_usage` contract).
* **Settings UI for custom pricing.** Pricing lives in code, dated by
  comment; updated by hand when Anthropic changes prices.

## Architecture

### Pricing table

New `services/pricing.py`:

```python
# Anthropic public list prices (USD per million tokens) for the Claude 4.x
# family — confirmed against anthropic.com/pricing on 2026-05-26.
# When prices change, update this table and the date in this comment.

@dataclass(frozen=True)
class ModelPrices:
    input: float
    output: float
    cache_write_5m: float
    cache_read: float

PRICE_PER_MTOK: dict[str, ModelPrices] = {
    "claude-opus-4":    ModelPrices(input=15.0,  output=75.0,  cache_write_5m=18.75, cache_read=1.50),
    "claude-sonnet-4":  ModelPrices(input=3.0,   output=15.0,  cache_write_5m=3.75,  cache_read=0.30),
    "claude-haiku-4":   ModelPrices(input=1.0,   output=5.0,   cache_write_5m=1.25,  cache_read=0.10),
}

def cost_for(model: str, usage: TokenUsage) -> float:
    """Return USD cost for one billed turn. Unknown models → 0.0 (caller
    decides whether to log)."""
```

Model id lookup uses a **prefix match** because the jsonl emits dated IDs
(`claude-sonnet-4-6-20251001`) and the family-level prefix is stable.

### Schema change

Extend `ClaudeUsage` in `backend/src/switchboard/schemas.py`:

```python
class ClaudeUsage(_CamelModel):
    # ...existing fields...
    cost_usd: float = 0.0           # serializes as `costUsd`
    unknown_models: list[str] = []  # serializes as `unknownModels` (de-duplicated;
                                    # records counted with cost=0 fall here)
```

Backward-compatible: defaults to 0.0 / empty list when the projects dir
doesn't exist or no records match.

### Compute loop

In `compute_claude_usage`, when reading the `usage` block of each in-window
record, also read `rec["message"]["model"]` and call
`pricing.cost_for(model, usage)`. Sum into a new `cost` accumulator. Unknown
models append to a set, included verbatim in the response.

```python
total_cost = 0.0
unknown: set[str] = set()
# ... existing loop ...
    model = ((rec.get("message") or {}).get("model")) or ""
    prices = pricing.lookup(model)
    if prices is None:
        unknown.add(model)
    else:
        total_cost += pricing.cost_for(prices, usage)
```

### Frontend display

Header usage pill (`Header.tsx`, `.usage-pill` chrome) gains a single
appended field. Today the pill shows tokens / messages / reset; new layout:

```
[ ●  1.2M tok · 5/h · $4.32  →  2h 14m ]
                       ^^^^^
                       new
```

Format: `$0.00` (always 2 decimals), USD only, no currency selector (YAGNI).
If `cost_usd == 0.0`, render the field anyway (`$0.00`) — hiding it would
read as "broken pill" the moment the user makes any request.

If `unknown_models` is non-empty, the pill's tooltip adds a one-liner:
`"Pricing missing for: claude-…"`. Visible cost is still computed from
known-model records; users see they have an incomplete picture without
the UI just lying.

## Files touched

| File | Change |
|---|---|
| `backend/src/switchboard/services/pricing.py` | **New** — pricing table + lookup helper |
| `backend/src/switchboard/services/claude_usage.py` | Read `model`; accumulate `cost_usd` and `unknown_models` |
| `backend/src/switchboard/schemas.py` | Add `cost_usd` and `unknown_models` to `ClaudeUsage` |
| `backend/tests/test_pricing.py` | **New** — table coverage + lookup |
| `backend/tests/test_claude_usage.py` | Add cost-aggregation cases (mixed models, unknown model, empty) |
| `frontend/src/components/Header.tsx` | Render `$X.XX` next to existing tokens display |
| `frontend/src/styles/styles.css` | Tiny `.usage-pill .cost` style if needed (optional — reuse `.dim`) |

No router change — `/api/usage` keeps the same path; the response gets the
new fields via `to_camel` alias.

## Testing

**Backend:**

* `pricing.cost_for` returns the right $ for each model family, for each
  field (input, output, cache write, cache read).
* `pricing.lookup` matches dated IDs by family prefix; unknown ID → None.
* `compute_claude_usage` on a fixture with one assistant turn at Sonnet
  pricing returns the expected `cost_usd` (compute by hand).
* Fixture with a mix of Opus + Sonnet records returns the sum.
* Fixture with one unknown-model record returns the other records' cost
  unchanged and lists the unknown id in `unknown_models`.
* Empty fixture → `cost_usd == 0.0`, `unknown_models == []`.
* Out-of-window records contribute 0 (existing cutoff logic — verify it
  applies to the cost path too).

**Frontend:**

* Pill renders `$X.XX` (two decimals) for non-zero cost.
* Pill renders `$0.00` for zero cost (not hidden).
* Pill tooltip shows the unknown-models hint when present.

## Open questions / future work

* **Cache write tier.** The jsonl currently exposes only
  `cache_creation_input_tokens` without distinguishing 5 min vs 1 h cache.
  We use the 5 min price as a default — most prompt caching is 5 min. If
  Anthropic exposes the tier in the record later, plumb it.
* **Per-pane cost in cards.** A natural follow-up — display each agent
  pane's running-session cost as a chip. Distinct from this ticket because
  it requires per-session aggregation, not rolling-window.
* **Currency / locale.** USD only for v0.1. If multi-currency is ever
  needed, the pricing table is the right pivot point.
