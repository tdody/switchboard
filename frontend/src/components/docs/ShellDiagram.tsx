import { CalloutLine } from "./CalloutLine";

/**
 * Stylized shell-tile illustration with callouts (THI-136).
 *
 * Same center-card / side-gutters layout as AgentDiagram, but the card
 * is shorter (no agent block, no context accent) so the diagram fits a
 * shorter viewBox. Callouts split between left (kind glyph, name+idx,
 * cpu/mem) and right (status pill, branch chip, preview, footer).
 */
export function ShellDiagram() {
  return (
    <svg
      className="docs-diagram"
      viewBox="0 0 1100 460"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Shell tile diagram"
    >
      {/* ───── Stylized shell card (x=400..700, y=70..400) ───── */}
      <g className="diagram-card">
        <rect x="400" y="70" width="300" height="330" rx="10" />

        {/* ── card-head ── */}
        <rect x="418" y="86" width="22" height="22" rx="6" className="kind-box kind-box-shell" />
        <text x="429" y="102" textAnchor="middle" className="diagram-text small strong">&gt;_</text>
        <text x="452" y="102" className="diagram-text strong">dev-server</text>
        <text x="540" y="102" className="diagram-text dim">:3</text>
        {/* status pill */}
        <rect x="594" y="86" width="84" height="22" rx="11" className="pill-running" />
        <text x="636" y="102" textAnchor="middle" className="diagram-text strong tone-cyan">running</text>

        <line x1="400" y1="120" x2="700" y2="120" className="diagram-hairline" />

        {/* branch chip */}
        <rect x="418" y="132" width="194" height="22" rx="11" className="chip-illu" />
        <text x="428" y="148" className="diagram-text small">⎇ main</text>

        <line x1="400" y1="168" x2="700" y2="168" className="diagram-hairline" />

        {/* preview */}
        <g className="preview-illu">
          <rect x="418" y="180" width="240" height="6" rx="2" />
          <rect x="418" y="194" width="200" height="6" rx="2" />
          <rect x="418" y="208" width="220" height="6" rx="2" />
          <rect x="418" y="222" width="160" height="6" rx="2" />
          <rect x="418" y="236" width="180" height="6" rx="2" />
          <rect x="418" y="250" width="140" height="6" rx="2" />
          <rect x="418" y="264" width="220" height="6" rx="2" />
          <rect x="418" y="278" width="180" height="6" rx="2" />
        </g>

        <line x1="400" y1="304" x2="700" y2="304" className="diagram-hairline" />

        {/* cpu/mem — warn-tier values so the conditional row actually
             appears in the real card (cpu ≥ 60% or mem ≥ 1 GB) */}
        <text x="418" y="326" className="diagram-text small">
          <tspan className="strong tone-amber">72.4%</tspan>
          <tspan className="dim"> cpu  ·  </tspan>
          <tspan className="strong">1.2 GB</tspan>
          <tspan className="dim"> mem</tspan>
        </text>

        <line x1="400" y1="342" x2="700" y2="342" className="diagram-hairline" />

        {/* card-foot */}
        <g className="foot-btn">
          <rect x="418" y="354" width="22" height="22" rx="6" />
          <rect x="446" y="354" width="22" height="22" rx="6" />
          <rect x="474" y="354" width="22" height="22" rx="6" />
          <rect x="502" y="354" width="22" height="22" rx="6" className="foot-btn-danger" />
        </g>
        <text x="672" y="370" textAnchor="end" className="diagram-text small dim">2m</text>
      </g>

      {/* ────────── LEFT GUTTER (text-anchor=end @ x=380) ────────── */}
      <CalloutLine points={[[418, 97], [380, 96]]} />
      <text x="380" y="92" textAnchor="end" className="callout-label-strong">Kind glyph</text>
      <text x="380" y="108" textAnchor="end" className="callout-label">Shell prompt — pane is a plain shell</text>

      <CalloutLine points={[[452, 102], [380, 160]]} />
      <text x="380" y="156" textAnchor="end" className="callout-label-strong">Window name + :index</text>
      <text x="380" y="172" textAnchor="end" className="callout-label">Tmux window name; index = tmux window number</text>

      <CalloutLine points={[[418, 322], [380, 322]]} />
      <text x="380" y="318" textAnchor="end" className="callout-label-strong">CPU / memory</text>
      <text x="380" y="334" textAnchor="end" className="callout-label">Only shown when elevated — amber ≥ 60% / 1 GB · red ≥ 85% / 2 GB</text>

      {/* ────────── RIGHT GUTTER (@ x=720) ────────── */}
      <CalloutLine points={[[678, 97], [720, 100]]} />
      <text x="720" y="96" className="callout-label-strong">Status pill</text>
      <text x="720" y="112" className="callout-label">For shells: running (process) · idle (at prompt)</text>

      <CalloutLine points={[[612, 143], [720, 180]]} />
      <text x="720" y="176" className="callout-label-strong">Branch chip</text>
      <text x="720" y="192" className="callout-label">Current git branch when cwd is inside a repo</text>

      <CalloutLine points={[[658, 230], [720, 260]]} />
      <text x="720" y="256" className="callout-label-strong">Terminal preview</text>
      <text x="720" y="272" className="callout-label">Last captured stdout — hide via density = compact</text>

      <CalloutLine points={[[502, 376], [720, 350]]} />
      <text x="720" y="346" className="callout-label-strong">Footer actions</text>
      <text x="720" y="362" className="callout-label">Focus · Rename · Send keys · Kill (⇧-click skips confirm)</text>
    </svg>
  );
}
