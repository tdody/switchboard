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
      viewBox="0 0 1160 420"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Session header diagram"
    >
      {/* THI-158: ✨ auto-rename button uses the same amber→accent gradient
          as the real Kanban button (`.btn-auto-rename` in styles.css). Stops
          read from the live `--tone-amber` / `--accent` CSS vars so the
          swatch tracks the active theme automatically — light mode darkens
          the L of both, contrast/phosphor get their own theme-appropriate
          values. NOTE: `stop-color` as a presentation attribute doesn't
          accept `oklch(…)` reliably across renderers (falls back to black);
          setting it through the CSS property via `style` does, AND it lets
          us thread CSS vars in. There's only one HeaderDiagram in the tree
          at a time, so the gradient id is safe to hardcode. */}
      <defs>
        <linearGradient id="rn-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--tone-amber)" }} />
          <stop offset="100%" style={{ stopColor: "var(--accent)" }} />
        </linearGradient>
      </defs>

      {/* ── Header bar (centered, x=400..732 — widened from 300→332 to fit
           the ✨ button alongside +claude / +shell / ⋮) ── */}
      <g className="diagram-card">
        <rect x="400" y="190" width="332" height="44" rx="10" />

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
        {/* ✨ auto-rename (THI-67 / THI-158) — gradient-filled square button
             with the sparkle glyph; sits between count badge and +claude
             quick-create, matching the real Kanban header order. Fill and
             stroke go through `style` so they outrank the
             `.diagram-card rect { fill: var(--bg-elev) }` rule in
             docs.css — presentation attributes (`fill=`) lose to class
             selectors by CSS specificity, and a class override would just
             trade one source of confusion for another. */}
        <rect
          x="544"
          y="201"
          width="22"
          height="22"
          rx="6"
          style={{ fill: "url(#rn-grad)", stroke: "none" }}
        />
        <g
          transform="translate(548, 205)"
          stroke="var(--bg)"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M7 2v3M7 11v3M2 7h3M10 7h3M3.5 3.5l2 2M9 9l1.5 1.5M10.5 3.5l-2 2M5 9l-2 2" />
        </g>
        {/* +claude — shifted right by 30 to make room for ✨ */}
        <rect x="576" y="198" width="58" height="28" rx="6" className="btn-quick" />
        <text x="605" y="217" textAnchor="middle" className="diagram-text small">+claude</text>
        {/* +shell — shifted right by 30 */}
        <rect x="640" y="198" width="50" height="28" rx="6" className="btn-quick" />
        <text x="665" y="217" textAnchor="middle" className="diagram-text small">+shell</text>
        {/* ⋮ kebab — shifted right by 30 */}
        <text x="712" y="220" textAnchor="middle" className="diagram-text strong">⋮</text>
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

      {/* ───── RIGHT GUTTER — anchors at RIGHT edge of each control.
         Label gutter sits at x=742 (was 712 — pushed out 30px to clear the
         widened bar, in lockstep with the +30 shift applied to every
         right-side control inside the bar). */}

      {/* ✨ auto-rename (THI-158) — anchor at right edge of the ✨ rect,
           fanned to the top so the right-side reading order is
           ✨ → +claude → +shell → ⋮. */}
      <CalloutLine points={[[566, 212], [566, 40], [742, 40]]} />
      <text x="750" y="36" className="callout-label-strong">✨ Auto-rename</text>
      <text x="750" y="52" className="callout-label">Suggests names for every window via an LLM call</text>

      {/* +claude — anchor at the button's right edge (shifted +30) */}
      <CalloutLine points={[[634, 212], [634, 100], [742, 100]]} />
      <text x="750" y="96" className="callout-label-strong">+claude</text>
      <text x="750" y="112" className="callout-label">Quick-create a new Claude agent window</text>

      {/* +shell — anchor at the button's right edge (shifted +30) */}
      <CalloutLine points={[[690, 212], [690, 168], [742, 168]]} />
      <text x="750" y="164" className="callout-label-strong">+shell</text>
      <text x="750" y="180" className="callout-label">Quick-create a new shell window</text>

      {/* ⋮ actions menu — anchor at the kebab glyph's right edge (shifted +30) */}
      <CalloutLine points={[[718, 212], [718, 268], [742, 268]]} />
      <text x="750" y="264" className="callout-label-strong">⋮  Actions menu</text>
      <text x="750" y="280" className="callout-label">Named window · rename session · kill session</text>
    </svg>
  );
}
