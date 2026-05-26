/**
 * Orthogonal callout overlay for the Shell tile (THI-143).
 *
 * Same shape as `AgentTileCallouts` after we dropped the shared rail —
 * each callout has its own bend x so its L-shape stays individually
 * traceable from anchor to label. Source coords follow `ShellCardArt`'s
 * normalized frame (card at 400..700 / 30..360).
 */

interface Props {
  cx: number;
  cy: number;
}

interface Label {
  side: "L" | "R";
  id: string;
  ax: number;
  ay: number;
  bx: number;
  labelY: number;
  title: string;
  desc: string;
}

const LABELS: ReadonlyArray<Label> = [
  // Left side (4) — bends staggered top-deep / bottom-shallow.
  { side: "L", id: "kind", ax: 418, ay: 57, bx: 370, labelY: 64, title: "Kind glyph", desc: "Shell prompt — pane is a plain shell" },
  { side: "L", id: "name", ax: 452, ay: 62, bx: 378, labelY: 144, title: "Window name", desc: "Name : tmux index" },
  { side: "L", id: "branch", ax: 418, ay: 103, bx: 386, labelY: 224, title: "Branch chip", desc: "Git branch when cwd is inside a repo" },
  { side: "L", id: "actions", ax: 418, ay: 325, bx: 394, labelY: 340, title: "Footer actions", desc: "Focus · rename · keys · kill" },
  // Right side (2)
  { side: "R", id: "status", ax: 678, ay: 57, bx: 746, labelY: 64, title: "Status pill", desc: "running (process) · idle (at prompt)" },
  { side: "R", id: "preview", ax: 638, ay: 192, bx: 738, labelY: 200, title: "Terminal preview", desc: "Last captured stdout" },
];

const GUTTER_L = 400;
const GUTTER_R = 840;

export function ShellTileCallouts({ cx, cy }: Props) {
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
