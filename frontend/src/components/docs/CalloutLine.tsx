/**
 * Thin dashed line + anchor dot for diagram callouts (THI-136).
 *
 * Used by HeaderDiagram / AgentDiagram / ShellDiagram to point from a part
 * of the stylized card to a label drawn elsewhere in the same SVG. Accepts
 * a `points` polyline so a callout can bend around the card (e.g. the
 * left-edge context-accent strip routes under the card to reach the
 * right-side label gutter).
 */

interface Props {
  /** Polyline points. First point is the anchor (gets the dot); last is
   *  where the label sits. Most callouts pass two points (straight line);
   *  pass 3+ for L- or U-shaped bends around the card. */
  points: ReadonlyArray<readonly [number, number]>;
}

export function CalloutLine({ points }: Props) {
  if (points.length < 2) return null;
  const d = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(" ");
  const [ax, ay] = points[0];
  return (
    <g className="callout">
      <path d={d} className="callout-line" fill="none" />
      <circle cx={ax} cy={ay} r={2.5} className="callout-dot" />
    </g>
  );
}
