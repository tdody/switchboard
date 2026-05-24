import { useRef, useState, type DragEvent } from "react";

import type { Session, Window } from "../types";
import { sortPendingFirst } from "../lib/filter";
import { formatAgo } from "../lib/format";
import { DropdownMenu } from "./DropdownMenu";
import { Icon } from "./Icon";
import { WindowCard } from "./WindowCard";

interface Props {
  sessions: Session[];
  windows: Window[];
  focusedId: string | null;
  highlightedId: string | null;
  onOpen: (w: Window) => void;
  onSend: (w: Window) => void;
  onRename: (w: Window) => void;
  onFocus: (w: Window) => void;
  onKill: (w: Window, skipConfirm: boolean) => void;
  onNewWindow: (session: string) => void;
  onKillSession: (session: string, skipConfirm: boolean) => void;
  onRenameSession: (session: string) => void;
  /** Drag-to-reorder callback. `before=true` drops `src` to the left of `dst`,
   *  `false` to the right. Optional so the component still renders without the
   *  reorder feature wired up (and in tests). */
  onReorderSession?: (src: string, dst: string, before: boolean) => void;
}

// Custom mime type for the drag payload — keeps us from picking up text drags
// from outside the dashboard, which would otherwise satisfy `text/plain`.
const DRAG_TYPE = "application/x-sb-session";

export function Kanban({
  sessions,
  windows,
  focusedId,
  highlightedId,
  onOpen,
  onSend,
  onRename,
  onFocus,
  onKill,
  onNewWindow,
  onKillSession,
  onRenameSession,
  onReorderSession,
}: Props) {
  // Local drag-state — kept here (not in App.tsx) because nothing outside
  // Kanban cares about the in-flight hover side or the source id; the parent
  // only learns about the drop via `onReorderSession`.
  const [dragSrcId, setDragSrcId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverSide, setDragOverSide] = useState<"left" | "right">("left");
  // Track the column the drag is currently hovering so onDragLeave can be
  // distinguished from "left this column entirely" (which fires when the
  // pointer crosses any descendant boundary too — relatedTarget is unreliable
  // across browsers, so we compare boundingRects instead).
  const dragOverRef = useRef<string | null>(null);

  const handleDragStart = (s: Session) => (e: DragEvent<HTMLElement>) => {
    if (!onReorderSession) return;
    setDragSrcId(s.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DRAG_TYPE, s.id);
  };

  const handleDragEnd = () => {
    setDragSrcId(null);
    setDragOverId(null);
    dragOverRef.current = null;
  };

  const handleDragOver = (s: Session) => (e: DragEvent<HTMLElement>) => {
    if (!onReorderSession || !dragSrcId || dragSrcId === s.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side: "left" | "right" =
      e.clientX < rect.left + rect.width / 2 ? "left" : "right";
    setDragOverId(s.id);
    setDragOverSide(side);
    dragOverRef.current = s.id;
  };

  const handleDragLeave = (s: Session) => (e: DragEvent<HTMLElement>) => {
    // dragleave fires when the pointer crosses any child boundary too — only
    // clear the indicator if the pointer actually left the section's rect.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { clientX: x, clientY: y } = e;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      if (dragOverRef.current === s.id) {
        setDragOverId(null);
        dragOverRef.current = null;
      }
    }
  };

  const handleDrop = (s: Session) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const src = e.dataTransfer.getData(DRAG_TYPE) || dragSrcId;
    setDragSrcId(null);
    setDragOverId(null);
    dragOverRef.current = null;
    if (!src || src === s.id || !onReorderSession) return;
    onReorderSession(src, s.id, dragOverSide === "left");
  };

  return (
    <div className="kanban">
      {sessions.map((s) => {
        const ws = sortPendingFirst(windows.filter((w) => w.session === s.id));
        const pending = ws.filter((w) => w.pendingInput).length;
        const client = (s.clients || [])[0];
        const isDragSrc = dragSrcId === s.id;
        const isDragOver = dragOverId === s.id;
        const sectionClass =
          `col${isDragSrc ? " col-dragging" : ""}` +
          (isDragOver ? ` col-drop-${dragOverSide}` : "");
        return (
          <section
            className={sectionClass}
            key={s.id}
            onDragOver={handleDragOver(s)}
            onDragLeave={handleDragLeave(s)}
            onDrop={handleDrop(s)}
          >
            <header
              className="col-hd"
              draggable={!!onReorderSession}
              onDragStart={handleDragStart(s)}
              onDragEnd={handleDragEnd}
            >
              <span className="col-name" tabIndex={0}>
                <span className={`col-name-dot ${s.attached ? "attached" : ""}`} />
                <span>{s.name}</span>
              </span>
              <span className="col-meta">
                <span
                  className={`col-count ${pending > 0 ? "has-pending" : ""}`}
                  title={pending > 0 ? `${pending} waiting on input` : `${ws.length} windows`}
                >
                  {ws.length}
                </span>
              </span>
              <div className="col-actions">
                <button
                  className="btn btn-icon"
                  onClick={() => onNewWindow(s.id)}
                  title={`New window in ${s.name}`}
                >
                  <Icon name="plus" size={14} />
                </button>
                <DropdownMenu
                  label={`Actions for ${s.name}`}
                  items={[
                    {
                      label: "Rename session",
                      icon: "rename",
                      onClick: () => onRenameSession(s.id),
                    },
                    {
                      label: "Kill session",
                      icon: "trash",
                      danger: true,
                      onClick: (e) => onKillSession(s.id, e.shiftKey),
                    },
                  ]}
                />
              </div>

              <div className="col-hover">
                <div className="row">
                  <span className="k">session</span>
                  <span className="v">{s.name}</span>
                </div>
                <div className="row">
                  <span className="k">windows</span>
                  <span className="v">{ws.length}</span>
                </div>
                <div className="row">
                  <span className="k">attached</span>
                  <span
                    className="v"
                    style={{ color: s.attached ? "var(--accent)" : "var(--text-dim)" }}
                  >
                    {s.attached ? "yes" : "detached"}
                  </span>
                </div>
                {client && (
                  <>
                    <div className="row">
                      <span className="k">client</span>
                      <span className="v">{client.term}</span>
                    </div>
                    <div className="row">
                      <span className="k">tty</span>
                      <span className="v">{client.tty}</span>
                    </div>
                    <div className="row">
                      <span className="k">since</span>
                      <span className="v">{formatAgo(client.since)} ago</span>
                    </div>
                  </>
                )}
                <div className="row">
                  <span className="k">created</span>
                  <span className="v">{formatAgo(s.created)} ago</span>
                </div>
              </div>
            </header>
            <div className="col-body">
              {ws.length === 0 ? (
                <div
                  style={{
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    padding: "20px 6px",
                    textAlign: "center",
                  }}
                >
                  no matching windows
                </div>
              ) : (
                ws.map((w) => (
                  <WindowCard
                    key={w.paneId}
                    w={w}
                    isFocused={focusedId === w.paneId}
                    isHighlighted={highlightedId === w.paneId}
                    onOpen={onOpen}
                    onSendKeys={onSend}
                    onRename={onRename}
                    onFocus={onFocus}
                    onKill={onKill}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
