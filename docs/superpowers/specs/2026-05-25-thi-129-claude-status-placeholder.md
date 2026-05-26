# THI-129 — Static placeholder for Claude "thinking" adverbs

**Linear:** [THI-129](https://linear.app/thibault-dody/issue/THI-129/move-the-claude-status)
**Date:** 2026-05-25
**Status:** Draft

## Summary

When a Claude pane transitions between "thinking…" (spinner adverb + recap)
and "idle" (no spinner, no recap), the agent card visibly resizes — the
`.card-agent` section grows and shrinks as the spinner chip and recap line
appear and disappear (`WindowCard.tsx:71-101`,
`styles.css:682-740`). The bouncing card under the cursor is the UX
complaint in the ticket.

Fix by reserving height for the parts that flicker: the chip row always
keeps one row's worth of vertical space, and the recap always reserves two
lines (rendered as `&nbsp;` when empty). The `.card-agent` wrapper renders
unconditionally for `kind === "agent"` cards so its presence is never the
source of a shift either.

## Background

Three independent rerenders inside `.card-agent` shift card height today:

1. **Spinner chip** (`WindowCard.tsx:86-92`) — appears whenever
   `agent.spinner` is set, disappears when Claude exits its thinking state.
   The chip-row stays at one line height as long as the branch chip is
   present, but on **non-git** agents (no branch chip) the row collapses to
   zero height when the spinner goes away.
2. **Recap line** (`WindowCard.tsx:94`,
   `styles.css:733-740`) — variable-height; `-webkit-line-clamp: 2` caps it
   at two lines but the content varies from 0 to 2 lines per tick.
3. **Whole `.card-agent` block** (`WindowCard.tsx:71`) — only renders when
   `agent || w.branch` is truthy. An agent pane with no branch and no
   spinner mid-tick can briefly lose the entire block.

The `.pending` block (`WindowCard.tsx:95-100`,
`styles.css:742-758`) is intentionally outside this scope: it represents a
real state change (Claude is waiting on the user) and the amber border is
*meant* to grab attention. It can stay conditional.

## Non-goals

* **Re-laying out the card-agent contents.** No element moves; existing
  visual hierarchy stays.
* **Coalescing the spinner adverb with the recap.** They are produced by
  different parts of the Claude parser and represent different things;
  joining them would be a parser change, not a UX change.
* **Animating the transitions.** A `transition: height …` is tempting but
  doesn't reach zero shift, and `data-reduced-motion="true"` users would
  still see a jump. Reservation is robust to all settings.
* **Other card kinds.** `shell` / `editor` / `server` / `logs` cards don't
  show `.card-agent` at all; this ticket scopes to `kind === "agent"`.

## Architecture

### Render `.card-agent` unconditionally for agent cards

`WindowCard.tsx:71` becomes:

```tsx
{(w.kind === "agent" || w.branch) && (
  <div className="card-agent">
    …
  </div>
)}
```

Rationale: every agent card always shows the agent section so its
appearance/disappearance can't be a source of shift. Non-agent cards
preserve the existing behavior (only shown if there's a branch to display).

### Reserve a row in `.chip-row`

```css
/* styles.css, extend the .chip-row rule near line 687 */
.card-agent .chip-row {
  min-height: 22px;          /* matches one .chip's height incl. padding */
}
```

`22 px` covers a chip at the current font-size (`10.5 px`) plus padding
(`2 px × 2`) plus border (`1 px × 2`). Verified empirically by inspecting
the rendered chip box.

### Reserve two lines in `.recap`

```tsx
// WindowCard.tsx around line 94 — render the recap slot unconditionally for
// agent cards so the layout stays stable.
{(w.kind === "agent" || agent?.recap) && (
  <div className="recap">
    {agent?.recap || " "}
  </div>
)}
```

```css
/* styles.css, modify .recap near line 733 */
.recap {
  /* ...existing rules unchanged… */
  min-height: calc(1.4em * 2);   /* two lines at current line-height: 1.4 */
}
[data-density="compact"] .recap {
  -webkit-line-clamp: 1;
  min-height: 1.4em;             /* one line in compact mode */
}
```

The `1.4em × 2` math derives from the existing `line-height: 1.4` rule and
the existing two-line clamp. The compact-density override (`styles.css:818`)
already line-clamps to 1; reserve one line instead of two there.

### Spinner chip stays conditional

The spinner chip itself can keep its `{agent?.spinner && …}` conditional —
the chip-row's `min-height` ensures the row doesn't collapse even when the
spinner chip is absent.

## Files touched

| File | Change |
|---|---|
| `frontend/src/components/WindowCard.tsx` | Loosen `.card-agent` and `.recap` render conditions to include `kind === "agent"`; render ` ` placeholder text |
| `frontend/src/styles/styles.css` | Add `min-height` to `.card-agent .chip-row`; add `min-height` to `.recap` (default + compact-density override) |

## Testing

**Acceptance criterion: zero layout shift on Claude state transitions.**

Manual:

1. Open dashboard with at least one Claude pane idle.
2. Use DevTools → Performance panel → Layout Shift overlay (or
   `document.querySelector('[data-card-id="…"]').getBoundingClientRect()`
   before and after).
3. Trigger Claude to start thinking (send a prompt). Confirm the card's
   bounding height does not change between the idle and thinking states.
4. Wait for Claude to finish. Confirm the card returns to the same height.
5. Repeat with `Settings → Density: compact`. Same expectation, at the
   compact height.
6. Verify a `shell` card (no agent) is **not** affected — `.card-agent`
   still doesn't render on a shell with no branch.
7. Verify a `shell` card **with** a branch (e.g. a vim pane in a git repo)
   keeps the existing single-row chip behavior.

Visual regression:

* Empty recap text shows as an invisible blank line (no `&nbsp;` artifact).
* Chip-row min-height doesn't introduce extra space when chips are present
  (they fit within the reserved 22 px).
* Pending block still slides in below when the agent asks for input — that
  shift is intentional and unchanged.

## Open questions / future work

* **Pending block placement.** A future iteration could move the pending
  block into a fixed-position overlay so the card-agent section never
  changes height even when Claude asks a question. Deferred — the amber
  pending border is currently a deliberate attention-grab and shouldn't be
  silenced for v0.1.
* **Recap clamp height.** Two lines may feel like a lot of reserved space
  for agent cards that rarely fill it. If users complain, drop the default
  to `1lh` (matching compact-density) and let the chip-row carry more
  weight.
