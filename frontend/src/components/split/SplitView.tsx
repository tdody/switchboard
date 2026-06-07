import { useMemo, useRef, useState } from "react";

import { sortPendingFirst } from "../../lib/filter";
import {
  OTHER_REPO_KEY,
  type RepoGroup,
  groupByRepo,
} from "../../lib/groupByRepo";
import { updateSettings, useSetting } from "../../lib/settings";
import { STATUS_META } from "../../lib/status";
import type { Session, Window } from "../../types";
import { Icon } from "../Icon";
import { StatusPill } from "../StatusPill";

/** Rail width bounds — clamps the divider drag and any settings hydration. */
export const SPLIT_RAIL_MIN = 200;
export const SPLIT_RAIL_MAX = 460;
/** Width of the collapsed dot-strip rail, in pixels. */
export const SPLIT_RAIL_COLLAPSED = 44;
/** Keyboard nudges for the separator: arrows step by 10px, Shift+arrows
 *  by 50px so power-users can resize quickly without a mouse. */
const KEYBOARD_STEP = 10;
const KEYBOARD_STEP_LARGE = 50;

function clampRail(w: number): number {
  if (w < SPLIT_RAIL_MIN) return SPLIT_RAIL_MIN;
  if (w > SPLIT_RAIL_MAX) return SPLIT_RAIL_MAX;
  return w;
}

