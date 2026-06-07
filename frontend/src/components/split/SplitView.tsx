import { useMemo } from "react";

import { sortPendingFirst } from "../../lib/filter";
import {
  OTHER_REPO_KEY,
  type RepoGroup,
  groupByRepo,
} from "../../lib/groupByRepo";
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

/** THI-246 PR 2 — Split view rail features (in progress).
 *
 *  Two-pane workspace: a rail on the left listing every visible window in a
 *  two-level tree, a detail pane on the right that shows the selected pane's
 *  metadata.
 *
 *  Tree shape follows the global `groupingMode` setting (THI-243):
 *  - **sessions**: Session → Window (each tmux session is a group).
 *  - **repos**: Repo → Window (each window's git toplevel is its bucket;
 *    sessions span groups when they span repos, per the per-window rule
 *    landed on THI-243). Window rows show a small `session:` chip so the
 *    user can still see which tmux session a pane belongs to without the
 *    extra hierarchy level.
 *
 *  Selection persists in `settings.selectedPaneId` so a reload or a layout
 *  swap restores the last viewed pane. Rail width persists in
 *  `settings.splitRailWidth` (used by the divider in PR 2).
 */
export function SplitView({ windows, sessions, onFocus }: Props) {
  const groupingMode = useSetting("groupingMode");
  const selectedPaneId = useSetting("selectedPaneId");
  const railWidth = useSetting("splitRailWidth");

  // Sessions-mode rows: keep each session bucket in tmux index order with
  // pending panes floated to the top, matching Kanban's per-column rule.
  const sessionRows = useMemo<Array<{ session: Session; windows: Window[] }>>(() => {
    if (groupingMode !== "sessions") return [];
    const bySession = new Map<string, Window[]>();
    for (const w of windows) {
      const bucket = bySession.get(w.session);
      if (bucket) bucket.push(w);
      else bySession.set(w.session, [w]);
    }
    return sessions
      .map((s) => ({ session: s, windows: sortPendingFirst(bySession.get(s.id) ?? []) }))
      .filter((row) => row.windows.length > 0);
  }, [groupingMode, sessions, windows]);

  // Repos-mode groups: sort once globally (pending-first), then bucket by
  // repo. Each bucket preserves the sort order.
  const repoGroups = useMemo<RepoGroup[]>(() => {
    if (groupingMode !== "repos") return [];
    return groupByRepo(sortPendingFirst(windows));
  }, [groupingMode, windows]);

  const selected = selectedPaneId
    ? windows.find((w) => w.paneId === selectedPaneId) ?? null
    : null;

  const isEmpty =
    groupingMode === "repos" ? repoGroups.length === 0 : sessionRows.length === 0;

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
          {isEmpty ? (
            <div className="sb-rail-empty">No matching windows.</div>
          ) : groupingMode === "repos" ? (
            repoGroups.map((g) => (
              <RepoGroupView
                key={g.key}
                group={g}
                selectedPaneId={selectedPaneId}
              />
            ))
          ) : (
            sessionRows.map(({ session, windows: ws }) => (
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

interface RepoGroupViewProps {
  group: RepoGroup;
  selectedPaneId: string;
}

function RepoGroupView({ group, selectedPaneId }: RepoGroupViewProps) {
  const isOther = group.key === OTHER_REPO_KEY;
  return (
    <div className="sb-group">
      <div
        className="sb-row sb-row-head"
        title={isOther ? "Windows whose cwd isn't a git repo" : group.key}
        aria-label={`Repo ${group.label}`}
      >
        <span className="ic">
          <Icon name="git-branch" size={11} />
        </span>
        <span className="lbl">{group.label}</span>
        <span className="count">{group.windows.length}</span>
      </div>
      {group.windows.map((w) => (
        <PaneRow
          key={w.paneId}
          w={w}
          selected={w.paneId === selectedPaneId}
          showSessionChip
        />
      ))}
    </div>
  );
}

function PaneRow({
  w,
  selected,
  showSessionChip = false,
}: {
  w: Window;
  selected: boolean;
  showSessionChip?: boolean;
}) {
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
      {showSessionChip && (
        <span className="sb-row-session" title={`tmux session: ${w.session}`}>
          {w.session}
        </span>
      )}
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
