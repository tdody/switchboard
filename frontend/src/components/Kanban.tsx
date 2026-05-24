import type { Session, Window } from "../types";
import { sortPendingFirst } from "../lib/filter";
import { formatAgo } from "../lib/format";
import { DropdownMenu } from "./DropdownMenu";
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
  /** One-click new-window. `mode` "claude" autotypes `claude\n` to boot
   *  Claude Code; "shell" leaves a bare prompt. (THI-115). */
  onQuickCreate?: (session: string, mode: "claude" | "shell") => void;
  /** Session ids currently mid-create; the +claude / +shell buttons are
   *  disabled for these to prevent double-spawn on a rapid double-click. */
  quickCreating?: Set<string>;
}

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
  onQuickCreate,
  quickCreating,
}: Props) {
  return (
    <div className="kanban">
      {sessions.map((s) => {
        const ws = sortPendingFirst(windows.filter((w) => w.session === s.id));
        const pending = ws.filter((w) => w.pendingInput).length;
        const client = (s.clients || [])[0];
        return (
          <section className="col" key={s.id}>
            <header className="col-hd">
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
