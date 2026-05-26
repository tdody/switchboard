# THI-135 — Replace Claude agent icon with Claude Code mark

**Linear:** [THI-135](https://linear.app/thibault-dody/issue/THI-135/replace-claude-agent-logo-with-claude-code)
**Date:** 2026-05-25
**Status:** Draft

## Summary

The current Claude agent kind icon (`Icon.tsx:282-288`, "agent") is a
generic person silhouette: a head circle plus a torso path. Replace it with
the Claude Code mark supplied by the user in the conversation that produced
this spec:

```
 ▐▛███▜▌
▝▜█████▛▘
  ▘▘ ▝▝
```

Two rendering paths: a vector transcription for small icon slots (the
12 px card-kind glyph and the modal-header chip), and the literal ASCII
where a monospaced text rendering fits naturally (header tooltip,
docs-tab diagram from THI-136).

## Background

Today the "agent" kind glyph (`status.ts:35-50` → `Icon.tsx:282`) is used
in three places:

1. `WindowCard.tsx:62` — `<Icon name={kindIcon(w.kind)} size={12} />` in
   the card head.
2. `TerminalModal.tsx` header (verified during exploration) — the same
   kind glyph re-rendered alongside session/window labels.
3. `Subhead.tsx` (after THI-130 lands) — chip toggle for `kind === "agent"`.

The icon name `agent` will keep its identity through the swap; only the
SVG body changes. Every consumer that calls `kindIcon("agent")` continues
to work without modification.

The Header pill from THI-110 uses `SwitchboardMark` (`Header.tsx:38`),
**not** the agent kind icon — out of scope for this ticket. The Switchboard
brand mark stays as-is.

## Non-goals

* **Renaming or restructuring `IconName`.** The string `"agent"` stays.
* **Animating the icon.** Static.
* **Swapping the Switchboard brand mark in the header.** That's
  `SwitchboardMark.tsx`, separate identity, separate decision.
* **Per-theme variants.** The icon inherits `currentColor` from its parent
  (the existing `<svg stroke="currentColor">` pattern at `Icon.tsx:55`),
  so it automatically follows the active theme.
* **lobehub-sourced SVG.** The original ticket mentioned lobehub; the user
  later supplied the ASCII glyph directly. Use the ASCII; ignore lobehub.

## Architecture

### Shape transcription

Each Unicode block character maps to one or two filled quarter-cells of a
2-row half-block grid. The 3-row × 9-column ASCII renders as a 6-row ×
9-column grid of half-cells:

```
ascii row 1:  . ▐ ▛ █ █ █ ▜ ▌ .       (right-half, left+top, full, full, full, right+top, left-half)
ascii row 2:  ▝ ▜ █ █ █ █ █ ▛ ▘       (right+top, left+top, full×5, right+top, top-left-quarter)
ascii row 3:  . . ▘ ▘ . ▝ ▝ . .       (top-left-quarter ×2, top-right-quarter ×2)
```

Expanded into a 6-row half-cell matrix (1 = filled, 0 = empty), where each
ASCII row becomes two grid rows (upper half then lower half of the block
character):

```
col:  0 1 2 3 4 5 6 7 8

r0:   . . 1 1 1 1 1 . .     (upper half of row 1)
r1:   . 1 1 1 1 1 1 1 .     (lower half of row 1)
r2:   . 1 1 1 1 1 1 1 .     (upper half of row 2)
r3:   1 1 1 1 1 1 1 1 1     (lower half of row 2)
r4:   . . 1 1 . . 1 1 .     (upper half of row 3)
r5:   . . . . . . . . .     (lower half of row 3 — all bottom-aligned glyphs)
```

That matrix above is the rendering source of truth. An implementer should
verify it by pasting the ASCII into a wide-cell monospace font (Iosevka,
SF Mono) and crossing each glyph against the table.

### SVG implementation

```tsx
// Icon.tsx — replace the "agent" case body.
case "agent":
  return (
    <svg {...props} viewBox="0 0 18 12">
      {/*
        Claude Code mark — see THI-135 spec for the half-cell matrix.
        Each cell is 2×2 in the 18×12 viewBox so the shape fills the box.
      */}
      <g fill="currentColor" stroke="none">
        {/* row 0 */}
        <rect x="4"  y="0" width="10" height="2" />
        {/* row 1 */}
        <rect x="2"  y="2" width="14" height="2" />
        {/* row 2 */}
        <rect x="2"  y="4" width="14" height="2" />
        {/* row 3 */}
        <rect x="0"  y="6" width="18" height="2" />
        {/* row 4 — two paired blocks (eyes) */}
        <rect x="4"  y="8" width="4"  height="2" />
        <rect x="12" y="8" width="4"  height="2" />
      </g>
    </svg>
  );
```

The viewBox changes from the icon-default `0 0 16 16` to `0 0 18 12` to
match the glyph's natural 9:6 cell aspect. Because `Icon.tsx:49-61` does
not hardcode the viewBox at the `<svg>` props level (it threads it through
`props`), the per-case override at the `<svg>` line is the only edit
needed; sizing via the `size` prop continues to work (it sets `width` and
`height` numerically — the renderer scales the viewBox to fit).

`fill="currentColor"` + `stroke="none"` is used because this glyph is a
filled solid mark; the default `stroke="currentColor"` + `fill="none"`
pattern used by every other icon would render only the outlines of the
rects, which is wrong for this mark.

### ASCII fallback for larger surfaces

In contexts where a monospace render is more legible than a downscaled
SVG — specifically the docs-tab callouts (THI-136) and the auto-rename
tooltip — keep the literal ASCII as a `<pre>` block:

```tsx
<pre className="claude-mark" aria-label="Claude Code">
{` ▐▛███▜▌\n▝▜█████▛▘\n  ▘▘ ▝▝`}
</pre>
```

```css
.claude-mark {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  color: var(--text);
  margin: 0;
}
```

This is **optional** — the SVG covers every today-shipping surface. The
ASCII variant is offered for THI-136 to consume if the docs designer
wants a recognizable "this is the Claude Code mark" call-out.

### Licensing

The ASCII glyph was provided directly by the project maintainer in the
conversation that produced this spec. No third-party license to chase.
The earlier ticket text referenced lobehub's icon library; that path is
abandoned and no lobehub asset is vendored.

## Files touched

| File | Change |
|---|---|
| `frontend/src/components/Icon.tsx` | Replace the `case "agent":` block; change viewBox to `0 0 18 12`; switch to `fill="currentColor"` |
| `frontend/src/styles/styles.css` | Add `.claude-mark` rule (only if THI-136 ends up using the ASCII fallback; can land later) |

The `kindIcon()` lookup in `status.ts:35-50` is unchanged.

## Testing

**Visual smoke:**

* Open dashboard with a Claude pane. Card head shows the new mark at 12 px.
* Confirm `currentColor` follows theme: dark theme = light mark; light
  theme = dark mark.
* Open the terminal modal on the same pane; verify the header chip uses
  the new mark.
* If THI-130 has landed, the Subhead "Agent" chip uses the new mark.
* Compact density (`Settings → Density: compact`) — mark still rendered
  in the smaller card head row.
* Auto-rename modal preview rows (THI-67) — the row icon, if it shows the
  kind, uses the new mark.

**Pixel sanity:**

* Inspect the rendered `<svg>` in DevTools: the 6-rect path matches the
  matrix in this spec exactly. (A typo in any `x`/`y`/`width` produces a
  visibly wrong glyph; cheap to eyeball.)

## Open questions / future work

* **A more refined SVG.** The half-cell rect transcription is faithful to
  the ASCII but loses the rounded corners a designer might add. If we
  ever get a designer-finished mark, swap the SVG body without touching
  any consumer.
* **Hover affordance.** Could pulse on `pendingInput`. Out of scope; pulse
  already lives on the card border.
