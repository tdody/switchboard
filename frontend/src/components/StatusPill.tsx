import type { Status } from "../types";
import { STATUS_META } from "../lib/status";

export function StatusPill({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  return (
    <span className={`card-status ${status} tone-${meta.tone}`}>
      <span className="glyph" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
