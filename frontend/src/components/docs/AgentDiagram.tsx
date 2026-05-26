import { CalloutLine } from "./CalloutLine";

/**
 * Stylized agent-tile illustration with callouts (THI-136).
 *
 * Card sits in the middle of the viewBox. Callouts radiate to both side
 * gutters — left gutter for affordances anchored near the card's left
 * (kind glyph, name, branch / spinner chips, accent strip, cpu/mem),
 * right gutter for the right-anchored parts (status pill, recap,
 * pending box, preview, footer actions).
 *
 * The context-accent callout routes under the card because its anchor
 * sits on the very left edge — a straight line would cross the card.
 */
export function AgentDiagram() {
  return (
    <svg
      className="docs-diagram"
      viewBox="0 0 1100 520"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Agent tile diagram"
    >
      {/* ───── Stylized agent card (x=400..700, y=30..430) ───── */}
      <g className="diagram-card">
        {/* card outline */}
        <rect x="400" y="30" width="300" height="400" rx="10" />

        {/* left-edge context-accent strip (THI-131) */}
        <rect
          x="400"
          y="30"
          width="4"
          height="400"
          rx="2"
          className="ctx-strip ctx-strip-mid"
        />

        {/* ── card-head ── */}
        <rect x="418" y="46" width="22" height="22" rx="6" className="kind-box" />
        <text x="429" y="62" textAnchor="middle" className="diagram-text small strong">C</text>
        <text x="452" y="62" className="diagram-text strong">claude</text>
        <text x="516" y="62" className="diagram-text dim">:2</text>
        {/* status pill */}
        <rect x="594" y="46" width="84" height="22" rx="11" className="pill-running" />
        <text x="636" y="62" textAnchor="middle" className="diagram-text strong tone-cyan">running</text>

        <line x1="400" y1="80" x2="700" y2="80" className="diagram-hairline" />

        {/* ── card-agent block ── */}
        {/* branch + PR chip */}
        <rect x="418" y="92" width="214" height="22" rx="11" className="chip-illu" />
        <circle cx="429" cy="103" r="3" className="ci-dot ci-passing" />
        <text x="440" y="108" className="diagram-text small">thibaultdody/thi-136</text>
        <text x="576" y="108" className="diagram-text small dim">›</text>
        <text x="586" y="108" className="diagram-text small tone-lilac">#48</text>

        {/* spinner chip */}
        <rect x="418" y="124" width="120" height="22" rx="11" className="chip-illu chip-spinner" />
        <circle cx="429" cy="135" r="4" className="spin-illu" />
        <text x="440" y="140" className="diagram-text small tone-cyan">Considering</text>
        <text x="508" y="140" className="diagram-text small dim">4s</text>

        {/* recap (two lines, clamped) */}
        <text x="418" y="166" className="diagram-text small dim">● Done. Refactor complete.</text>
        <text x="418" y="180" className="diagram-text small dim">Updated four tests.</text>

        {/* pending block */}
        <rect x="418" y="194" width="264" height="22" rx="6" className="pending-illu" />
        <text x="428" y="209" className="diagram-text small tone-amber">›  Continue with these edits?</text>

        <line x1="400" y1="226" x2="700" y2="226" className="diagram-hairline" />

        {/* ── preview ── */}
        <g className="preview-illu">
          <rect x="418" y="238" width="220" height="6" rx="2" />
          <rect x="418" y="252" width="180" height="6" rx="2" />
          <rect x="418" y="266" width="240" height="6" rx="2" />
          <rect x="418" y="280" width="160" height="6" rx="2" />
          <rect x="418" y="294" width="200" height="6" rx="2" />
          <rect x="418" y="308" width="140" height="6" rx="2" />
        </g>

        <line x1="400" y1="332" x2="700" y2="332" className="diagram-hairline" />

        {/* ── card-meta (cpu/mem) — values shown at warn-tier so the row
             matches the conditional "showResources" path in WindowCard ── */}
        <text x="418" y="354" className="diagram-text small">
          <tspan className="strong tone-amber">67.4%</tspan>
          <tspan className="dim"> cpu  ·  </tspan>
          <tspan className="strong">1.4 GB</tspan>
          <tspan className="dim"> mem</tspan>
        </text>

        <line x1="400" y1="370" x2="700" y2="370" className="diagram-hairline" />

        {/* ── card-foot ── */}
        <g className="foot-btn">
          <rect x="418" y="382" width="22" height="22" rx="6" />
          <rect x="446" y="382" width="22" height="22" rx="6" />
          <rect x="474" y="382" width="22" height="22" rx="6" />
          <rect x="502" y="382" width="22" height="22" rx="6" className="foot-btn-danger" />
        </g>
        <text x="672" y="398" textAnchor="end" className="diagram-text small dim">17s</text>
      </g>

      {/* ────────── LEFT GUTTER CALLOUTS (label text-anchor=end @ x=380) ────────── */}
      {/* kind glyph */}
      <CalloutLine points={[[418, 57], [380, 60]]} />
      <text x="380" y="56" textAnchor="end" className="callout-label-strong">Kind glyph</text>
      <text x="380" y="72" textAnchor="end" className="callout-label">Claude Code mark / shell prompt</text>

      {/* window name + index */}
      <CalloutLine points={[[452, 62], [380, 110]]} />
      <text x="380" y="106" textAnchor="end" className="callout-label-strong">Window name + :index</text>
      <text x="380" y="122" textAnchor="end" className="callout-label">Tmux window name; index = tmux window number</text>

      {/* branch + PR chip */}
      <CalloutLine points={[[418, 103], [380, 160]]} />
      <text x="380" y="156" textAnchor="end" className="callout-label-strong">Branch + PR chip</text>
      <text x="380" y="172" textAnchor="end" className="callout-label">Git branch › PR; ● dot color = CI state</text>

      {/* spinner chip */}
      <CalloutLine points={[[418, 135], [380, 210]]} />
      <text x="380" y="206" textAnchor="end" className="callout-label-strong">Spinner chip</text>
      <text x="380" y="222" textAnchor="end" className="callout-label">Agent activity label + elapsed time</text>

      {/* cpu / memory — only visible when cpu ≥ 60% or mem ≥ 1 GB */}
      <CalloutLine points={[[418, 354], [380, 354]]} />
      <text x="380" y="350" textAnchor="end" className="callout-label-strong">CPU / memory</text>
      <text x="380" y="366" textAnchor="end" className="callout-label">Only shown when elevated — amber ≥ 60% / 1 GB · red ≥ 85% / 2 GB</text>

      {/* context % accent — anchor on the LEFT edge, route under the card */}
      <CalloutLine points={[[402, 430], [402, 470], [380, 470]]} />
      <text x="380" y="466" textAnchor="end" className="callout-label-strong">Context % accent</text>
      <text x="380" y="482" textAnchor="end" className="callout-label">Left-edge strip: green &lt; 50% · amber &lt; 75% · orange &lt; 90% · red</text>

      {/* ────────── RIGHT GUTTER CALLOUTS (label @ x=720) ────────── */}
      {/* status pill */}
      <CalloutLine points={[[678, 57], [720, 60]]} />
      <text x="720" y="56" className="callout-label-strong">Status pill</text>
      <text x="720" y="72" className="callout-label">running · waiting · idle · done · error</text>

      {/* recap */}
      <CalloutLine points={[[632, 173], [720, 130]]} />
      <text x="720" y="126" className="callout-label-strong">Recap line</text>
      <text x="720" y="142" className="callout-label">Last assistant message — clamped to two lines</text>

      {/* pending block */}
      <CalloutLine points={[[682, 205], [720, 190]]} />
      <text x="720" y="186" className="callout-label-strong">Pending block</text>
      <text x="720" y="202" className="callout-label">Amber card border + this row: agent is waiting on you</text>

      {/* preview */}
      <CalloutLine points={[[658, 273], [720, 260]]} />
      <text x="720" y="256" className="callout-label-strong">Terminal preview</text>
      <text x="720" y="272" className="callout-label">Last captured stdout — hide via density = compact</text>

      {/* footer actions (anchor on first foot button) */}
      <CalloutLine points={[[502, 405], [720, 360]]} />
      <text x="720" y="356" className="callout-label-strong">Footer actions</text>
      <text x="720" y="372" className="callout-label">Focus in tmux · Rename · Send keys · Kill (⇧-click skips confirm)</text>

      {/* last activity */}
      <CalloutLine points={[[670, 395], [720, 420]]} />
      <text x="720" y="416" className="callout-label-strong">Last activity</text>
      <text x="720" y="432" className="callout-label">Seconds / minutes since the pane last produced output</text>
    </svg>
  );
}
