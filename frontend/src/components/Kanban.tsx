import { useRef, useState, type DragEvent } from "react";

import type { Session, Window } from "../types";
import { sortPendingFirst } from "../lib/filter";
import { AgoSpan } from "./AgoSpan";
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
  /** Per-kind quick action callback (THI-97). Optional — when omitted the
   *  card hides the quick-action buttons. */
  onQuickAction?: (
    w: Window,
    action: import("../lib/quickActions").QuickAction,
  ) => void;
  onNewWindow: (session: string) => void;
  onKillSession: (session: string, skipConfirm: boolean) => void;
  onRenameSession: (session: string) => void;
  /** Open the auto-rename modal for `session`. Optional — hidden when the
   *  backend reports no Anthropic key configured (THI-67). */
  onAutoRename?: (session: string) => void;
  /** Drag-to-reorder callback. `before=true` drops `src` to the left of `dst`,
   *  `false` to the right. Optional so the component still renders without the
   *  reorder feature wired up (and in tests). */
  onReorderSession?: (src: string, dst: string, before: boolean) => void;
  /** Drag-to-reorder tiles within a column (THI-141). Same-session enforced
   *  inside Kanban; this callback is only invoked when src and dst share a
   *  session. `before=true` drops `src` above `dst`; `false` below. */
  onReorderWindow?: (
    sessionId: string,
    src: string,
    dst: string,
    before: boolean,
  ) => void;
  /** Per-session pin lists for window order (THI-141). Pass `{}` when the
   *  feature is off; passing missing keys is fine — sortPendingFirst treats
   *  absent / empty arrays as the natural index order. */
  windowOrder?: Record<string, string[]>;
  /** Set of pane ids the user has pinned (THI-98). Pinned tiles sort to the
   *  top of their column (above any drag-order from THI-141) and render with
   *  an active Pin glyph. Pass an empty set to disable the styling. */
  pinnedPaneIds?: Set<string>;
  /** Toggle pin state for a window. When provided, each card renders a Pin
   *  button in its foot. */
  onTogglePin?: (w: Window) => void;
  /** One-click new-window. `mode` "claude" autotypes `claude\n` to boot
   *  Claude Code; "shell" leaves a bare prompt. (THI-115). */
  onQuickCreate?: (session: string, mode: "claude" | "shell") => void;
  /** Session ids currently mid-create; the +claude / +shell buttons are
   *  disabled for these to prevent double-spawn on a rapid double-click. */
  quickCreating?: Set<string>;
}

