import type { Window } from "../types";
import { Icon } from "./Icon";

interface Props {
  windows: Window[];
  onOpen: (w: Window) => void;
  onDismiss: () => void;
}

export function NeedsStrip({ windows, onOpen, onDismiss }: Props) {
  return (
    <div className="needs-strip">
      <span className="label">
        <span className="pulse" aria-hidden="true" />
        <span>Needs you</span>
        <span style={{ color: "var(--text-dim)", marginLeft: 4 }}>({windows.length})</span>
      </span>
      <div className="needs-strip-row">
        {windows.map((w) => (
          <button
            key={w.paneId}
            className="needs-pill"
            onClick={() => onOpen(w)}
            title={w.agent?.action || w.name}
          >
            <span className="sess">{w.session}/</span>
            <span style={{ color: "var(--text)" }}>{w.name}</span>
            <span className="arrow">›</span>
            <span className="action">{w.agent?.action || "waiting on input"}</span>
          </button>
        ))}
      </div>
      <button
        className="dismiss btn-ghost btn btn-icon"
        onClick={onDismiss}
        title="Dismiss strip"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
