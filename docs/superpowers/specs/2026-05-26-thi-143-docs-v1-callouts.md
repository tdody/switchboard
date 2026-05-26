# THI-143 — Documentation modal: V1 orthogonal callouts

**Linear:** [THI-143](https://linear.app/thibault-dody/issue/THI-143/update-documentation-ui)
**Date:** 2026-05-26
**Status:** Draft

## Summary

Apply the design handoff at `~/Downloads/design_handoff_docs_modal_v1/`
("V1 · Orthogonal callouts") to all three tabs of the in-app Documentation
modal. The handoff explicitly designs only the Agent tile; we adapt the
same idiom to Shell tile (vertical card, mirror Agent's left/right rails)
and Session header (horizontal bar, rotate the rails 90° to top/bottom).

## What V1 is

Three principles, lifted from the handoff README:

1. **Single consistent callout language** — every line is L-with-a-leg:
   anchor → short stub orthogonal to the diagram → long segment along a
   shared rail → orthogonal segment to the label gutter. **No diagonals.**
2. **Shared rails** — all callouts on a given side route through ONE rail
   just outside the diagram edge, so the diagram has one vertical (or
   horizontal) backbone per side with horizontal (vertical) "ribs"
   coming off it. Not 5–8 splayed lanes.
3. **Trim primary callouts, demote secondary annotations** — the most
   informative chips get callouts; the rest move to a single-line "Also
   visible —" footer strip in plain mono text below the diagram.

## Per-tab plan

### Agent tile (drives the design — verbatim from the handoff)

8 primary callouts on shared rails (L = 5, R = 3); 4 items demoted to the
strip. Coords given relative to the source frame at `(cx=470, cy=40)` in
a 1240×480 viewBox.

| Side | Anchor          | Title              | Description                              |
|------|-----------------|--------------------|------------------------------------------|
| L    | kind (418, 57)  | Kind glyph         | Claude vs shell                          |
| L    | name (452, 62)  | Window name        | Name : tmux index                        |
| L    | branch (418, 103) | Branch + PR      | ● dot color = CI state                    |
| L    | context (400, 230) | Context %       | Green · amber · orange · red             |
| L    | actions (418, 393) | Footer actions  | Focus · rename · keys · kill             |
| R    | status (678, 57) | Status pill       | running · waiting · idle · done · error  |
| R    | pending (682, 205) | Pending block   | Agent is waiting on you                   |
| R    | preview (658, 273) | Terminal preview | Last captured stdout                     |

Demoted to "Also visible —" strip: **Spinner**, **Recap**, **CPU / mem**,
**Age**.

### Shell tile (Agent's idiom applied to a simpler card)

The shell card has 8 candidate annotation targets. Following the same
demote rule (push conditional / footer-y items to the strip), keep 6
primary callouts and demote 2:

| Side | Title              | Description                              |
|------|--------------------|------------------------------------------|
| L    | Kind glyph         | Shell prompt — pane is a plain shell     |
| L    | Window name        | Name : tmux index                         |
| L    | Branch chip        | Current git branch when cwd is in repo   |
| L    | Footer actions     | Focus · rename · keys · kill             |
| R    | Status pill        | running (active process) · idle (at prompt) |
| R    | Terminal preview   | Last captured stdout                      |

Demoted: **CPU / mem** (only shown when elevated), **Age** (last activity).

### Session header (rotated idiom for a horizontal layout)

The header is a horizontal bar, not a vertical card, so the rails rotate
90°: shared rail ABOVE the bar for top-side callouts, shared rail BELOW
for bottom-side callouts. Every callout path becomes:
`anchor → vertical stub to rail → horizontal along rail → vertical to label`.

7 affordances on the bar; keep all 7 (≤8 already, nothing obvious to
demote). The "Also visible —" strip for this tab carries cross-references
to related drag features (THI-115 / THI-141), as a deliberate teaching
opportunity rather than a list of demoted parts:

| Side | Title              | Description                              |
|------|--------------------|------------------------------------------|
| Top  | Session name       | Click to rename                          |
| Top  | Drag the bar       | Reorder session columns                  |
| Top  | ⋮ Actions menu     | Named window · rename · kill session     |
| Btm  | Attached dot       | Green while a tmux client is attached    |
| Btm  | Window count       | Glows when any pane is waiting on input  |
| Btm  | +claude            | Quick-create a Claude agent window       |
| Btm  | +shell             | Quick-create a shell window              |

"Also visible —" strip content: `Drag tiles within a column to reorder
them (THI-141)`. (Just one item; the strip stays compact.)

## Component layout

The handoff specifies a three-piece split. Applying that to all three tabs:

```
frontend/src/components/docs/
  AgentCardArt.tsx       — pure card SVG, <g data-part="…"> wrappers, AGENT_PARTS metadata
  ShellCardArt.tsx       — same shape, shell-specific parts
  HeaderBarArt.tsx       — horizontal bar SVG, <g data-part="…"> wrappers

  AgentTileCallouts.tsx  — V1 orthogonal overlay (left/right rails)
  ShellTileCallouts.tsx  — same shape
  HeaderBarCallouts.tsx  — rotated (top/bottom rails)

  DocsSecondary.tsx      — shared "Also visible —" footer strip, takes an items[] prop
  CalloutLine.tsx        — existing — keep for legacy callers if any; otherwise the
                            overlay components emit raw <path> directly per the handoff
```

`DocsModal.tsx` body per tab becomes:

```tsx
<div className="docs-tab-body">
  <svg className="docs-diagram" viewBox="0 0 1240 480" preserveAspectRatio="xMidYMid meet">
    <AgentCardArt cx={470} cy={40} />
    <AgentTileCallouts cx={470} cy={40} />
  </svg>
  <DocsSecondary items={AGENT_DEMOTED} />
</div>
```

Tabs identical in shape; only the content props change. The variant chip
in the modal header is **dropped** (per ticket discussion).

## Callout path generation

Pure function in each overlay component:

```ts
// Agent / Shell — vertical card, rails left and right of the card
function buildL_VerticalCard(
  side: "L" | "R",
  ax: number, ay: number, labelY: number,
  railL: number, railR: number,
  gutterL: number, gutterR: number,
): string {
  const rail = side === "L" ? railL : railR;
  const gutter = side === "L" ? gutterL : gutterR;
  return `M${ax},${ay} L${rail},${ay} L${rail},${labelY} L${gutter},${labelY}`;
}

// Session header — horizontal bar, rails above and below the bar
function buildL_HorizontalBar(
  side: "T" | "B",
  ax: number, ay: number, labelX: number,
  railT: number, railB: number,
  gutterT: number, gutterB: number,
): string {
  const rail = side === "T" ? railT : railB;
  const gutter = side === "T" ? gutterT : gutterB;
  return `M${ax},${ay} L${ax},${rail} L${labelX},${rail} L${labelX},${gutter}`;
}
```

Both shapes are 4-point polylines — the existing `CalloutLine` helper's
`points[]` API already supports this; we'll use raw `<path>` in the
overlays for clarity (the path string is generated inline, fits in one
line per callout).

## Files touched

| File | Change |
|---|---|
| `frontend/src/components/docs/AgentCardArt.tsx` | **New** — pure card art extracted from `AgentDiagram.tsx`, `<g data-part="…">` wrappers, exports `AGENT_PARTS` |
| `frontend/src/components/docs/ShellCardArt.tsx` | **New** — extracted from `ShellDiagram.tsx` |
| `frontend/src/components/docs/HeaderBarArt.tsx` | **New** — extracted from `HeaderDiagram.tsx` |
| `frontend/src/components/docs/AgentTileCallouts.tsx` | **New** — V1 overlay |
| `frontend/src/components/docs/ShellTileCallouts.tsx` | **New** — V1 overlay |
| `frontend/src/components/docs/HeaderBarCallouts.tsx` | **New** — V1 rotated overlay |
| `frontend/src/components/docs/DocsSecondary.tsx` | **New** — "Also visible —" strip |
| `frontend/src/components/docs/AgentDiagram.tsx` | **Removed** — superseded |
| `frontend/src/components/docs/ShellDiagram.tsx` | **Removed** — superseded |
| `frontend/src/components/docs/HeaderDiagram.tsx` | **Removed** — superseded |
| `frontend/src/components/DocsModal.tsx` | Render new components in each tab |
| `frontend/src/styles/docs.css` | Add `.docs-secondary` strip styles; reuse existing `.callout-line`, `.callout-dot`, `.callout-label{,-strong}` |

`CalloutLine.tsx` is unused after this and can be removed; flagging it
for cleanup but leaving in the same commit doesn't change anything.

## Design tokens / classes (already in styles.css)

All colors/typography come from existing tokens. The callout-style classes
the handoff specifies are already present in `docs.css` from THI-136:

- `.callout-line` — `stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 3 3;`
- `.callout-dot` — `fill: var(--accent); stroke: var(--bg);`
- `.callout-label-strong` — 12px sans, 600, `var(--text)`
- `.callout-label` — 11.5px sans, `var(--text-mute)`

Only new class: **`.docs-secondary`** — mono 11px footer strip, absolutely
positioned at `bottom: 24px` of the body with a 1px top hairline.

## Testing

### Automated

No new diagram tests — the existing components are pure-presentational
SVGs and we're swapping geometry, not behavior. Existing DocsModal
tests (close-on-Esc, tab-switching) continue to pass since the modal
chrome is untouched.

### Manual

- Open `Documentation` modal. Each of the three tabs should show:
  - Centered diagram in a `1240×480` viewBox, the card/bar pixel-perfect
    to the handoff geometry.
  - Callouts: every line L-with-leg, no diagonals, single rail per side.
  - "Also visible —" strip pinned to `bottom: 24px` of the body.
- Resize the modal width down to ~800 px: SVG scales proportionally,
  layout doesn't break (test against `min(1240px, 96vw)`).
- Side-by-side compare against `~/Downloads/design_handoff_docs_modal_v1/Documentation_V1.html`
  — Agent tile should be pixel-equivalent.

## Open questions / future work

- **`CalloutLine.tsx`** is now unreferenced and can be deleted in a
  follow-up. Leaving in place this PR keeps the diff focused.
- **V2/V3/V4 variants** the README's parent project mentions
  (numbered legend, interactive, stacked sections) aren't in scope.
  The `<Part>` / `AGENT_PARTS` pattern makes those incremental.
- **Variant chip** dropped from the header. If we later want a "design
  version" indicator, the slot is easy to re-add — just keep it out of
  shipping for now.
