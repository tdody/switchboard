import type { Window } from "../types";
import { Icon } from "./Icon";

interface Props {
  windows: Window[];
  onOpen: (w: Window) => void;
  onDismiss: () => void;
  /** THI-66 broadcast button. Shown only when there are ≥2 pending panes
   *  AND the parent wired this callback. Clicking it hands the full pending
   *  list to the parent, which opens the command palette in broadcast mode. */
  onBroadcast?: (windows: Window[]) => void;
}

export function NeedsStrip({ windows, onOpen, onDismiss, onBroadcast }: Props) {
  const showBroadcast = !!onBroadcast && windows.length > 1;
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
      {showBroadcast && (
        <button
          className="needs-broadcast btn btn-ghost"
          onClick={() => onBroadcast!(windows)}
          title={`Broadcast to all ${windows.length} pending panes`}
        >
          <Icon name="send" size={12} />
          <span>Broadcast</span>
        </button>
      )}
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
