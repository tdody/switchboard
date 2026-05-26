# THI-141 — Drag-to-reorder tiles within a session column

**Linear:** [THI-141](https://linear.app/thibault-dody/issue/THI-141/allow-tile-ordering-via-drag-within-the-same-session-block)
**Date:** 2026-05-26
**Status:** Draft

## Summary

Let the user drag a tile up or down within its own kanban column to pin its
position. Constraint per the ticket title: **within the same session block** —
no cross-column drops. Mirrors the THI-115 session-column reorder pattern:
client-side, localStorage-persisted, no tmux mutation.

## Background

`Kanban.tsx` already drags **column headers** to reorder sessions (THI-115).
The persisted shape is a single `string[]` of session ids in
`lib/sessionOrder.ts`, applied as a pin list (saved entries float to the top
in saved order; everything else falls through to natural order).

Today, tiles within a column are sorted by `lib/filter.ts:sortPendingFirst`:
- Bucket 1: `pendingInput`
- Bucket 2: `error`
- Bucket 3: everything else
- Tie-break: tmux `index`

The buckets exist to keep pending panes visible regardless of state churn
(THI-122). Any user-pinned order must respect that — i.e. pending floats
above unpinned non-pending even if the unpinned one is at position 1 in
the saved pin list.

## Non-goals

- **Cross-column drops.** Out of scope by ticket title. A future ticket
  could wire this to `tmux move-window -t <session>:<index>`.
- **tmux index mutation.** We don't call `tmux swap-window`; pinned order
  is dashboard-local. The user's `tmux choose-tree` view is unaffected.
- **Per-pane move with keyboard.** Drag is the only affordance for v0.1;
  a `g shift+↑/↓` shortcut could land later.
- **Order migration across pane renames.** Pane IDs (`%N`) are stable for
  the life of the tmux server; rename / move events don't change them.

## Architecture

### Data model

New `lib/windowOrder.ts`, parallel to `lib/sessionOrder.ts`:

```ts
// localStorage: switchboard:windowOrder
type WindowOrderMap = Record<string /* sessionId */, string[] /* paneIds */>;

export function loadWindowOrder(): WindowOrderMap;
export function saveWindowOrder(m: WindowOrderMap): void;
export function reorderWindow(
  current: WindowOrderMap,
  sessionId: string,
  src: string,
  dst: string,
  before: boolean,
): WindowOrderMap;
```

Per-session keying lets each column have its own pin list. Same lenient-
parse / lossy-write semantics as `sessionOrder.ts` — corrupt storage
silently falls back to empty.

### Sort integration

`sortPendingFirst` gains an optional `pinnedPaneIds` argument:

```ts
export function sortPendingFirst(
  ws: Window[],
  pinnedPaneIds: string[] = [],
): Window[];
```

Within each bucket the tie-breaker is:
- Both panes pinned → by index in `pinnedPaneIds` (lower wins).
- Only one pinned → pinned one comes first.
- Neither pinned → fall back to tmux `index`.

This means pending panes still float to the top — they just sort among
themselves by pinned order, then by tmux index. A pinned non-pending pane
doesn't outrank a pending pane.

### Drag plumbing (`Kanban.tsx`)

Parallel to the existing session-header drag, with a distinct mime type
so the two drag flows can never confuse each other:

```ts
const WINDOW_DRAG_TYPE = "application/x-sb-window";
```

Each `<WindowCard>` gets:
- `draggable={!!onReorderWindow}`
- `onDragStart`: store `srcPaneId` + `srcSessionId`; set the mime payload.
- `onDragOver` on each tile: `preventDefault()` **only** when
  `dataTransfer.types.includes(WINDOW_DRAG_TYPE)` **and** the tile's session
  matches `srcSessionId`. Compute drop side from `e.clientY` vs the tile's
  midline; surface via a `data-drop-side="top"|"bottom"` attr that CSS
  paints as an inset edge highlight.
- `onDragLeave`: same boundingRect-based "actually left the tile" check
  the session drag uses (mouseleave is unreliable when children intercept).
- `onDrop`: invoke `onReorderWindow(sessionId, src, dst, before)`.

Cross-session drag attempts fall through without `preventDefault`, so the
cursor shows "not allowed" — same behavior as today's session drag when
hovering invalid targets.

### Drag-vs-click

The card is already `role="button" tabIndex={0}` with an `onClick` opener.
Native HTML5 drag and click coexist via the browser's drag threshold:
pointer-down + ≥ ~3 px movement starts a drag and **suppresses** the
subsequent click. Pointer-down + immediate up still fires the click. No
extra handling needed.

If manual testing reveals friction (e.g. trackpad users accidentally
starting drags on click), follow up by adding a small grip glyph at the
card's top-left corner and gating drag to that handle.

### App state + handler

```ts
const [windowOrder, setWindowOrder] = useState(loadWindowOrder);
const handleReorderWindow = useCallback(
  (sessionId: string, src: string, dst: string, before: boolean) => {
    setWindowOrder(prev => {
      const next = reorderWindow(prev, sessionId, src, dst, before);
      saveWindowOrder(next);
      return next;
    });
  },
  [],
);
```

Passed into `Kanban` as `onReorderWindow`. The kanban looks up
`windowOrder[s.id]` per column and forwards it as `pinnedPaneIds` into
the per-column `sortPendingFirst` call.

### Visual feedback

Reuse the session-drag idiom:

```css
.card-dragging { opacity: 0.55; }
.card[data-drop-side="top"]    { box-shadow: inset 0 3px 0 0 var(--accent); }
.card[data-drop-side="bottom"] { box-shadow: inset 0 -3px 0 0 var(--accent); }
.col-hd[draggable="true"]      { cursor: grab; }   /* already present */
.card[draggable="true"]        { cursor: grab; }   /* new */
.card[draggable="true"]:active { cursor: grabbing; }
```

## Files touched

| File | Change |
|---|---|
| `frontend/src/lib/windowOrder.ts` | New — load/save/reorder helpers (~70 LOC) |
| `frontend/src/lib/windowOrder.test.ts` | New — round-trip + reorder + missing-key edge cases |
| `frontend/src/lib/filter.ts` | `sortPendingFirst` gains optional `pinnedPaneIds` arg |
| `frontend/src/lib/filter.test.ts` | Pinned-order cases |
| `frontend/src/components/Kanban.tsx` | Tile-level drag/drop + `pinnedPaneIds` plumbing |
| `frontend/src/components/WindowCard.tsx` | Pass-through `draggable` + drag handlers |
| `frontend/src/App.tsx` | `windowOrder` state, `handleReorderWindow`, prop into Kanban |
| `frontend/src/styles/styles.css` | `.card-dragging`, `.card[data-drop-side=…]`, cursors |

No backend change.

## Testing

### Automated

- `windowOrder.test.ts`:
  - `loadWindowOrder` ignores corrupt JSON / non-object payloads.
  - `saveWindowOrder` survives a no-localStorage env.
  - `reorderWindow` for: drop-before, drop-after, src already in list, src
    not yet in list, dst not yet in list (becomes a new pin list), src ==
    dst no-op, src in a different session id no-op.
- `filter.test.ts` extensions on `sortPendingFirst`:
  - Empty pinned list → identical to current behavior.
  - Pinned order respected within bucket; unpinned fall back to index.
  - Pending pane outranks a pinned non-pending pane (bucket wins).
  - Pinned pending pane sorts ahead of unpinned pending pane.

### Manual

- [ ] Drag a tile down past one neighbor → it lands below; reload → still
  below.
- [ ] Drag the same tile back up → it lands above; reload → still above.
- [ ] Drag a non-pending tile to the top of its column; another pane in
  the same column goes pending → the pending pane bumps to top, the
  dragged pane drops to position 2.
- [ ] Drag a tile into a different column → cursor shows "not allowed",
  no reorder fires, source returns to its original slot on release.
- [ ] Kill a pinned tile → its id stays in `windowOrder` until a future
  drag prunes it (no orphan slot visible; sort skips missing entries).
- [ ] First-run tour anchor (`data-tour="first-card"`) still attaches to
  whatever ends up first under the new sort.

## Open questions / future work

- **Lazy pruning.** Stale entries (killed panes, panes moved between
  sessions) live in `windowOrder` until a subsequent drag touches the
  same session. Harmless but cumulative; a periodic prune could land
  later. Not worth it for v0.1.
- **Cross-column drop.** Out of scope by ticket. If wanted later, wire
  drop to a backend `tmux move-window` call — semantically different
  enough to warrant its own ticket.
- **Keyboard reorder.** `g shift+↑ / ↓` could move the focused tile one
  position. Defer until usage shows manual demand.
- **`scripts/wt` upstream bug.** Discovered while spinning up this
  worktree: `wt -b` sets the new branch's upstream to `origin/main`
  rather than leaving it unset for a first push. Should be fixed in a
  follow-up chore — not in this PR.
