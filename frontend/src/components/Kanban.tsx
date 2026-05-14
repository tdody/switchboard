import type { Session, Window } from "../types";
import { sortPendingFirst } from "../lib/filter";
import { formatAgo } from "../lib/format";
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
                    key={w.id}
                    w={w}
                    isFocused={focusedId === w.id}
                    isHighlighted={highlightedId === w.id}
                    onOpen={onOpen}
                    onSendKeys={onSend}
                    onRename={onRename}
                    onFocus={onFocus}
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
