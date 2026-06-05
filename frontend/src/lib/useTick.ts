import { useEffect, useState } from "react";

/**
 * Re-render the calling component every `intervalMs` (THI-81). Returns an
 * opaque counter; consumers usually ignore the value and just rely on the
 * re-render to recompute time-dependent text like `formatAgo(ts)`.
 *
 * Keep the consumer LEAF-shaped (e.g. a tiny <AgoSpan>) so the 1 Hz tick
 * doesn't drag the whole card's JSX tree through reconciliation every second.
 */
export function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}
