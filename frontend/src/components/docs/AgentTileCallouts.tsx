/**
 * Orthogonal callout overlay for the Agent tile (THI-143).
 *
 * Each callout is an L-with-leg shape:
 *
 *     anchor → horizontal stub to bend → vertical → horizontal to label
 *
 * Originally the design specified a SHARED vertical rail outside each
 * card edge so every callout passed through the same x. In practice
 * that made the verticals fully overlap into one dotted column with
 * indistinguishable stubs/ribs, so we now give each callout its OWN
 * bend x — staggered as a fan that opens away from the card. The L
 * shape and the orthogonal-only constraint are preserved; only the
 * shared rail is dropped.
 *
 * Coords use the same source frame as `AgentCardArt` (card at
 * 400..700 / 30..430) so the layout numbers track the diagram.
 */

interface Props {
  cx: number;
  cy: number;
}

interface Label {
  side: "L" | "R";
  id: string;
  ax: number; // anchor x in source frame
  ay: number; // anchor y in source frame
  /** Bend x in source frame — each callout's own vertical leg sits here,
   *  fanned out from neighbours so the lines remain individually traceable. */
  bx: number;
  /** y of the bend-to-label horizontal segment (also the label baseline). */
  labelY: number;
  title: string;
  desc: string;
}

// Bend x's staggered per callout. Left side: bend x grows with labelY
// (top callout's bend sits farthest from the card, bottom closest), so
// the verticals fan into the gutter and each L is visually independent.
// Right side mirrors: bend x shrinks with labelY (top farthest from
// card on the right side too). All bx values stay safely between the
// card edge and the label gutter so no vertical sits inside the card.
const LABELS: ReadonlyArray<Label> = [
  // Left side (5) — source-coord card-left is 400; bends fan in 362..394.
  { side: "L", id: "kind", ax: 418, ay: 57, bx: 362, labelY: 64, title: "Kind glyph", desc: "Claude vs shell" },
  { side: "L", id: "name", ax: 452, ay: 62, bx: 370, labelY: 124, title: "Window name", desc: "Name : tmux index" },
  { side: "L", id: "branch", ax: 418, ay: 103, bx: 378, labelY: 184, title: "Branch + PR", desc: "● dot color = CI state" },
  { side: "L", id: "context", ax: 400, ay: 230, bx: 386, labelY: 280, title: "Context %", desc: "Green · amber · orange · red" },
  { side: "L", id: "actions", ax: 418, ay: 393, bx: 394, labelY: 410, title: "Footer actions", desc: "Focus · rename · keys · kill" },
  // Right side (3) — source-coord card-right is 700; bends fan in 738..754.
  { side: "R", id: "status", ax: 678, ay: 57, bx: 754, labelY: 64, title: "Status pill", desc: "running · waiting · idle · done · error" },
  { side: "R", id: "pending", ax: 682, ay: 205, bx: 746, labelY: 200, title: "Pending block", desc: "Agent is waiting on you" },
  { side: "R", id: "preview", ax: 658, ay: 273, bx: 738, labelY: 296, title: "Terminal preview", desc: "Last captured stdout" },
];

// Label gutters (screen coords). Left side anchors text right-aligned to
// `gutterL - 10`; right side anchors text left-aligned to `gutterR + 10`.
const GUTTER_L = 400;
const GUTTER_R = 840;

export function AgentTileCallouts({ cx, cy }: Props) {
  const X = (x: number) => cx + (x - 400);
  const Y = (y: number) => cy + (y - 30);

  return (
    <g className="docs-callouts">
      {LABELS.map((L) => {
        const ax = X(L.ax);
        const ay = Y(L.ay);
        const bx = X(L.bx);
        const labelY = Y(L.labelY);
        const gutter = L.side === "L" ? GUTTER_L : GUTTER_R;
        // anchor → bend-x at anchor-y → bend-x at label-y → gutter at label-y.
        const d = `M${ax},${ay} L${bx},${ay} L${bx},${labelY} L${gutter},${labelY}`;
        const tx = L.side === "L" ? gutter - 10 : gutter + 10;
        const anchor = L.side === "L" ? "end" : "start";
        return (
          <g key={L.id}>
            <path d={d} className="callout-line" fill="none" />
            <circle cx={ax} cy={ay} r="2.5" className="callout-dot" />
            <text x={tx} y={labelY - 4} textAnchor={anchor} className="callout-label-strong">
              {L.title}
            </text>
            <text x={tx} y={labelY + 11} textAnchor={anchor} className="callout-label">
              {L.desc}
            </text>
          </g>
        );
      })}
    </g>
  );
}
