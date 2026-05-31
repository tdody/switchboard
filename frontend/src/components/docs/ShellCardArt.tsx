/**
 * Pure shell-tile SVG illustration (THI-143).
 *
 * Same shape as `AgentCardArt`: pure card art with `<g data-part="…">`
 * wrappers, no callouts. Shell tiles are shorter than agent tiles (330
 * tall vs 400 — no context strip, no agent-block subsections), but the
 * parametrization mirrors Agent's so the V1 callout overlay can use the
 * same X/Y helper math.
 *
 * Internal source coords are normalized so the card's top-left sits at
 * (400, 30) — identical to AgentCardArt — and `(cx, cy)` translates the
 * whole thing into the parent SVG.
 */

interface Props {
  cx: number;
  cy: number;
}

export function ShellCardArt({ cx, cy }: Props) {
  const X = (x: number) => cx + (x - 400);
  const Y = (y: number) => cy + (y - 30);

  return (
    <g className="diagram-card">
      {/* card outline — 300×330 (shorter than agent's 400) */}
      <rect x={X(400)} y={Y(30)} width="300" height="330" rx="10" />

      {/* card-head: shell-tinted kind glyph + name/idx + status pill */}
      <g data-part="kind">
        <rect
          x={X(418)}
          y={Y(46)}
          width="22"
          height="22"
          rx="6"
          className="kind-box kind-box-shell"
        />
        <text x={X(429)} y={Y(62)} textAnchor="middle" className="diagram-text small strong">
          &gt;_
        </text>
      </g>
      <g data-part="name">
        <text x={X(452)} y={Y(62)} className="diagram-text strong">dev-server</text>
        <text x={X(540)} y={Y(62)} className="diagram-text dim">:3</text>
      </g>
      <g data-part="status">
        <rect x={X(594)} y={Y(46)} width="84" height="22" rx="11" className="pill-running" />
        <text x={X(636)} y={Y(62)} textAnchor="middle" className="diagram-text strong tone-cyan">
          running
        </text>
      </g>

      <line x1={X(400)} y1={Y(80)} x2={X(700)} y2={Y(80)} className="diagram-hairline" />

      {/* branch chip (THI-126: shell panes get the chip too) */}
      <g data-part="branch">
        <rect x={X(418)} y={Y(92)} width="194" height="22" rx="11" className="chip-illu" />
        <text x={X(428)} y={Y(108)} className="diagram-text small">⎇ main</text>
      </g>

      <line x1={X(400)} y1={Y(128)} x2={X(700)} y2={Y(128)} className="diagram-hairline" />

      {/* preview — shell has more vertical room for the preview block */}
      <g data-part="preview">
        <g className="preview-illu">
          <rect x={X(418)} y={Y(140)} width="240" height="6" rx="2" />
          <rect x={X(418)} y={Y(154)} width="200" height="6" rx="2" />
          <rect x={X(418)} y={Y(168)} width="220" height="6" rx="2" />
          <rect x={X(418)} y={Y(182)} width="160" height="6" rx="2" />
          <rect x={X(418)} y={Y(196)} width="180" height="6" rx="2" />
          <rect x={X(418)} y={Y(210)} width="140" height="6" rx="2" />
          <rect x={X(418)} y={Y(224)} width="220" height="6" rx="2" />
          <rect x={X(418)} y={Y(238)} width="180" height="6" rx="2" />
        </g>
      </g>

      <line x1={X(400)} y1={Y(264)} x2={X(700)} y2={Y(264)} className="diagram-hairline" />

      {/* cpu/mem — warn-tier example values so the demoted "Also visible"
          line stays truthful about when the row actually shows. */}
      <g data-part="resources">
        <text x={X(418)} y={Y(286)} className="diagram-text small">
          <tspan className="strong tone-amber">72.4%</tspan>
          <tspan className="dim"> cpu  ·  </tspan>
          <tspan className="strong">1.2 GB</tspan>
          <tspan className="dim"> mem</tspan>
        </text>
      </g>

      <line x1={X(400)} y1={Y(302)} x2={X(700)} y2={Y(302)} className="diagram-hairline" />

      {/* footer actions */}
      <g data-part="actions">
        <g className="foot-btn">
          <rect x={X(418)} y={Y(314)} width="22" height="22" rx="6" />
          <rect x={X(446)} y={Y(314)} width="22" height="22" rx="6" />
          <rect x={X(474)} y={Y(314)} width="22" height="22" rx="6" />
          <rect x={X(502)} y={Y(314)} width="22" height="22" rx="6" className="foot-btn-danger" />
        </g>
      </g>

      {/* last activity */}
      <g data-part="age">
        <text x={X(672)} y={Y(330)} textAnchor="end" className="diagram-text small dim">
          2m
        </text>
      </g>
    </g>
  );
}

// Shell tile's part metadata. Smaller than Agent's set — no agent-block
// pieces (spinner / recap / pending), no context-accent strip.
export const SHELL_PARTS: ReadonlyArray<{ id: string; title: string; desc: string }> = [
  { id: "kind", title: "Kind glyph", desc: "Shell prompt — pane is a plain shell, not an agent." },
  { id: "name", title: "Window name + :index", desc: "Tmux window name; index is the tmux window number." },
  { id: "status", title: "Status pill", desc: "For shells: running (active process) · idle (at prompt)." },
  { id: "branch", title: "Branch chip", desc: "Current git branch when the cwd is inside a repo." },
  { id: "preview", title: "Terminal preview", desc: "Last captured stdout — hide via density = compact." },
  { id: "resources", title: "CPU / memory", desc: "Only shown when elevated — amber ≥ 60% / 1 GB · red ≥ 85% / 2 GB." },
  { id: "actions", title: "Footer actions", desc: "Focus · Rename · Send keys · Kill (⇧-click skips confirm)." },
  { id: "age", title: "Last activity", desc: "Seconds / minutes since the pane last produced output." },
];
