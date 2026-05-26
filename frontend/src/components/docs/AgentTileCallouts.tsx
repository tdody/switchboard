/**
 * V1 orthogonal-callout overlay for the Agent tile (THI-143).
 *
 * Eight callouts, all routed through one shared vertical rail per side
 * just outside the card. Every line follows the same L-with-leg shape:
 *
 *     anchor → horizontal stub to rail → vertical along rail → horizontal to gutter
 *
 * No diagonals, no per-callout splay. Verbatim mapping of the handoff's
 * `v1-orthogonal.jsx` reference; the source coords match
 * `AgentCardArt`'s internal frame (card at 400..700 / 30..430).
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
  labelY: number; // rail-to-gutter horizontal segment y (also label baseline)
  title: string;
  desc: string;
}

// Locked layout from the handoff. 5 on the left rail, 3 on the right.
const LABELS: ReadonlyArray<Label> = [
  { side: "L", id: "kind", ax: 418, ay: 57, labelY: 64, title: "Kind glyph", desc: "Claude vs shell" },
  { side: "L", id: "name", ax: 452, ay: 62, labelY: 124, title: "Window name", desc: "Name : tmux index" },
  { side: "L", id: "branch", ax: 418, ay: 103, labelY: 184, title: "Branch + PR", desc: "● dot color = CI state" },
  { side: "L", id: "context", ax: 400, ay: 230, labelY: 280, title: "Context %", desc: "Green · amber · orange · red" },
  { side: "L", id: "actions", ax: 418, ay: 393, labelY: 410, title: "Footer actions", desc: "Focus · rename · keys · kill" },
  { side: "R", id: "status", ax: 678, ay: 57, labelY: 64, title: "Status pill", desc: "running · waiting · idle · done · error" },
  { side: "R", id: "pending", ax: 682, ay: 205, labelY: 200, title: "Pending block", desc: "Agent is waiting on you" },
  { side: "R", id: "preview", ax: 658, ay: 273, labelY: 296, title: "Terminal preview", desc: "Last captured stdout" },
];

export function AgentTileCallouts({ cx, cy }: Props) {
  const X = (x: number) => cx + (x - 400);
  const Y = (y: number) => cy + (y - 30);

  // Shared rails 6px outside the card edges (card spans X(400)..X(700)).
  const railL = X(394);
  const railR = X(706);
  // Label gutters in screen coords. Text right-anchors to gutterL,
  // left-anchors to gutterR.
  const gutterL = 400;
  const gutterR = 840;

  return (
    <g className="docs-callouts">
      {LABELS.map((L) => {
        const ax = X(L.ax);
        const ay = Y(L.ay);
        const labelY = Y(L.labelY);
        const rail = L.side === "L" ? railL : railR;
        const gutter = L.side === "L" ? gutterL : gutterR;
        const d = `M${ax},${ay} L${rail},${ay} L${rail},${labelY} L${gutter},${labelY}`;
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
