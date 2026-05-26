/**
 * Pure session-header SVG illustration (THI-143).
 *
 * Same shape pattern as `AgentCardArt` / `ShellCardArt`: pure art with
 * `<g data-part="…">` wrappers, no callouts. The header is a horizontal
 * bar rather than a vertical card, but the parametrization rules are
 * identical — caller passes `(cx, cy)` to place the bar's top-left, and
 * internal source coords assume the bar starts at (400, 30) so the
 * X/Y helpers are uniform across all three diagrams.
 *
 * Bar dimensions: 300×44. Internal layout matches the production
 * `.col-hd`'s left-to-right ordering: attached dot · name · drag grip ·
 * count badge · +claude · +shell · ⋮ menu.
 */

interface Props {
  cx: number;
  cy: number;
}

export function HeaderBarArt({ cx, cy }: Props) {
  const X = (x: number) => cx + (x - 400);
  const Y = (y: number) => cy + (y - 30);

  return (
    <g className="diagram-card">
      {/* bar outline */}
      <rect x={X(400)} y={Y(30)} width="300" height="44" rx="10" />

      {/* attached dot */}
      <g data-part="attached">
        <circle cx={X(420)} cy={Y(52)} r="5" className="dot-attached" />
      </g>

      {/* session name */}
      <g data-part="name">
        <text x={X(434)} y={Y(57)} className="diagram-text">main</text>
      </g>

      {/* drag grip dots */}
      <g data-part="drag" className="grip">
        <circle cx={X(488)} cy={Y(44)} r="1.4" />
        <circle cx={X(488)} cy={Y(52)} r="1.4" />
        <circle cx={X(488)} cy={Y(60)} r="1.4" />
        <circle cx={X(496)} cy={Y(44)} r="1.4" />
        <circle cx={X(496)} cy={Y(52)} r="1.4" />
        <circle cx={X(496)} cy={Y(60)} r="1.4" />
      </g>

      {/* window count badge */}
      <g data-part="count">
        <rect x={X(510)} y={Y(38)} width="28" height="28" rx="6" className="badge" />
        <text x={X(524)} y={Y(57)} textAnchor="middle" className="diagram-text strong">4</text>
      </g>

      {/* +claude quick-create */}
      <g data-part="quick-claude">
        <rect x={X(546)} y={Y(38)} width="58" height="28" rx="6" className="btn-quick" />
        <text x={X(575)} y={Y(57)} textAnchor="middle" className="diagram-text small">+claude</text>
      </g>

      {/* +shell quick-create */}
      <g data-part="quick-shell">
        <rect x={X(610)} y={Y(38)} width="50" height="28" rx="6" className="btn-quick" />
        <text x={X(635)} y={Y(57)} textAnchor="middle" className="diagram-text small">+shell</text>
      </g>

      {/* ⋮ actions kebab */}
      <g data-part="actions">
        <text x={X(682)} y={Y(60)} textAnchor="middle" className="diagram-text strong">⋮</text>
      </g>
    </g>
  );
}

// Header bar's annotated parts. Smaller set than Agent/Shell since the
// bar is a single horizontal control, not a multi-region card.
export const HEADER_PARTS: ReadonlyArray<{ id: string; title: string; desc: string }> = [
  { id: "attached", title: "Attached dot", desc: "Green while a tmux client is attached to this session." },
  { id: "name", title: "Session name", desc: "Click to rename the session." },
  { id: "drag", title: "Drag the bar", desc: "Reorder session columns left-to-right." },
  { id: "count", title: "Window count", desc: "Glows when any pane is waiting on input." },
  { id: "quick-claude", title: "+claude", desc: "Quick-create a new Claude agent window in this session." },
  { id: "quick-shell", title: "+shell", desc: "Quick-create a new shell window in this session." },
  { id: "actions", title: "⋮  Actions menu", desc: "Named window · rename session · kill session." },
];
