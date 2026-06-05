import { formatAgo } from "../lib/format";
import { useTick } from "../lib/useTick";

/**
 * A leaf component that renders `formatAgo(ts)` and re-renders itself once
 * per second so the displayed value stays live between `/api/state` polls
 * (THI-81). Kept as its own tiny component so the 1 Hz tick doesn't drag
 * the parent (e.g. WindowCard) through reconciliation every second — the
 * parent's memo stays effective for everything except this leaf.
 */
export function AgoSpan({ ts }: { ts: number }) {
  useTick(1000);
  return <>{formatAgo(ts)}</>;
}
