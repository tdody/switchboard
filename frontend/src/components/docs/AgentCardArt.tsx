/**
 * Pure agent-tile SVG illustration (THI-143).
 *
 * No callouts — the overlay component handles those. Each labelled
 * element is wrapped in a `<g data-part="…">` so future variants
 * (highlight, numbered legend, click-to-expand) can find anchors by id
 * without coupling to absolute coords.
 *
 * Geometry mirrors the prior `AgentDiagram.tsx` (which mirrored the
 * production WindowCard layout): card is 300×400 anchored at `(cx, cy)`.
 * Callers pass cx/cy to position the card inside the parent SVG.
 */

interface Props {
  cx: number;
  cy: number;
}

export function AgentCardArt({ cx, cy }: Props) {
  // Translate coordinates so the card top-left lands at (cx, cy). Internal
  // numbers track the source frame (card at 400..700 / 30..430) so the
  // numbers in callout configs match what the handoff doc spells out.
  const X = (x: number) => cx + (x - 400);
  const Y = (y: number) => cy + (y - 30);

  return (
    <g className="diagram-card">
      {/* card outline */}
      <rect x={X(400)} y={Y(30)} width="300" height="400" rx="10" />

      {/* left-edge context accent strip (THI-131) */}
      <g data-part="context">
        <rect
          x={X(400)}
          y={Y(30)}
          width="4"
          height="400"
          rx="2"
          className="ctx-strip ctx-strip-mid"
        />
      </g>

      {/* card-head — kind glyph + name/idx + status pill */}
      <g data-part="kind">
        <rect x={X(418)} y={Y(46)} width="22" height="22" rx="6" className="kind-box" />
        <text x={X(429)} y={Y(62)} textAnchor="middle" className="diagram-text small strong">C</text>
      </g>
      <g data-part="name">
        <text x={X(452)} y={Y(62)} className="diagram-text strong">claude</text>
        <text x={X(516)} y={Y(62)} className="diagram-text dim">:2</text>
      </g>
      <g data-part="status">
        <rect x={X(594)} y={Y(46)} width="84" height="22" rx="11" className="pill-running" />
        <text x={X(636)} y={Y(62)} textAnchor="middle" className="diagram-text strong tone-cyan">
          running
        </text>
      </g>

      <line x1={X(400)} y1={Y(80)} x2={X(700)} y2={Y(80)} className="diagram-hairline" />

      {/* branch + PR chip with CI dot */}
      <g data-part="branch">
        <rect x={X(418)} y={Y(92)} width="214" height="22" rx="11" className="chip-illu" />
        <circle cx={X(429)} cy={Y(103)} r="3" className="ci-dot ci-passing" />
        <text x={X(440)} y={Y(108)} className="diagram-text small">thibaultdody/thi-136</text>
        <text x={X(576)} y={Y(108)} className="diagram-text small dim">›</text>
        <text x={X(586)} y={Y(108)} className="diagram-text small tone-lilac">#48</text>
      </g>

      {/* spinner chip */}
      <g data-part="spinner">
        <rect
          x={X(418)}
          y={Y(124)}
          width="120"
          height="22"
          rx="11"
          className="chip-illu chip-spinner"
        />
        <circle cx={X(429)} cy={Y(135)} r="4" className="spin-illu" />
        <text x={X(440)} y={Y(140)} className="diagram-text small tone-cyan">Considering</text>
        <text x={X(508)} y={Y(140)} className="diagram-text small dim">4s</text>
      </g>

      {/* recap — two clamped lines */}
      <g data-part="recap">
        <text x={X(418)} y={Y(166)} className="diagram-text small dim">
          ● Done. Refactor complete.
        </text>
        <text x={X(418)} y={Y(180)} className="diagram-text small dim">Updated four tests.</text>
      </g>

      {/* pending block (amber) */}
      <g data-part="pending">
        <rect x={X(418)} y={Y(194)} width="264" height="22" rx="6" className="pending-illu" />
        <text x={X(428)} y={Y(209)} className="diagram-text small tone-amber">
          ›  Continue with these edits?
        </text>
      </g>

      <line x1={X(400)} y1={Y(226)} x2={X(700)} y2={Y(226)} className="diagram-hairline" />

      {/* terminal-preview placeholder */}
      <g data-part="preview">
        <g className="preview-illu">
          <rect x={X(418)} y={Y(238)} width="220" height="6" rx="2" />
          <rect x={X(418)} y={Y(252)} width="180" height="6" rx="2" />
          <rect x={X(418)} y={Y(266)} width="240" height="6" rx="2" />
          <rect x={X(418)} y={Y(280)} width="160" height="6" rx="2" />
          <rect x={X(418)} y={Y(294)} width="200" height="6" rx="2" />
          <rect x={X(418)} y={Y(308)} width="140" height="6" rx="2" />
        </g>
      </g>

      <line x1={X(400)} y1={Y(332)} x2={X(700)} y2={Y(332)} className="diagram-hairline" />

      {/* cpu/mem — only shown when elevated; the diagram pins it as a
          warn-tier example so the demoted "Also visible —" line stays
          truthful. */}
      <g data-part="resources">
        <text x={X(418)} y={Y(354)} className="diagram-text small">
          <tspan className="strong tone-amber">67.4%</tspan>
          <tspan className="dim"> cpu  ·  </tspan>
          <tspan className="strong">1.4 GB</tspan>
          <tspan className="dim"> mem</tspan>
        </text>
      </g>

      <line x1={X(400)} y1={Y(370)} x2={X(700)} y2={Y(370)} className="diagram-hairline" />

      {/* footer actions — focus / rename / send keys / kill */}
      <g data-part="actions">
        <g className="foot-btn">
          <rect x={X(418)} y={Y(382)} width="22" height="22" rx="6" />
          <rect x={X(446)} y={Y(382)} width="22" height="22" rx="6" />
          <rect x={X(474)} y={Y(382)} width="22" height="22" rx="6" />
          <rect x={X(502)} y={Y(382)} width="22" height="22" rx="6" className="foot-btn-danger" />
        </g>
      </g>

      {/* last activity (age) */}
      <g data-part="age">
        <text x={X(672)} y={Y(398)} textAnchor="end" className="diagram-text small dim">
          17s
        </text>
      </g>
    </g>
  );
}

