# THI-128 — Three sizes for terminal panes (column width)

**Linear:** [THI-128](https://linear.app/thibault-dody/issue/THI-128/allow-3-sizes-for-the-terminal-panes)
**Date:** 2026-05-25
**Status:** Draft

## Summary

Today every kanban column is a fixed `320 px` wide
(`styles.css:320`, `.col { flex: 0 0 320px; }`). On a 27"+ display this leaves
substantial empty space at the right edge of the dashboard and forces session
content to wrap aggressively.

Add a three-step **column-size** control — narrow / normal / wide — wired to a
new `columnSize` field in `Settings`, surfaced both as a `+ / −` segmented
control in the dashboard chrome (matches the user's screenshot ask) and in
the existing Settings modal.

The setting is **orthogonal** to the existing `density` setting
(`settings.ts:21`, values `compact | comfy | preview`), which controls
vertical packing of card content. `columnSize` only changes column width.

## Background

Existing `density` (`settings.ts:21`, `App.tsx:331`) sets `data-density` on
`<html>` and toggles per-card padding / preview visibility via CSS rules at
`styles.css:813-821`. It does not change column width.

Existing settings persistence uses one `localStorage` key
(`switchboard:settings`, `settings.ts:84`) holding the full `Settings` JSON;
`columnSize` joins as one more field there. No new key.

## Non-goals

* **Per-session column width.** All columns are the same width. Mixing widths
  in the same horizontal scroll would feel chaotic and complicate drag-reorder.
* **Free-form drag-to-resize.** A draggable column edge is much more work for
  marginal gain; three discrete sizes covers the screenshot's complaint.
* **Responsive auto-fit.** Not auto-sizing to viewport — the user picks. The
  existing `@media` rule at `styles.css:1529` (`.kanban .col { flex: 0 0 85vw; }`)
  for narrow screens stays as-is.
* **Card density changes.** That's `density`. `columnSize` only moves the
  horizontal flex-basis.

## Architecture

### Data model

```ts
// in lib/settings.ts (extend existing Settings)
export type ColumnSize = "narrow" | "normal" | "wide";

export interface Settings {
  // ...existing fields...
  columnSize: ColumnSize;        // default "normal"
}
```

Width values (in `styles.css`):

| `columnSize` | flex-basis |
|---|---|
| `narrow` | `280 px` |
| `normal` | `320 px` (matches today, default) |
| `wide` | `400 px` |

Applied via a new `data-column-size` attribute on `<html>`, mirroring the
existing `data-density` pattern (`App.tsx:331`):

```ts
el.setAttribute("data-column-size", settings.columnSize);
```

CSS:

```css
/* extend section near styles.css:320 */
[data-column-size="narrow"] .col { flex: 0 0 280px; }
[data-column-size="wide"]   .col { flex: 0 0 400px; }
/* "normal" inherits the default .col rule (no override needed) */
```

### UI: `+ / −` control in the subhead

Add a small `ColumnSizeControl` to `Subhead.tsx`, placed at the right end of
the row (after the search box, before any spacer). Two icon buttons:

```
[ − ]  [ + ]
```

* `−` decreases one step (`wide → normal → narrow`); disabled at `narrow`.
* `+` increases one step (`narrow → normal → wide`); disabled at `wide`.
* Each button has a `Tooltip` (THI-96 component): `"Narrower columns"` /
  `"Wider columns"` plus the current value (`"current: normal"`).

Implementation reuses the existing `.tab` button class for visual
consistency with status-filter chips.

### Settings modal

Add a row in `SettingsModal.tsx` next to the existing density selector
(`SettingsModal.tsx:221-228`). Same `<select>` shape:

```tsx
<div className="name">Column width</div>
<select
  value={settings.columnSize}
  onChange={(e) => updateSettings({ columnSize: e.target.value as ColumnSize })}
>
  <option value="narrow">Narrow</option>
  <option value="normal">Normal</option>
  <option value="wide">Wide</option>
</select>
```

### Side-effect: xterm fit in the modal

In v0.1, the terminal modal is fullscreen-overlay (not constrained by column
width), so `columnSize` does not affect xterm fit. `TerminalModal.tsx` uses
its own root container, not the kanban column. No `fit()` call needed.

**Superseded in v0.2** — see the follow-up section below; the modal now
honors `columnSize` too, but the existing `ResizeObserver` in
`TerminalModal.tsx:238-239` handles the `fit()` + `tmux resize` round-trip
automatically when the container's pixel box changes.

## Files touched

| File | Change |
|---|---|
| `frontend/src/lib/settings.ts` | Add `ColumnSize` type and `columnSize` field with default `"normal"` |
| `frontend/src/App.tsx` | Set `data-column-size` on `<html>` alongside `data-density` (line ~331) |
| `frontend/src/components/Subhead.tsx` | Add `ColumnSizeControl` segmented button pair |
| `frontend/src/components/SettingsModal.tsx` | Add column-width selector row next to density |
| `frontend/src/styles/styles.css` | Two `[data-column-size="…"] .col` rules |

## Testing

**Visual smoke:**

* Open dashboard, default → columns 320 px (no visible change from today).
* Click `+` → columns 400 px; horizontal scrollbar adjusts; existing cards
  reflow internally (chips wrap or don't wrap based on space — no overflow).
* Click `+` again → button disabled at "wide".
* Click `−` twice → "narrow" 280 px; verify card content still readable
  (branch/PR chip truncates gracefully).
* Open `Settings → Column width` → matches the dashboard control value;
  changing one updates the other.
* Reload page → choice persisted.
* Combine with `density=compact` and `columnSize=narrow` → maximum density,
  no visual breakage.
* Mobile / narrow viewport (`max-width: 800px` rule at `styles.css:1529`) →
  the `85vw` override still wins for narrow screens regardless of
  `columnSize`.

**Persistence:**

* Confirm `settings.columnSize` round-trips through
  `loadSettings()` / `saveSettings()` (`settings.ts:80-90`).
* Old persisted state (no `columnSize` key) → defaults to `"normal"` via
  the existing merge in `loadSettings()`.

## Open questions / future work

* **Wider step.** If 400 px still leaves dead space on ultrawide displays,
  add a fourth step `"xl"` at 480 px. Skipped now — three matches the
  ticket and avoids paradox-of-choice.
* **Per-display-size memory.** Could remember a different choice when the
  window crosses a width threshold. Not worth the complexity in v0.1.

---

## v0.2 — Terminal modal also resizes

**Status:** Draft (follow-up to v0.1, same branch / same ticket)

### Why this exists

The Linear title is "Allow 3 sizes for the terminal panes." v0.1 read "panes"
as kanban columns and shipped a column-width control. That covers the
dashboard, but on a 27"+ display the *open terminal modal* still tops out at
`min(1200px, 96vw)` (`styles.css:996`) — exactly the dead-space complaint
v0.1 was meant to fix, just at a different layer. v0.2 extends the same
`columnSize` setting to drive the modal's width too, so one knob controls
both surfaces.

### Scope

Extend `columnSize` to drive the `.term-modal` width. **No new setting key.**
The kanban column rules from v0.1 are untouched. Modal height stays at
`min(82vh, 820px)` — width-only scaling, per user preference (the goal is
"leverage wider monitors," not "make the modal take over the screen
vertically").

### Modal width scale

vw-based, no px cap (uncapping is the whole point — a cap would re-introduce
the dead-space problem on big monitors):

| `columnSize` | modal width | example: 1440 px (13" laptop) | example: 2560 px (27") |
|---|---|---|---|
| `narrow` | `70vw` | ~1008 px | ~1792 px |
| `normal` | `85vw` | ~1224 px | ~2176 px |
| `wide`   | `97vw` | ~1396 px | ~2483 px |

Today's `min(1200px, 96vw)` → 1200 px on the 13" laptop (~83 vw), 1200 px on
the 27" (~47 vw). New `normal` (85 vw) lands close to today on the laptop,
meaningfully bigger on the desktop. `wide` is essentially full-bleed.

### CSS

Replace the fixed width rule in `.term-modal` (styles.css:995-1007) with a
base that holds the default and two attribute overrides parallel to the
existing column rules:

```css
.term-modal {
  width: 85vw;                       /* was: min(1200px, 96vw) */
  height: min(82vh, 820px);          /* unchanged */
  /* ...rest unchanged... */
}
[data-column-size="narrow"] .term-modal { width: 70vw; }
[data-column-size="wide"]   .term-modal { width: 97vw; }
/* "normal" inherits the base rule — symmetric with the .col rules at L319-332 */
```

### Live resize: free via existing `ResizeObserver`

`TerminalModal.tsx:238-239` already runs a `ResizeObserver` on the xterm host
that calls `fit.fit()` and forwards the new `cols`/`rows` to tmux as a
`{type:"resize"}` WS message. So when the user clicks the new Size + button
from inside the open modal, the CSS width change → ResizeObserver fires →
xterm reflows → tmux pane reshapes. No new wiring needed in the construction
effect.

### UI: a "Size" labeled +/- pair in the modal footer

The footer today has the font-zoom cluster at the right
(`TerminalModal.tsx:582-606`):

```
[● live] [cwd] … [Kill]  [−  100%  +]  [Esc to pane · Esc Esc to close]
                          ^^^^^^^^^^^^
                          .term-zoom (font zoom)
```

Add a parallel cluster for modal size, with both clusters now labeled so
neither is ambiguous:

```
[● live] [cwd] … [Kill]   Zoom [−  100%  +]   Size [−  normal  +]   [Esc …]
```

* `Size −` decreases `columnSize` (wide → normal → narrow); disabled at
  `narrow`.
* `Size +` increases `columnSize` (narrow → normal → wide); disabled at
  `wide`.
* Middle pill (`.zoom-level` reused, or a new `.size-level` if styling
  diverges) shows the current value (`narrow` / `normal` / `wide`); clicking
  it resets to `normal` — symmetric with the existing zoom-percent reset
  (`TerminalModal.tsx:592-596`).
* Tooltips follow the same `"<verb> (current: <value>)"` shape as the
  kanban control (THI-96 `Tooltip` component), but use the surface-local
  noun: in the modal, `"Narrower pane (current: normal)"` / `"Wider pane"`.
  In the kanban subhead, it stays `"Narrower columns"` / `"Wider columns"`
  (unchanged from v0.1).
* Both clusters call `updateSettings(...)` — `columnSize` for Size, the
  existing `terminalFontSize` for Zoom — so persistence and the kanban
  subhead control stay synchronized for free.

The labels `Zoom` and `Size` are inline `<span>` elements with a muted color
(matches the `.hint` style at `TerminalModal.tsx:607-609`), not stacked above
the controls — keeps the footer single-row.

### Two surfaces, one setting

The kanban subhead `ColumnSizeControl` (`Subhead.tsx:19-52`) is unchanged.
Both surfaces edit the same `columnSize` field via `updateSettings`. When the
modal closes, the kanban columns reflect the new value; when the modal opens
later, it picks up wherever the user left it.

This means **changing column width from the modal also resizes the kanban
columns underneath the scrim** — intentional, given the user thinks of this
as one "size" knob. If that coupling proves surprising in practice, v0.3
could split into `columnSize` + `modalSize`. YAGNI for now.

### Files touched (v0.2)

| File | Change |
|---|---|
| `frontend/src/styles/styles.css` | Replace `.term-modal { width: min(1200px, 96vw); }` with `width: 85vw`; add `[data-column-size="narrow"] .term-modal { width: 70vw }` and `[data-column-size="wide"] .term-modal { width: 97vw }` next to it. |
| `frontend/src/components/TerminalModal.tsx` | Add a `SizeControl` cluster in `.term-foot` (mirrors `.term-zoom` shape). Pull `columnSize` from `useSettings()`. Add `Zoom` label inline with the existing zoom cluster. ~30 LOC, no new component file. |

No backend change. No `settings.ts` change (re-uses v0.1's `columnSize`).
No `App.tsx` change (the `data-column-size` attribute is already set on
`<html>` by the v0.1 effect at L332).

### Testing (v0.2)

**Visual smoke:**

* Open modal at default `columnSize=normal` → width ≈ 85 vw. On a 13"
  laptop indistinguishable from today; on a 27"+ display, the modal is
  noticeably wider than today's 1200 px cap.
* Click `Size +` while modal open → modal animates / snaps to 97 vw;
  xterm reflows; tmux pane resizes to the new `cols` × `rows` (verify
  via `tmux list-windows` or by typing — input column count matches).
* Click `Size −` twice → `narrow` (70 vw); xterm still readable; no
  scrollbar lock.
* `Size +` disabled at `wide`; `Size −` disabled at `narrow` — mirrors
  the kanban subhead control.
* Click the middle `narrow|normal|wide` pill → resets to `normal`.
* Open modal, change Size, close modal → kanban columns reflect the new
  width.
* Combine `Size = wide` with `Zoom = 200%` → both apply independently;
  no interaction bugs.

**Cross-surface sync:**

* In the kanban, click `+` to set `wide`. Open a modal → it's at 97 vw.
* Inside the modal, click `Size −`. Close the modal → kanban columns are
  now `normal`.

**Persistence:**

* `columnSize` round-trip already covered in v0.1 testing — no new
  persistence path.

**Edge cases:**

* Very narrow viewport (< 800 px, where the kanban falls back to 85 vw
  columns via the `@media` rule at `styles.css:1529`): modal at 70 vw is
  still ≥ ~560 px → xterm refits to ~70 cols, viable for a quick glance.
  Not a primary target.
* xterm minimum: `fit()` will collapse to whatever the container allows;
  even at 70 vw on a 1280 px laptop = ~896 px → ~120 cols. Comfortable.

### Open questions / future work (v0.2)

* **Decouple modal from kanban.** If the kanban-coupling surprises users
  in practice, split into two settings. Watch for feedback before splitting.
* **Even wider for ultrawide.** Could add a fourth `"xl"` step (or just
  bump `wide` to 100vw with a small border-radius reset). Skipped now —
  97 vw already lets the user fill an ultrawide if they want.
* **Modal height scaling.** Width-only by design. If a future user
  requests it, add a similar override on `height`.