interface Props {
  windows: Window[];
  sessions: Session[];
  /** Forwarded so the "Open in tmux" header button still focuses the
   *  selected pane in the user's real terminal (THI-88). */
  onFocus: (w: Window) => void;
  /** Optional: open the "new window" overlay targeting `session`. Wired by
   *  App.tsx → setNewWindowSession. When omitted (legacy callers, tests),
   *  the "+ New tab" rows are hidden. */
  onNewWindow?: (session: Session) => void;
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
export function SplitView({ windows, sessions, onFocus, onNewWindow }: Props) {
  const groupingMode = useSetting("groupingMode");
  const selectedPaneId = useSetting("selectedPaneId");
  const persistedRailWidth = useSetting("splitRailWidth");
  const collapsed = useSetting("splitRailCollapsed");

  // Divider drag — `dragWidth` overrides the persisted width during a drag so
  // the column reflows in real time without thrashing the settings store on
  // every pointer move. Final width persists once on pointer-up.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStart = useRef<{ x: number; w: number } | null>(null);
  const expandedWidth = clampRail(dragWidth ?? persistedRailWidth);
  const effectiveWidth = collapsed ? SPLIT_RAIL_COLLAPSED : expandedWidth;

  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return; // no drag while collapsed — toggle to expand first
    if (e.button !== 0) return; // primary button only
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, w: expandedWidth };
    setDragWidth(expandedWidth);
  };
  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setDragWidth(clampRail(dragStart.current.w + (e.clientX - dragStart.current.x)));
  };
  const onDividerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const final = clampRail(dragStart.current.w + (e.clientX - dragStart.current.x));
    dragStart.current = null;
    setDragWidth(null);
    if (final !== persistedRailWidth) updateSettings({ splitRailWidth: final });
  };
  const onDividerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (collapsed) return;
    // ARIA separator pattern: arrow keys nudge; Shift increases the step.
    let delta = 0;
    if (e.key === "ArrowLeft") delta = e.shiftKey ? -KEYBOARD_STEP_LARGE : -KEYBOARD_STEP;
    else if (e.key === "ArrowRight") delta = e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
    else if (e.key === "Home") {
      e.preventDefault();
      if (persistedRailWidth !== SPLIT_RAIL_MIN)
        updateSettings({ splitRailWidth: SPLIT_RAIL_MIN });
      return;
    } else if (e.key === "End") {
      e.preventDefault();
      if (persistedRailWidth !== SPLIT_RAIL_MAX)
        updateSettings({ splitRailWidth: SPLIT_RAIL_MAX });
      return;
    } else return;
    e.preventDefault();
    const next = clampRail(persistedRailWidth + delta);
    if (next !== persistedRailWidth) updateSettings({ splitRailWidth: next });
  };

  // Flat ordered window list for the collapsed dot-strip — same source the
  // expanded tree uses, just stripped of group headers so the order matches
  // what the user saw before collapsing.
  const flatWindows = useMemo<Window[]>(() => {
    if (!collapsed) return [];
    if (groupingMode === "repos") {
      return groupByRepo(sortPendingFirst(windows)).flatMap((g) => g.windows);
    }
    const bySession = new Map<string, Window[]>();
    for (const w of windows) {
      const bucket = bySession.get(w.session);
      if (bucket) bucket.push(w);
      else bySession.set(w.session, [w]);
    }
    return sessions.flatMap((s) => sortPendingFirst(bySession.get(s.id) ?? []));
  }, [collapsed, groupingMode, windows, sessions]);

  const onToggleCollapsed = () => {
    updateSettings({ splitRailCollapsed: !collapsed });
  };
  const onDotSelect = (w: Window) => {
    updateSettings({ splitRailCollapsed: false, selectedPaneId: w.paneId });
  };

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
      style={{ gridTemplateColumns: `${effectiveWidth}px 7px 1fr` }}
    >
      <aside
        className={`sb-rail${collapsed ? " is-collapsed" : ""}`}
        role="navigation"
        aria-label="Panes"
      >
        <header className="sb-rail-hd">
          {!collapsed && <span className="ttl">Projects</span>}
          <span className="grow" />
          <button
            type="button"
            className="sb-rail-collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand rail" : "Collapse rail"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand rail" : "Collapse rail"}
          >
            <Icon name={collapsed ? "plus" : "minus"} size={11} />
          </button>
        </header>
        <div className="sb-rail-body">
          {collapsed ? (
            flatWindows.length === 0 ? (
              <div className="sb-rail-empty" aria-hidden="true" />
            ) : (
              flatWindows.map((w) => (
                <DotRow
                  key={w.paneId}
                  w={w}
                  selected={w.paneId === selectedPaneId}
                  onSelect={onDotSelect}
                />
              ))
            )
          ) : isEmpty ? (
            <div className="sb-rail-empty">No matching windows.</div>
          ) : groupingMode === "repos" ? (
            repoGroups.map((g) => (
              <RepoGroupView
                key={g.key}
                group={g}
                selectedPaneId={selectedPaneId}
                onNewWindow={onNewWindow ? (s) => onNewWindow(s) : undefined}
                sessionsById={sessions}
              />
            ))
          ) : (
            sessionRows.map(({ session, windows: ws }) => (
              <SessionGroup
                key={session.id}
                session={session}
                windows={ws}
                selectedPaneId={selectedPaneId}
                onNewWindow={onNewWindow ? () => onNewWindow(session) : undefined}
              />
            ))
          )}
        </div>
      </aside>
      <div
        className={`sb-divider${dragWidth !== null ? " is-dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize rail"
        aria-valuenow={expandedWidth}
        aria-valuemin={SPLIT_RAIL_MIN}
        aria-valuemax={SPLIT_RAIL_MAX}
        tabIndex={0}
        onPointerDown={onDividerPointerDown}
        onPointerMove={onDividerPointerMove}
        onPointerUp={onDividerPointerUp}
        onKeyDown={onDividerKeyDown}
      />
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
  /** When provided, render a "+ New tab" affordance below the group's panes
   *  that opens the new-window flow targeting this session. */
  onNewWindow?: () => void;
}

function SessionGroup({
  session,
  windows,
  selectedPaneId,
  onNewWindow,
}: SessionGroupProps) {
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
      {onNewWindow && <NewTabRow onClick={onNewWindow} />}
    </div>
  );
}

interface RepoGroupViewProps {
  group: RepoGroup;
  selectedPaneId: string;
  /** Bound version of the App-level new-window handler — receives the
   *  session that owns the new tab. */
  onNewWindow?: (session: Session) => void;
  /** Available sessions, so the repo group can resolve a session for its
   *  "+ New tab" row (uses the first window's session as the target since
   *  the repo group itself isn't tied to one). */
  sessionsById: Session[];
}

function RepoGroupView({
  group,
  selectedPaneId,
  onNewWindow,
  sessionsById,
}: RepoGroupViewProps) {
  const isOther = group.key === OTHER_REPO_KEY;
  // The "+ New tab" in repos mode lands in the session of the first window
  // in this bucket. THI-244-style cwd-aware spawning (so the new tab opens
  // in the repo's path) is wired up at the NewWindowOverlay layer — out of
  // scope for the rail itself.
  const firstSessionId = group.windows[0]?.session;
  const targetSession =
    firstSessionId !== undefined
      ? sessionsById.find((s) => s.id === firstSessionId)
      : undefined;
  const handleNewWindow =
    onNewWindow && targetSession ? () => onNewWindow(targetSession) : undefined;
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
      {!isOther && handleNewWindow && <NewTabRow onClick={handleNewWindow} />}
    </div>
  );
}

/** Trailing row inside a group that opens the new-window flow. Visually
 *  matches a pane row but uses the `plus` icon and reads as an action rather
 *  than a destination. */
function NewTabRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="sb-row pane sb-newtab"
      onClick={onClick}
      aria-label="New tab"
    >
      <span className="ic">
        <Icon name="plus" size={12} />
      </span>
      <span className="lbl">New tab</span>
    </button>
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

/** Single row in the collapsed dot-strip — just a status-toned dot. Clicking
 *  expands the rail and selects the pane. */
function DotRow({
  w,
  selected,
  onSelect,
}: {
  w: Window;
  selected: boolean;
  onSelect: (w: Window) => void;
}) {
  const tone = STATUS_META[w.status]?.tone ?? "gray";
  return (
    <button
      type="button"
      className={`sb-dot tone-${tone}${selected ? " sel" : ""}`}
      onClick={() => onSelect(w)}
      aria-label={`${w.session}:${w.name} (${STATUS_META[w.status]?.label ?? w.status})`}
      title={`${w.session}:${w.name}`}
      data-pane-id={w.paneId}
    />
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
