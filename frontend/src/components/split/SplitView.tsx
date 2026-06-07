import { useMemo } from "react";

import { sortPendingFirst } from "../../lib/filter";
import { updateSettings, useSetting } from "../../lib/settings";
import type { Session, Window } from "../../types";
import { Icon } from "../Icon";
import { StatusPill } from "../StatusPill";

interface Props {
  windows: Window[];
  sessions: Session[];
  /** Forwarded so the "Open in tmux" header button still focuses the
   *  selected pane in the user's real terminal (THI-88). */
  onFocus: (w: Window) => void;
}

/** THI-246 PR 1 — Split view foundation.
 *
 *  Two-pane workspace: a rail on the left listing every visible window in a
 *  flat tree, a detail pane on the right that shows the selected pane's
 *  metadata. The inline xterm + rail features (Repo→Worktree→Pane tree,
 *  collapse, divider resize, drag-reorder) ship in follow-up PRs.
 *
 *  Selection persists in `settings.selectedPaneId` so a reload or a layout
 *  swap restores the last viewed pane. Rail width persists in
 *  `settings.splitRailWidth` (used in PR 2 once the divider lands).
 */
export function SplitView({ windows, sessions, onFocus }: Props) {
  const selectedPaneId = useSetting("selectedPaneId");
  const railWidth = useSetting("splitRailWidth");

  // Sort each session bucket like Kanban does so the rail order matches what
  // the user sees elsewhere. PR 2 will swap in the Repo→Worktree→Pane tree
  // derived from THI-243's discovery feed.
  const rows = useMemo<Array<{ session: Session; windows: Window[] }>>(() => {
    const bySession = new Map<string, Window[]>();
    for (const w of windows) {
      const bucket = bySession.get(w.session);
      if (bucket) bucket.push(w);
      else bySession.set(w.session, [w]);
    }
    return sessions
      .map((s) => ({ session: s, windows: sortPendingFirst(bySession.get(s.id) ?? []) }))
      .filter((row) => row.windows.length > 0);
  }, [sessions, windows]);

  const selected = selectedPaneId
    ? windows.find((w) => w.paneId === selectedPaneId) ?? null
    : null;

  return (
    <div
      className="sb-split"
      style={{ gridTemplateColumns: `${railWidth}px 7px 1fr` }}
    >
      <aside className="sb-rail" role="navigation" aria-label="Panes">
        <header className="sb-rail-hd">
          <span className="ttl">Projects</span>
          <span className="grow" />
        </header>
        <div className="sb-rail-body">
          {rows.length === 0 ? (
            <div className="sb-rail-empty">No matching windows.</div>
          ) : (
            rows.map(({ session, windows: ws }) => (
              <SessionGroup
                key={session.id}
                session={session}
                windows={ws}
                selectedPaneId={selectedPaneId}
              />
            ))
          )}
        </div>
      </aside>
      {/* Divider placeholder — drag-to-resize lands in PR 2. The 7px gutter
       *  preserves the grid-template-columns shape so PR 2 just wires up the
       *  pointer handlers without re-laying out the surface. */}
      <div className="sb-divider" aria-hidden="true" />
      <section className="sb-detail" role="main" aria-label="Detail pane">
        {selected ? (
          <DetailPlaceholder window={selected} onFocus={onFocus} />
        ) : (
          <div className="sb-detail-empty">
            <p>Select a pane from the rail to see its live terminal.</p>
            <p className="sb-detail-empty-sub">
              Inline xterm lands in a follow-up PR.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

interface SessionGroupProps {
  session: Session;
  windows: Window[];
  selectedPaneId: string;
}

function SessionGroup({ session, windows, selectedPaneId }: SessionGroupProps) {
  return (
    <div className="sb-group">
      <div className="sb-row sb-row-head" aria-label={`Session ${session.name}`}>
        <span className="ic">
          <Icon name="kanban" size={11} />
        </span>
        <span className="lbl">{session.name}</span>
      </div>
      {windows.map((w) => (
        <PaneRow key={w.paneId} w={w} selected={w.paneId === selectedPaneId} />
      ))}
    </div>
  );
}

function PaneRow({ w, selected }: { w: Window; selected: boolean }) {
  return (
    <button
      type="button"
      className={`sb-row pane${selected ? " sel" : ""}`}
      onClick={() => updateSettings({ selectedPaneId: w.paneId })}
      aria-pressed={selected}
      data-pane-id={w.paneId}
    >
      <span className={`ic ${w.kind === "agent" ? "agent" : ""}`}>
        <Icon name={w.kind === "agent" ? "agent" : "shell"} size={12} />
      </span>
      <span className="lbl">{w.name}</span>
      {w.pendingInput && <span className="count">!</span>}
    </button>
  );
}

function DetailPlaceholder({
  window: w,
  onFocus,
}: {
  window: Window;
  onFocus: (w: Window) => void;
}) {
  return (
    <>
      <header className="sb-pane-hd">
        <span className="pid">
          <span className="ic">
            <Icon name={w.kind === "agent" ? "agent" : "shell"} size={13} />
          </span>
          {w.name}
        </span>
        <span className="meta">
          {w.session}:{w.index}
        </span>
        {w.branch && <span className="meta">{w.branch}</span>}
        <span className="grow" />
        <StatusPill status={w.status} />
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => onFocus(w)}
          title="Focus this window in tmux"
          aria-label="Focus in tmux"
        >
          <Icon name="focus" />
        </button>
      </header>
      <div className="sb-detail-stub">
        <p>Inline terminal coming in a follow-up PR.</p>
        <p className="sb-detail-stub-sub">
          For now, use the Focus-in-tmux button above or switch to
          Kanban/List/Grid to open the existing terminal modal.
        </p>
      </div>
    </>
  );
}