// Custom mime types for the two drag payloads — keep them distinct so a
// pane drag can't be mistaken for a column drag (or a text drag from
// outside the dashboard, which would otherwise satisfy `text/plain`).
const DRAG_TYPE = "application/x-sb-session";
const TILE_DRAG_TYPE = "application/x-sb-window";

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
  onQuickAction,
  onNewWindow,
  onKillSession,
  onRenameSession,
  onAutoRename,
  onReorderSession,
  onReorderWindow,
  windowOrder,
  pinnedPaneIds,
  onTogglePin,
  onQuickCreate,
  quickCreating,
}: Props) {
  // The first card across all visible sessions gets `data-tour="first-card"`
  // so the first-run tour (THI-96) can anchor its opening steps. Computing
  // this once per render keeps it O(N) and clearer than threading a mutable
  // flag through the nested .map() callbacks below.
  // THI-98 pinned ids outrank THI-141 drag-order: pre-pend the pinned
  // pane-id list to the per-session reorder list passed to sortPendingFirst.
  // The comparator's Map de-dupes, so a pane appearing in both arrays just
  // takes its pinned-section index (which is always lower).
  const sortOrderFor = (sessionId: string): string[] | undefined => {
    const drag = windowOrder?.[sessionId];
    if (!pinnedPaneIds || pinnedPaneIds.size === 0) return drag;
    return [...pinnedPaneIds, ...(drag ?? [])];
  };
  const firstPaneId = sessions
    .flatMap((s) =>
      sortPendingFirst(
        windows.filter((w) => w.session === s.id),
        sortOrderFor(s.id),
      ),
    )
    .at(0)?.paneId;

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

  // Tile-level drag state (THI-141) is independent of the column drag — they
  // use distinct mime types and can never resolve simultaneously, but
  // tracking them in separate state slots keeps the rendering predicates
  // clean.
  const [tileDragSrc, setTileDragSrc] = useState<{ paneId: string; session: string } | null>(
    null,
  );
  const [tileDragOverId, setTileDragOverId] = useState<string | null>(null);
  const [tileDragOverSide, setTileDragOverSide] = useState<"top" | "bottom">("top");

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

  // ── Tile-level drag (THI-141) ─────────────────────────────────────
  // Same-session enforcement happens at the over/drop layer: only `preventDefault`
  // when the source is from this tile's column, so cross-column drags fall through
  // to the column-level drop handler (which is a no-op for tiles) and the cursor
  // shows "not allowed".

  const handleTileDragStart =
    (w: Window) => (e: DragEvent<HTMLElement>) => {
      if (!onReorderWindow) return;
      e.stopPropagation(); // don't let this bubble into the column-header drag
      setTileDragSrc({ paneId: w.paneId, session: w.session });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(TILE_DRAG_TYPE, w.paneId);
    };

  const handleTileDragEnd = () => {
    setTileDragSrc(null);
    setTileDragOverId(null);
  };

  const handleTileDragOver =
    (w: Window) => (e: DragEvent<HTMLElement>) => {
      // Only accept the drop when source & target share a session AND the
      // current drag is a window drag (not a column drag).
      if (!onReorderWindow || !tileDragSrc) return;
      if (tileDragSrc.session !== w.session) return;
      if (tileDragSrc.paneId === w.paneId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const side: "top" | "bottom" =
        e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
      setTileDragOverId(w.paneId);
      setTileDragOverSide(side);
    };

  const handleTileDragLeave =
    (w: Window) => (e: DragEvent<HTMLElement>) => {
      // dragleave fires when the pointer crosses any descendant boundary —
      // only clear the indicator if the pointer actually left the wrapper.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const { clientX: x, clientY: y } = e;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
        if (tileDragOverId === w.paneId) setTileDragOverId(null);
      }
    };

  const handleTileDrop =
    (w: Window) => (e: DragEvent<HTMLElement>) => {
      if (!onReorderWindow || !tileDragSrc) return;
      if (tileDragSrc.session !== w.session) return;
      if (tileDragSrc.paneId === w.paneId) return;
      e.preventDefault();
      e.stopPropagation();
      const src = tileDragSrc.paneId;
      const before = tileDragOverSide === "top";
      setTileDragSrc(null);
      setTileDragOverId(null);
      onReorderWindow(w.session, src, w.paneId, before);
    };

  return (
    <div className="kanban">
      {sessions.map((s) => {
        const ws = sortPendingFirst(
          windows.filter((w) => w.session === s.id),
          sortOrderFor(s.id),
        );
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
                {onAutoRename && (
                  <button
                    className="btn-auto-rename"
                    onClick={() => onAutoRename(s.id)}
                    title={`Auto-rename windows in ${s.name}`}
                    aria-label={`Auto-rename windows in ${s.name}`}
                  >
                    <Icon name="sparkle" size={14} />
                  </button>
                )}
                {onQuickCreate && (
                  <>
                    <button
                      className="btn col-quick"
                      onClick={() => onQuickCreate(s.id, "claude")}
                      disabled={quickCreating?.has(s.id)}
                      title={`New Claude window in ${s.name}`}
                    >
                      +claude
                    </button>
                    <button
                      className="btn col-quick"
                      onClick={() => onQuickCreate(s.id, "shell")}
                      disabled={quickCreating?.has(s.id)}
                      title={`New shell window in ${s.name}`}
                    >
                      +shell
                    </button>
                  </>
                )}
                <DropdownMenu
                  label={`Actions for ${s.name}`}
                  items={[
                    {
                      label: "Named window…",
                      icon: "plus",
                      onClick: () => onNewWindow(s.id),
                    },
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
                      <span className="v">
                        <AgoSpan ts={client.since} /> ago
                      </span>
                    </div>
                  </>
                )}
                <div className="row">
                  <span className="k">created</span>
                  <span className="v">
                    <AgoSpan ts={s.created} /> ago
                  </span>
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
                ws.map((w) => {
                  const isTileDragSrc = tileDragSrc?.paneId === w.paneId;
                  const dropSide =
                    tileDragOverId === w.paneId ? tileDragOverSide : undefined;
                  const wrapClass =
                    "card-drag-wrap" +
                    (isTileDragSrc ? " card-dragging" : "");
                  return (
                    <div
                      key={w.paneId}
                      className={wrapClass}
                      data-drop-side={dropSide}
                      draggable={!!onReorderWindow}
                      onDragStart={handleTileDragStart(w)}
                      onDragEnd={handleTileDragEnd}
                      onDragOver={handleTileDragOver(w)}
                      onDragLeave={handleTileDragLeave(w)}
                      onDrop={handleTileDrop(w)}
                    >
                      <WindowCard
                        w={w}
                        isFocused={focusedId === w.paneId}
                        isHighlighted={highlightedId === w.paneId}
                        onOpen={onOpen}
                        onSendKeys={onSend}
                        onRename={onRename}
                        onFocus={onFocus}
                        onKill={onKill}
                        onQuickAction={onQuickAction}
                        isPinned={!!pinnedPaneIds?.has(w.paneId)}
                        onTogglePin={onTogglePin}
                        dataTour={w.paneId === firstPaneId ? "first-card" : undefined}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