// Full metadata table for every annotated part. V1 callouts use 8 of the
// 12 entries; demoted parts (spinner / recap / resources / age) populate
// the "Also visible —" strip. Future variants (numbered legend, stacked
// sections, click-to-expand) consume the same table.
export const AGENT_PARTS: ReadonlyArray<{ id: string; title: string; desc: string }> = [
  { id: "kind", title: "Kind glyph", desc: "Claude Code mark vs shell prompt — tells you what kind of pane this is." },
  { id: "name", title: "Window name + :index", desc: "Tmux window name; index is the tmux window number." },
  { id: "status", title: "Status pill", desc: "running · waiting · idle · done · error." },
  { id: "branch", title: "Branch + PR chip", desc: "Git branch › PR. The dot color shows the CI state." },
  { id: "spinner", title: "Spinner chip", desc: "Agent activity label and elapsed time while it works." },
  { id: "recap", title: "Recap line", desc: "Last assistant message — clamped to two lines." },
  { id: "pending", title: "Pending block", desc: "Amber card border + this row mean the agent is waiting on you." },
  { id: "preview", title: "Terminal preview", desc: "Last captured stdout — hide via density = compact." },
  { id: "resources", title: "CPU / memory", desc: "Only shown when elevated — amber ≥ 60% / 1 GB · red ≥ 85% / 2 GB." },
  { id: "actions", title: "Footer actions", desc: "Focus · Rename · Send keys · Kill (⇧-click skips confirm)." },
  { id: "age", title: "Last activity", desc: "Seconds / minutes since the pane last produced output." },
  { id: "context", title: "Context % accent", desc: "Left-edge strip — green < 50% · amber < 75% · orange < 90% · red." },
];
