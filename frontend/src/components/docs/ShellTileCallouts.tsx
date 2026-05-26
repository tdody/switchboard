/**
 * V1 orthogonal-callout overlay for the Shell tile (THI-143).
 *
 * Same idiom as `AgentTileCallouts` — shared rails outside the card,
 * every line L-with-leg, no diagonals. Shell has fewer parts than
 * Agent, so the layout settles at 6 primary callouts (4 left, 2 right);
 * `CPU / memory` and `Last activity` move to the "Also visible" strip.
 *
 * Source coordinates assume `ShellCardArt`'s normalized frame: card at
 * 400..700 / 30..360 (shorter than Agent's 400-tall card).
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
  labelY: number;
  title: string;
  desc: string;
}

const LABELS: ReadonlyArray<Label> = [
  { side: "L", id: "kind", ax: 418, ay: 57, labelY: 64, title: "Kind glyph", desc: "Shell prompt — pane is a plain shell" },
  { side: "L", id: "name", ax: 452, ay: 62, labelY: 144, title: "Window name", desc: "Name : tmux index" },
  { side: "L", id: "branch", ax: 418, ay: 103, labelY: 224, title: "Branch chip", desc: "Git branch when cwd is inside a repo" },
  { side: "L", id: "actions", ax: 418, ay: 325, labelY: 340, title: "Footer actions", desc: "Focus · rename · keys · kill" },
  { side: "R", id: "status", ax: 678, ay: 57, labelY: 64, title: "Status pill", desc: "running (process) · idle (at prompt)" },
  { side: "R", id: "preview", ax: 638, ay: 192, labelY: 200, title: "Terminal preview", desc: "Last captured stdout" },
];

export function ShellTileCallouts({ cx, cy }: Props) {
  const X = (x: number) => cx + (x - 400);
  const Y = (y: number) => cy + (y - 30);

  const railL = X(394);
  const railR = X(706);
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
