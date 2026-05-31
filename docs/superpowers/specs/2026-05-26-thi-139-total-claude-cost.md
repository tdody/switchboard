# THI-139 — Total Claude session cost in `/usage`

**Linear:** [THI-139](https://linear.app/thibault-dody/issue/THI-139/total-claude-session-cost-in-usage)
**Date:** 2026-05-26 (updated 2026-05-26)
**Status:** Draft (v2 — source switched from jsonl pricing math to per-pane TUI scrape)

## Summary

Add an aggregate USD cost to the header usage pill. The figure is the **sum
across visible agent panes** of each pane's running session cost — the same
`💰 $X.XX` number Claude Code shows in each pane's TUI status line.

## Background

Claude Code prints a per-session running cost in its TUI footer, e.g.:

```
📁 frontend  🌿 thi-139  |  🧠 █░░░ 16% 📨 6 📤 542 | session: 155.4k in / 542 out  💰 $8.33  🤖 opus
```

That `💰 $8.33` is the cost of THIS pane's session-so-far — accurate, computed
by Claude itself, and matches what the user would see if they Cmd-clicked
each pane to read the number. Switchboard already captures these lines for
the agent parser; THI-139 just scrapes the dollar field and exposes it.

## Why not compute from `~/.claude/projects/*.jsonl`?

We tried this first (v1 of this spec). Two problems:

1. **Hard to define "active" precisely.** "5h rolling-window" cost double-bills
   long sessions vs. how the user thinks about them; "sum of in-window-active
   session lifetimes" overcounts sessions that ended recently; correlating
   sessions to running tmux panes requires extra plumbing.
2. **Always going to be a guess.** Anthropic's prices change; cache-tier
   pricing has multiple variants (5 min, 1 h); our table will drift.

The TUI's `💰` is the source of truth Claude itself uses. Reading from the
TUI is more robust and matches user expectation exactly.

## Non-goals

* **Per-pane cost in cards.** Add later — the data is on `Agent.sessionCostUsd`
  already, but the kanban card UI is its own ticket.
* **Lifetime / historical totals.** The TUI doesn't expose them and we don't
  want to maintain a pricing table.
* **Plan-aware projections.** Just sum what Claude tells us.

## Architecture

### Backend

1. **`claude_parser._scan_session_cost(lines) -> float | None`** — scans the
   last ~30 lines bottom-up for `💰 $X.XX`. Returns the parsed float (handles
   integer values + thousands-separator commas defensively). Returns `None`
   when the marker isn't present (fresh session before the first billed turn,
   or a non-conversation TUI screen). Mirrors the `_scan_context_pct` pattern.

2. **`Agent.session_cost_usd: float | None`** — new field on the `Agent`
   pydantic model. `to_camel` alias serializes it as `sessionCostUsd`.

3. **`parse_pane`** threads the value into the constructed `Agent`.

### Frontend

1. **`Agent.sessionCostUsd?: number`** — matches the backend's new field.
2. **`App.tsx`** computes `activeSessionCostUsd` as
   `windows.reduce((sum, w) => sum + (w.agent?.sessionCostUsd ?? 0), 0)`
   and passes it to `Header` → `UsagePill`.
3. **`UsagePill`** renders the cost in both render branches (scrape meters and
   token-window text), with a `· $X.XX` separator. Hides when the sum is `0`
   (no pane has reported a `💰` yet). Tooltip lists the figure with a "sum of
   💰 across visible claude panes" caption.

### Things removed (cleanup from v1)

* `services/pricing.py` + `test_pricing.py`
* `ClaudeUsage.cost_usd` + `ClaudeUsage.unknown_models` + their serializers
* The jsonl per-record cost loop in `compute_claude_usage`
* The `session-priced-*.jsonl` fixtures and their `test_cost_*` tests

## Files touched

| File | Change |
|---|---|
| `backend/src/switchboard/services/claude_parser.py` | Add `_SESSION_COST_RE`, `_scan_session_cost`, thread into `parse_pane` |
| `backend/src/switchboard/schemas.py` | Add `Agent.session_cost_usd`; remove `ClaudeUsage.cost_usd` + `unknown_models` |
| `backend/src/switchboard/services/claude_usage.py` | Revert jsonl-cost loop back to tokens-only |
| `backend/src/switchboard/services/pricing.py` | **Removed** |
| `backend/tests/test_claude_parser.py` | Add `_scan_session_cost` + `parse_pane` cost cases |
| `backend/tests/test_claude_usage.py` | Remove THI-139 cost section (~100 lines) |
| `backend/tests/test_pricing.py` | **Removed** |
| `backend/tests/fixtures/usage/session-priced-*.jsonl` | **Removed** |
| `frontend/src/types.ts` | Add `Agent.sessionCostUsd`; remove `ClaudeUsage.costUsd`/`unknownModels` |
| `frontend/src/App.tsx` | Compute `activeSessionCostUsd` from `windows`; pass to `Header` |
| `frontend/src/components/Header.tsx` | Forward `activeSessionCostUsd` prop to `UsagePill` |
| `frontend/src/components/UsagePill.tsx` | Take `activeSessionCostUsd` prop; render in both branches |
| `frontend/src/components/UsagePill.test.tsx` | Rewrite cost tests against the prop |

## Testing

### Backend (automated)

* `_scan_session_cost`: modern status line; integer-only `$42`; thousands
  separators (`$1,234.56`); most-recent-wins scan order; ANSI stripped;
  returns `None` when the line is absent.
* `parse_pane`: returns the cost on `agent.session_cost_usd`; serialized as
  `sessionCostUsd` via `to_camel`; `None` when no `💰` line.

### Frontend (automated)

* `UsagePill`: renders `· $X.XX` next to token total when `activeSessionCostUsd
  > 0`; omits the chip when `0`; renders alongside the meters in the scrape
  branch; tooltip surfaces the figure with a clear caption.
* `usageFormat.fmtCost`: existing tests still cover thousands grouping +
  rounding.

### Manual

* On a multi-pane setup with several claude sessions that have exchanged
  messages, the header pill shows a `$X.XX` value that equals the sum of
  `💰 $…` printed in each pane's TUI footer (verified by reading the panes).
* Send a message in one pane; within a poll tick or two, the header total
  ticks up by that pane's incremental cost.
* Open the docs / settings / command-palette modals — modal-open polling
  cadence still applies; the cost figure updates promptly.
* Kill a claude pane — its session cost stops contributing on the next poll.

## Open questions / future work

* **Per-card cost chip.** Surface each pane's `sessionCostUsd` on its
  `WindowCard` (small `$X.XX` chip next to context%). Data is already there.
* **All-time cumulative.** The TUI doesn't expose it; would require either
  parsing every jsonl (and a pricing table again) or a separate Claude API
  call. Defer.
* **Cost-tier accents.** Color the chip amber/red over thresholds. Trivial
  once the per-card chip lands.
