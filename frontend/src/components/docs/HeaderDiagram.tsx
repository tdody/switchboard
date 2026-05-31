import { CalloutLine } from "./CalloutLine";

/**
 * Stylized session/column-header illustration with callouts (THI-136).
 *
 * Header bar centered horizontally. Callouts use L-shaped (orthogonal)
 * routing — drop vertically from the anchor, then horizontal to the
 * label gutter — so neighboring lines never cross. Each anchor sits on
 * the LEFT or RIGHT edge of its control (not its center) so the dot
 * doesn't sit on top of the control's text.
 */
export function HeaderDiagram() {
  return (
    <svg
      className="docs-diagram"
      viewBox="0 0 1100 420"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Session header diagram"
    >
      {/* ── Header bar (centered, x=400..700) ── */}
      <g className="diagram-card">
        <rect x="400" y="190" width="300" height="44" rx="10" />

        {/* attached dot */}
        <circle cx="420" cy="212" r="5" className="dot-attached" />
        {/* session name */}
        <text x="434" y="217" className="diagram-text">main</text>
        {/* drag grip */}
        <g className="grip">
          <circle cx="488" cy="204" r="1.4" />
          <circle cx="488" cy="212" r="1.4" />
          <circle cx="488" cy="220" r="1.4" />
          <circle cx="496" cy="204" r="1.4" />
          <circle cx="496" cy="212" r="1.4" />
          <circle cx="496" cy="220" r="1.4" />
        </g>
        {/* count badge */}
        <rect x="510" y="198" width="28" height="28" rx="6" className="badge" />
        <text x="524" y="217" textAnchor="middle" className="diagram-text strong">4</text>
        {/* +claude */}
        <rect x="546" y="198" width="58" height="28" rx="6" className="btn-quick" />
        <text x="575" y="217" textAnchor="middle" className="diagram-text small">+claude</text>
        {/* +shell */}
        <rect x="610" y="198" width="50" height="28" rx="6" className="btn-quick" />
        <text x="635" y="217" textAnchor="middle" className="diagram-text small">+shell</text>
        {/* ⋮ kebab */}
        <text x="682" y="220" textAnchor="middle" className="diagram-text strong">⋮</text>
      </g>

      {/* ───── LEFT GUTTER — anchors at LEFT edge of each control ─────
         Each callout uses a 3-point L-shape (anchor → vertical →
         horizontal to label). Splits cleanly into one above-bar label
         (Attached dot) and three below-bar labels (Session, Drag,
         Count) so no two lines can share a quadrant. Below-bar anchors
         increase monotonically with label y (leftmost anchor → topmost
         below-bar label), which is the only ordering that keeps the
         L-shapes from crossing each other. */}

      {/* Attached dot — above the bar, anchor on the dot's left edge */}
      <CalloutLine points={[[415, 212], [415, 100], [388, 100]]} />
      <text x="380" y="96" textAnchor="end" className="callout-label-strong">Attached dot</text>
      <text x="380" y="112" textAnchor="end" className="callout-label">Green while a tmux client is attached</text>

      {/* Session name — below the bar, anchor at first character of "main" */}
      <CalloutLine points={[[434, 212], [434, 268], [388, 268]]} />
      <text x="380" y="264" textAnchor="end" className="callout-label-strong">Session name</text>
      <text x="380" y="280" textAnchor="end" className="callout-label">Click to rename</text>

      {/* Drag the bar — below the bar, anchor at leftmost grip dot */}
      <CalloutLine points={[[486, 212], [486, 328], [388, 328]]} />
      <text x="380" y="324" textAnchor="end" className="callout-label-strong">Drag the bar</text>
      <text x="380" y="340" textAnchor="end" className="callout-label">Reorder sessions left-to-right</text>

      {/* Window count — below the bar, anchor at the badge's left edge */}
      <CalloutLine points={[[510, 212], [510, 388], [388, 388]]} />
      <text x="380" y="384" textAnchor="end" className="callout-label-strong">Window count</text>
      <text x="380" y="400" textAnchor="end" className="callout-label">Glows when any pane is waiting on input</text>

      {/* ───── RIGHT GUTTER — anchors at RIGHT edge of each control ───── */}

      {/* +claude — anchor at the button's right edge */}
      <CalloutLine points={[[604, 212], [604, 100], [712, 100]]} />
      <text x="720" y="96" className="callout-label-strong">+claude</text>
      <text x="720" y="112" className="callout-label">Quick-create a new Claude agent window</text>

      {/* +shell — anchor at the button's right edge */}
      <CalloutLine points={[[660, 212], [660, 168], [712, 168]]} />
      <text x="720" y="164" className="callout-label-strong">+shell</text>
      <text x="720" y="180" className="callout-label">Quick-create a new shell window</text>

      {/* ⋮ actions menu — anchor at the kebab glyph's right edge */}
      <CalloutLine points={[[688, 212], [688, 268], [712, 268]]} />
      <text x="720" y="264" className="callout-label-strong">⋮  Actions menu</text>
      <text x="720" y="280" className="callout-label">Named window · rename session · kill session</text>
    </svg>
  );
}
