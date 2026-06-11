import { useState } from "react";

import {
  COLUMN_SIZE_ORDER,
  TERM_FONT_DEFAULT,
  TERM_FONT_MAX,
  TERM_FONT_MIN,
  updateSettings,
  useSetting,
} from "../lib/settings";
import type { Window } from "../types";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { PaneTerminal, ZOOM_STEP, clampFont, type Connection } from "./PaneTerminal";
import { StatusPill } from "./StatusPill";
import { useScrimClose } from "../lib/useScrimClose";

interface Props {
  window: Window;
  onClose: () => void;
  onToast: (message: string) => void;
  /** Optional — when present, renders a Kill button in the foot that delegates
   *  to the parent's handler (same shift-skip-confirm contract as WindowCard). */
  onKill?: (w: Window, skipConfirm: boolean) => void;
}

const CONN_LABEL: Record<Connection, string> = {
  connecting: "connecting",
  live: "WS · live",
  reconnecting: "reconnecting",
  disconnected: "disconnected",
  gone: "pane gone",
  snapshot: "snapshot",
};

export function TerminalModal({ window: win, onClose, onToast, onKill }: Props) {
  const scrimProps = useScrimClose(onClose);

  // PaneTerminal owns the xterm + WS lifecycle. We just render the modal
  // chrome around it and reflect the connection state in the footer.
  const [conn, setConn] = useState<Connection>("connecting");
  const [manualReconnect, setManualReconnect] = useState<() => void>(() => () => {});

  const terminalFontSize = useSetting("terminalFontSize");
  const columnSize = useSetting("columnSize");

  const zoomBy = (delta: number) =>
    updateSettings({ terminalFontSize: clampFont(terminalFontSize + delta) });
  const zoomReset = () => updateSettings({ terminalFontSize: TERM_FONT_DEFAULT });
  const zoomPct = Math.round((terminalFontSize / TERM_FONT_DEFAULT) * 100);

  // Modal pane size — shares the `columnSize` setting with the kanban subhead
  // ColumnSizeControl. The CSS width change is picked up by PaneTerminal's
  // ResizeObserver, which refits xterm and forwards the new cols/rows to tmux.
  const sizeIdx = COLUMN_SIZE_ORDER.indexOf(columnSize);
  const atNarrow = sizeIdx <= 0;
  const atWide = sizeIdx >= COLUMN_SIZE_ORDER.length - 1;
  const sizeStep = (delta: -1 | 1) => {
    const next = COLUMN_SIZE_ORDER[sizeIdx + delta];
    if (next) updateSettings({ columnSize: next });
  };
  const sizeReset = () => updateSettings({ columnSize: "normal" });

  return (
    <div className="scrim" {...scrimProps}>
      <div className="term-modal" onClick={(e) => e.stopPropagation()}>
        <div className="term-hd">
          <span className="traffic">
            <button className="t-red" onClick={onClose} title="Close" />
            <span className="t-yellow" />
            <span className="t-green" />
          </span>
          <div className="term-title">
            <span className="sess">
              {win.session} › :{win.index}
            </span>
            <b>{win.name}</b>
            {/* Branch / PR / CI / spinner chips mirror the WindowCard layout
                so the modal header carries the same at-a-glance signal as the
                kanban card. Data flows through `win.branch` (top-level field
                so shell panes get the chip too, per THI-126) and `win.agent`
                on every `/api/state` poll (100ms while modal-open per
                THI-105 — see MODAL_OPEN_POLL_MS in App.tsx), so React
                re-renders the chips live without any extra poller. */}
            {(win.branch || win.pr) && (
              <Chip
                className={`branch-pr ${win.ci ? `ci-${win.ci}` : ""}`}
                title={win.branch || `PR #${win.pr}`}
              >
                {win.ci && (
                  <span className={`ci-dot ci-${win.ci}`} aria-hidden="true" />
                )}
                {win.branch && <Icon name="git-branch" size={10} />}
                {win.branch && <span>{win.branch}</span>}
                {win.branch && win.pr && <span className="pr-sep">›</span>}
                {win.pr && win.prUrl ? (
                  <a
                    className="pr-num pr-link"
                    href={win.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open PR #${win.pr} on GitHub`}
                  >
                    #{win.pr}
                  </a>
                ) : (
                  win.pr && <span className="pr-num">#{win.pr}</span>
                )}
              </Chip>
            )}
            {win.agent?.spinner && (
              <Chip className="spinner" title="agent activity">
                <span className="spin" />
                <span>{win.agent.spinner}</span>
                {win.agent.duration && <span className="dur">{win.agent.duration}</span>}
              </Chip>
            )}
            <StatusPill status={win.status} />
            {/* When the pane is waiting on the user, surface the prompt
                question as an ellipsized hint after the StatusPill so a
                glance at the modal header tells you what to answer without
                scrolling the terminal. */}
            {win.pendingInput && win.agent?.action && (
              <span className="term-action" title={win.agent.action}>
                {win.agent.action}
              </span>
            )}
          </div>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            title={conn === "live" ? "Close (Esc Esc)" : "Close (Esc)"}
          >
            <Icon name="x" />
          </button>
        </div>
        <PaneTerminal
          window={win}
          onEscape={onClose}
          onToast={onToast}
          onConnectionChange={(state, reconnect) => {
            setConn(state);
            // Wrap in a setter functional update so React doesn't call the
            // reconnect callback (functions-as-state quirk).
            setManualReconnect(() => reconnect);
          }}
        />
        <div className="term-foot">
          <span className={`connect-pill ${conn}`}>
            <span className="dot" /> {CONN_LABEL[conn]}
          </span>
          {conn === "disconnected" && (
            <button
              className="btn btn-ghost btn-reconnect"
              onClick={() => manualReconnect()}
              title="Open a fresh WebSocket"
            >
              Reconnect
            </button>
          )}
          <span className="term-cwd">{win.cwd || "—"}</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          {onKill && (
            <button
              className="btn btn-danger"
              onClick={(e) => onKill(win, e.shiftKey)}
              title="Kill this window (shift-click to skip confirm)"
            >
              <Icon name="trash" size={12} />
              <span>Kill window</span>
            </button>
          )}
          <span className="term-zoom" aria-label="Font zoom">
            <span className="term-cluster-label">Zoom</span>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={terminalFontSize <= TERM_FONT_MIN}
              title="Zoom out (⌘-)"
            >
              <Icon name="minus" size={12} />
            </button>
            <button
              className="zoom-level"
              onClick={zoomReset}
              title="Reset zoom (⌘0)"
            >
              {zoomPct}%
            </button>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={terminalFontSize >= TERM_FONT_MAX}
              title="Zoom in (⌘=)"
            >
              <Icon name="plus" size={12} />
            </button>
          </span>
          <span className="term-zoom" aria-label="Pane size">
            <span className="term-cluster-label">Size</span>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => sizeStep(-1)}
              disabled={atNarrow}
              title={`Narrower pane (current: ${columnSize})`}
              aria-label="Narrower pane"
            >
              <Icon name="minus" size={12} />
            </button>
            <button
              className="zoom-level"
              onClick={sizeReset}
              title="Reset to normal"
            >
              {columnSize}
            </button>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => sizeStep(1)}
              disabled={atWide}
              title={`Wider pane (current: ${columnSize})`}
              aria-label="Wider pane"
            >
              <Icon name="plus" size={12} />
            </button>
          </span>
          <span className="hint">
            {conn === "live" ? "Esc to pane · Esc Esc to close" : "Esc to close"}
          </span>
        </div>
      </div>
    </div>
  );
}
