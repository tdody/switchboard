/**
 * V1 orthogonal-callout overlay for the Session header bar (THI-143).
 *
 * The bar is horizontal — so the rails rotate 90° from the Agent/Shell
 * version: instead of left/right rails outside the card, we have TOP and
 * BOTTOM rails just outside the bar. Each callout becomes:
 *
 *     anchor → vertical stub to rail → horizontal along rail → vertical to label
 *
 * Same shape (L-with-leg), same shared-rail principle, just rotated. All
 * 7 affordances on the bar get a callout (the bar is already ≤8 items;
 * nothing demoted to the "Also visible —" strip for this tab).
 */

interface Props {
  cx: number;
  cy: number;
}

interface Label {
  side: "T" | "B";
  id: string;
  /** Anchor x in source frame; anchor y is bar-top edge for T, bar-bottom for B. */
  ax: number;
  /** Label horizontal position in screen coords; label text is centered here. */
  labelX: number;
  title: string;
  desc: string;
}

// Locked layout: 4 above the bar, 3 below. The labelX values are spaced
// so adjacent labels don't visually overlap (each label runs ~180 px
// wide; gaps between centers stay >=200 px).
const LABELS: ReadonlyArray<Label> = [
  // Top half — info affordances
  { side: "T", id: "attached", ax: 420, labelX: 150, title: "Attached dot", desc: "Green while a tmux client is attached" },
  { side: "T", id: "name", ax: 434, labelX: 400, title: "Session name", desc: "Click to rename" },
  { side: "T", id: "drag", ax: 492, labelX: 700, title: "Drag the bar", desc: "Reorder session columns" },
  { side: "T", id: "count", ax: 524, labelX: 1000, title: "Window count", desc: "Glows when any pane is waiting" },
  // Bottom half — action affordances
  { side: "B", id: "quick-claude", ax: 575, labelX: 200, title: "+claude", desc: "Quick-create a new Claude agent" },
  { side: "B", id: "quick-shell", ax: 635, labelX: 620, title: "+shell", desc: "Quick-create a new shell window" },
  { side: "B", id: "actions", ax: 682, labelX: 1040, title: "⋮  Actions menu", desc: "Named · rename · kill session" },
];

// Label y-positions (screen coords). One per side; all callouts on that
// side share the same label baseline so the design reads as one row of
// labels above + one row below.
const LABEL_Y_TOP = 60;
const LABEL_Y_BOTTOM = 420;

export function HeaderBarCallouts({ cx, cy }: Props) {
  const X = (x: number) => cx + (x - 400);
  // Bar top at cy, bar bottom at cy + 44 (bar height); rails 6 px outside.
  const railTop = cy - 6;
  const railBottom = cy + 44 + 6;
  const barTop = cy;
  const barBottom = cy + 44;

  return (
    <g className="docs-callouts">
      {LABELS.map((L) => {
        const ax = X(L.ax);
        const isTop = L.side === "T";
        const ay = isTop ? barTop : barBottom;
        const rail = isTop ? railTop : railBottom;
        const labelY = isTop ? LABEL_Y_TOP : LABEL_Y_BOTTOM;
        // Anchor → vertical stub to rail → horizontal along rail → vertical to label.
        const d = `M${ax},${ay} L${ax},${rail} L${L.labelX},${rail} L${L.labelX},${labelY}`;
        // Title and description stack the same way (title above, desc
        // below) regardless of which side of the bar the label sits on.
        return (
          <g key={L.id}>
            <path d={d} className="callout-line" fill="none" />
            <circle cx={ax} cy={ay} r="2.5" className="callout-dot" />
            <text
              x={L.labelX}
              y={labelY - 4}
              textAnchor="middle"
              className="callout-label-strong"
            >
              {L.title}
            </text>
            <text x={L.labelX} y={labelY + 11} textAnchor="middle" className="callout-label">
              {L.desc}
            </text>
          </g>
        );
      })}
    </g>
  );
}
