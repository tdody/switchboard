import type { Session, Window } from "../types";
import { sortPendingFirst } from "../lib/filter";
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
  onQuickAction?: (
    w: Window,
    action: import("../lib/quickActions").QuickAction,
  ) => void;
  onNewWindow: (session: string) => void;
  onKillSession: (session: string, skipConfirm: boolean) => void;
  onRenameSession: (session: string) => void;
  onAutoRename?: (session: string) => void;
  onQuickCreate?: (session: string, mode: "claude" | "shell") => void;
  quickCreating?: Set<string>;
  /** Pinned pane ids (THI-98) — pinned cards sort to the top of each
   *  session's grid and render with the active pin badge. */
  pinnedPaneIds?: Set<string>;
  onTogglePin?: (w: Window) => void;
}

/**
 * THI-59: grouped-by-session grid layout. Each session becomes a stacked
 * row with a full-width header and a responsive grid of cards beneath it
 * (`grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))`).
 *
 * Differs from <Kanban /> in two ways:
 *   1. Sessions stack vertically rather than scrolling horizontally.
 *   2. Each session's cards flow into a responsive grid instead of a
 *      vertical column — better for wide screens with many small panes.
 *
 * Drag-to-reorder (THI-141) and the +claude/+shell quick-create buttons
 * are intentionally omitted — they're tightly coupled to the Kanban column
 * affordance set and aren't a natural fit for a flow grid. Users who want
 * those switch back to Kanban via the layout switcher.
 */
export function GridView({
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
  pinnedPaneIds,
  onTogglePin,
}: Props) {
  // Re-use Kanban's sort: pending always first, then pinned (THI-98), then
  // natural tmux index. Pass the pinned set as the ordered list so the
  // existing comparator handles the "pinned to top" rule.
  const sortOrderFor = (sessionId: string): string[] | undefined => {
    if (!pinnedPaneIds || pinnedPaneIds.size === 0) return undefined;
    void sessionId;
    return [...pinnedPaneIds];
  };

  return (
    <div className="grid-view">
      {sessions.map((s) => {
        const ws = sortPendingFirst(
          windows.filter((w) => w.session === s.id),
          sortOrderFor(s.id),
        );
        const pending = ws.filter((w) => w.pendingInput).length;
        return (
          <section className="gv-section" key={s.id}>
            <header className="gv-head">
              <span className="gv-name">
                <span className={`col-name-dot ${s.attached ? "attached" : ""}`} />
                <span>{s.name}</span>
              </span>
              <span
                className={`gv-count ${pending > 0 ? "has-pending" : ""}`}
                title={pending > 0 ? `${pending} waiting on input` : `${ws.length} windows`}
              >
                {ws.length}
              </span>
              <span className="gv-spacer" />
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
            </header>
            {ws.length === 0 ? (
              <div className="gv-empty">no matching windows</div>
            ) : (
              <div className="gv-grid">
                {ws.map((w) => (
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
                    onQuickAction={onQuickAction}
                    isPinned={!!pinnedPaneIds?.has(w.paneId)}
                    onTogglePin={onTogglePin}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
