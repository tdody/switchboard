# THI-131 + THI-133 — Agent card coloring by context usage (merged)

**Linear:** [THI-131](https://linear.app/thibault-dody/issue/THI-131/add-color-coding-green-yellow-orange-red-for-agent-tiles-based-on),
[THI-133](https://linear.app/thibault-dody/issue/THI-133/highlight-agent-cards-with-high-session-usage)
**Date:** 2026-05-25
**Status:** Draft

## Summary

Today nothing on a Claude agent card communicates how close that session is
to filling its context window. Users discover the problem only when Claude
itself starts trimming context mid-conversation. Add a four-stop colored
**left-border accent** to agent cards, driven by a new `contextPct` field
on `Agent`, sourced from a regex over recent captured pane lines:

| Context % | Accent color |
|---|---|
| `< 50` | green |
| `50–74` | yellow |
| `75–89` | orange |
| `≥ 90` | red |

The accent lives on the **left edge** so it composes cleanly with status
chrome (which lives on the top via `StatusPill` + on the right via the
`pending` amber-border on the agent block). Hover-tooltip on the accent
reveals the raw percentage. Non-agent cards are unaffected.

This spec resolves the THI-131 vs. THI-133 question: both tickets become a
single signal on a single visual surface. THI-133 (which used the vaguer
phrase "session usage") closes as a duplicate once this ships.

## Background

* Per-pane context% **does not exist** in `/api/state` today. `Window` and
  `Agent` (`schemas.py:30-77`) have no such field; `ClaudeUsage`
  (`schemas.py:86-100`) tracks workspace-wide rolling token totals, not the
  per-pane context window. THI-131 therefore requires both a backend
  surface and a frontend treatment.
* Claude Code's TUI prints a line like
  `Context: 73% (~144k / 200k tokens)` (newer builds) or
  `(200k context window used: 73%)` (older) in the bottom-right footer of
  the spinner area. The existing parser (`claude_parser.py`) reads the
  recent pane lines but does not extract this number.
* The card has spare visual real estate on its left edge — neither
  `StatusPill` (top-right corner of head) nor `.pending` (full-width block)
  uses it. A left-border accent is the cleanest place.

## Non-goals

* **Workspace-rollup signal** (the THI-133 "session usage" reading some
  aggregate across panes). Decision: collapsed into one per-pane signal.
  The header pill from THI-110 already shows the workspace-wide plan-%
  meters; another rollup on cards would compete with that.
* **Per-card token totals.** The chip-row already shows agent spinner +
  duration; adding tokens would crowd. The tooltip surfaces the number for
  users who want it.
* **Animated transitions** when % moves between bands. The accent steps
  discretely; no `transition`.
* **Cards other than `kind === "agent"`.** Shell / editor / server / logs
  don't have a context window to report on.

## Architecture

### Backend — extract `contextPct`

Add a new regex + scanner to `claude_parser.py`:

```python
# Two patterns Claude Code uses across recent builds. Anchored to be tail
# fragments — the line may have other content before this marker.
_CONTEXT_RE_NEW = re.compile(
    r"Context:\s+(\d{1,3})\s*%",
    re.IGNORECASE,
)
_CONTEXT_RE_OLD = re.compile(
    r"context\s+window\s+used:\s+(\d{1,3})\s*%",
    re.IGNORECASE,
)


def _scan_context_pct(lines: list[str]) -> int | None:
    """Most recent Claude context-window percent, or None if not found.

    Scans the last ~30 lines bottom-up so a stale Context line that scrolled
    off the visible TUI doesn't beat a fresh one. Tolerates both modern
    (`Context: 73%`) and legacy (`context window used: 73%`) phrasings.
    """
    for raw in reversed(lines[-30:]):
        line = _strip_ansi(raw)
        m = _CONTEXT_RE_NEW.search(line) or _CONTEXT_RE_OLD.search(line)
        if m:
            pct = int(m.group(1))
            if 0 <= pct <= 100:
                return pct
    return None
```

Wire into the existing agent-classification call site (where `_scan_spinner`,
`_scan_recap`, `_scan_yn_enter` are already invoked) and pass the result
into the `Agent` payload.

### Backend — extend `Agent` schema

`schemas.py:30-35` becomes:

```python
class Agent(_CamelModel):
    branch: str | None = None
    spinner: str | None = None
    duration: str | None = None
    recap: str | None = None
    action: str | None = None
    context_pct: int | None = None   # NEW, 0..100, None when not parseable
```

Pydantic's `to_camel` alias generator (`schemas.py:13`) emits this as
`contextPct` over the wire — matches frontend convention.

### Frontend — types

`frontend/src/types.ts` `Agent` interface gains `contextPct?: number`.
No other type changes required.

### Frontend — `WindowCard.tsx`

Add a small derived value at the top of `WindowCardImpl`:

```ts
const ctxBand = useMemo(() => contextBand(agent?.contextPct), [agent?.contextPct]);
```

where `contextBand` is a pure helper in `lib/status.ts`:

```ts
export type ContextBand = "" | "ctx-low" | "ctx-mid" | "ctx-high" | "ctx-crit";

export function contextBand(pct: number | null | undefined): ContextBand {
  if (pct == null) return "";
  if (pct >= 90) return "ctx-crit";
  if (pct >= 75) return "ctx-high";
  if (pct >= 50) return "ctx-mid";
  return "ctx-low";
}
```

Wire the class into the existing `className` composition (`WindowCard.tsx:42-44`):

```ts
const className =
  `card ${pending ? "card-pending" : ""} ${isFocused ? "card-focused" : ""}` +
  (isHighlighted ? " card-hl" : "") +
  (ctxBand ? ` ${ctxBand}` : "");
```

Tooltip-wrap an invisible accent strip rendered as a child of `.card`:

```tsx
{ctxBand && (
  <Tooltip content={`Context: ${agent?.contextPct}%`}>
    <span className="ctx-accent" aria-hidden="true" />
  </Tooltip>
)}
```

The accent is a `position: absolute` span pinned to the card's left edge so
hover-targeting it (without making the entire card a tooltip) is cheap.

### CSS

```css
/* styles.css — extend near the .card section (line 477) */
.card {
  position: relative;       /* (likely already set; verify) */
}

.ctx-accent {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 4px;
  border-top-left-radius: var(--r-lg);
  border-bottom-left-radius: var(--r-lg);
  pointer-events: auto;     /* so the Tooltip's mouseenter fires */
  background: transparent;
}

.card.ctx-low  .ctx-accent { background: var(--tone-green); }
.card.ctx-mid  .ctx-accent { background: var(--tone-amber); }   /* "yellow" */
.card.ctx-high .ctx-accent { background: var(--tone-orange); }
.card.ctx-crit .ctx-accent {
  background: var(--tone-red);
  box-shadow: 0 0 6px color-mix(in oklch, var(--tone-red) 60%, transparent);
}
```

Color tokens already exist for `green`, `amber`, `red`
(`styles.css` `--tone-*` family). Verify `--tone-orange` exists; if not,
define it once near the other tone tokens as
`color-mix(in oklch, var(--tone-amber) 60%, var(--tone-red))` so it sits
between yellow and red without inventing a fresh hue.

### Composability with existing chrome

* `card-pending` (amber outline) overrides the accent visually because it
  uses `border-color`, not `border-left-color`. The accent strip sits inside
  the rounded border, behind the corner radius — they don't clash.
* `card-hl` (highlight ring from arrow-nav) is an outer `box-shadow`,
  unaffected.
* `card-focused` (focused-in-tmux ring) — same; outer `box-shadow`.
* `StatusPill` lives in the head row — opposite side of the card from the
  accent. No overlap.

## Files touched

| File | Change |
|---|---|
| `backend/src/switchboard/services/claude_parser.py` | Add `_CONTEXT_RE_NEW`/`_CONTEXT_RE_OLD`, `_scan_context_pct`; thread into agent payload |
| `backend/src/switchboard/schemas.py` | Add `context_pct` to `Agent` |
| `backend/tests/test_claude_parser.py` | Parser unit tests (see below) |
| `frontend/src/types.ts` | Add `contextPct?: number` to `Agent` |
| `frontend/src/lib/status.ts` | Add `ContextBand` and `contextBand()` |
| `frontend/src/lib/status.test.ts` | Unit tests for `contextBand()` |
| `frontend/src/components/WindowCard.tsx` | Compose `ctxBand` class; render `.ctx-accent` span with tooltip |
| `frontend/src/styles/styles.css` | `.ctx-accent` + 4 band rules; possibly `--tone-orange` token |

## Testing

**Backend — `test_claude_parser.py`:**

| Input lines (tail) | Expected `context_pct` |
|---|---|
| `["Context: 73% (~144k / 200k tokens)"]` | `73` |
| `["context window used: 12%"]` (legacy) | `12` |
| `["⏵⏵ accept edits", "Context: 0%"]` | `0` |
| `["Context: 101%"]` (corrupt) | `None` (out-of-range guard) |
| `["no context line here"]` | `None` |
| `["Context: 50%", …80 more lines…, "Context: 22%"]` | `22` (most-recent wins) |

**Frontend — `status.test.ts`:**

| Input | Output |
|---|---|
| `undefined` / `null` | `""` |
| `0` | `"ctx-low"` |
| `49` | `"ctx-low"` |
| `50` | `"ctx-mid"` |
| `74` | `"ctx-mid"` |
| `75` | `"ctx-high"` |
| `89` | `"ctx-high"` |
| `90` | `"ctx-crit"` |
| `100` | `"ctx-crit"` |

**Visual / manual:**

* Open dashboard with at least one Claude pane at < 50% context → left
  accent visible, green.
* Send Claude enough work to cross the bands → accent transitions
  green → yellow → orange → red without animation.
* Hover the accent → tooltip shows `Context: NN%`.
* `card-pending` and `ctx-crit` together → red glow on left edge, amber
  outer border — both visible, no clash.
* `card-hl` (arrow-nav highlight) + accent → both visible.
* Resize to compact density → accent still 4 px wide; doesn't bleed.
* Non-agent card (no `agent.contextPct`) → no `.ctx-accent` element
  rendered.

## Open questions / future work

* **Older Claude builds** that print context% in a third format we haven't
  observed. The two regexes cover today's outputs (5.x and the last legacy
  scroll); if a third appears, add one more regex — the contract on the
  scanner side won't change.
* **Per-band thresholds.** 50 / 75 / 90 is conventional traffic-light
  pacing. If users want earlier warnings, tune via these constants in
  `status.ts` only — no backend change.
* **Forecast.** A natural follow-up is "you'll exhaust context in ~12 min
  at this rate." Requires keeping per-pane history. Out of scope.
* **THI-133 reconciliation.** After this lands, close THI-133 as a
  duplicate with a comment linking to this spec.
