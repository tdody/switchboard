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

The terminal modal is fullscreen-overlay (not constrained by column width),
so `columnSize` does not affect xterm fit. Confirmed by reading
`TerminalModal.tsx` — it uses its own root container, not the kanban
column. No `fit()` call needed.

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
