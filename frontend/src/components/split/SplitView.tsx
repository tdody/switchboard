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
import { Chip } from "../Chip";
import { Icon } from "../Icon";
import { PaneTerminal, type Connection } from "../PaneTerminal";
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

/** Stable-sort `items` by their position in `order`. Items not mentioned in
 *  `order` keep their input order and are appended after the ordered ones —
 *  matches the periscope "prefs are hints, never membership" semantics. */
function applyOrder<T>(items: T[], order: string[], keyOf: (item: T) => string): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((k, i) => [k, i] as const));
  return [...items].sort((a, b) => {
    const ai = rank.get(keyOf(a));
    const bi = rank.get(keyOf(b));
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}

/** Reorder `arr` by moving `dragId` to before/after `targetId`. No-op when
 *  the drag would land in its current slot. */
function reorderArray(
  arr: readonly string[],
  dragId: string,
  targetId: string,
  position: "before" | "after",
): string[] {
  if (dragId === targetId) return [...arr];
  const fromIdx = arr.indexOf(dragId);
  if (fromIdx === -1) return [...arr];
  const without = [...arr.slice(0, fromIdx), ...arr.slice(fromIdx + 1)];
  const targetIdx = without.indexOf(targetId);
  if (targetIdx === -1) return [...arr];
  const insertAt = position === "before" ? targetIdx : targetIdx + 1;
  return [...without.slice(0, insertAt), dragId, ...without.slice(insertAt)];
}

type DropPos = "before" | "after";
interface GroupDragProps {
  draggable: true;
  /** Visual: the dragged group fades while in flight. */
  isDragging: boolean;
  /** Drop indicator position relative to this group, if any. */
  dropIndicator: DropPos | null;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnter: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

interface Props {
  windows: Window[];
  sessions: Session[];
  /** Forwarded so the "Open in tmux" header button still focuses the
   *  selected pane in the user's real terminal (THI-88). */
  onFocus: (w: Window) => void;
  /** Optional: open the "new window" overlay targeting the given session ID.
   *  Wired by App.tsx → setNewWindowSession. When omitted (legacy callers,
   *  tests), the "+ New tab" rows are hidden. */
  onNewWindow?: (sessionId: string) => void;
  /** Optional: surface PaneTerminal events (copy notifications, IDE failures,
   *  image-paste errors) to the App-level toaster. When omitted, the
   *  in-detail xterm renders without toast feedback. Tests pass undefined. */
  onToast?: (msg: string) => void;
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
export function SplitView({
  windows,
  sessions,
  onFocus,
  onNewWindow,
  onToast,
}: Props) {
  const groupingMode = useSetting("groupingMode");
  const selectedPaneId = useSetting("selectedPaneId");
  const persistedRailWidth = useSetting("splitRailWidth");
  const collapsed = useSetting("splitRailCollapsed");
  const sessionOrderPref = useSetting("splitRailSessionOrder");
  const repoOrderPref = useSetting("splitRailRepoOrder");

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
    // preventDefault() stops text selection during the drag, but it ALSO
    // suppresses the default focus-on-click — so the keyboard nudges
    // (arrow / Shift+arrow / Home / End) wouldn't fire after a click.
    // Restore focus explicitly.
    e.preventDefault();
    e.currentTarget.focus();
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
  // Group order honors the persisted drag-reorder preference; sessions not
  // mentioned in the pref keep their live order and append after.
  const sessionRows = useMemo<Array<{ session: Session; windows: Window[] }>>(() => {
    if (groupingMode !== "sessions") return [];
    const bySession = new Map<string, Window[]>();
    for (const w of windows) {
      const bucket = bySession.get(w.session);
      if (bucket) bucket.push(w);
      else bySession.set(w.session, [w]);
    }
    const rows = sessions
      .map((s) => ({ session: s, windows: sortPendingFirst(bySession.get(s.id) ?? []) }))
      .filter((row) => row.windows.length > 0);
    return applyOrder(rows, sessionOrderPref, (r) => r.session.id);
  }, [groupingMode, sessions, windows, sessionOrderPref]);

  // Repos-mode groups: sort once globally (pending-first), then bucket by
  // repo. Each bucket preserves the sort order. "Other" is pulled out before
  // reorder and re-appended last so it never participates in user reorder.
  const repoGroups = useMemo<RepoGroup[]>(() => {
    if (groupingMode !== "repos") return [];
    const raw = groupByRepo(sortPendingFirst(windows));
    const realGroups = raw.filter((g) => g.key !== OTHER_REPO_KEY);
    const otherGroup = raw.find((g) => g.key === OTHER_REPO_KEY);
    const ordered = applyOrder(realGroups, repoOrderPref, (g) => g.key);
    return otherGroup ? [...ordered, otherGroup] : ordered;
  }, [groupingMode, windows, repoOrderPref]);

  const selected = selectedPaneId
    ? windows.find((w) => w.paneId === selectedPaneId) ?? null
    : null;

  const isEmpty =
    groupingMode === "repos" ? repoGroups.length === 0 : sessionRows.length === 0;

  // Drag-to-reorder state. Two pieces:
  //   - `dragGroupId`: which group's head row is being dragged (null when idle).
  //   - `dragOver`: which group we're hovering over and on which half.
  // Identity travels on the React state instead of dataTransfer so we never
  // depend on a DOM sibling walk to find the drag source.
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; pos: DropPos } | null>(null);
  const clearDrag = () => {
    setDragGroupId(null);
    setDragOver(null);
  };
  const reorderableIds: string[] =
    groupingMode === "sessions"
      ? sessionRows.map((r) => r.session.id)
      : repoGroups.filter((g) => g.key !== OTHER_REPO_KEY).map((g) => g.key);
  const handleGroupDrop = (targetId: string) => {
    if (!dragGroupId || dragGroupId === targetId || !dragOver) {
      clearDrag();
      return;
    }
    const next = reorderArray(reorderableIds, dragGroupId, targetId, dragOver.pos);
    if (groupingMode === "sessions") {
      updateSettings({ splitRailSessionOrder: next });
    } else {
      updateSettings({ splitRailRepoOrder: next });
    }
    clearDrag();
  };
  /** Drag wiring for one group's head row. Returns the props the group
   *  component spreads onto its `.sb-row-head` element. */
  const dragProps = (groupId: string, reorderable: boolean): GroupDragProps | null => {
    if (!reorderable || collapsed) return null;
    return {
      draggable: true,
      isDragging: dragGroupId === groupId,
      dropIndicator: dragOver?.id === groupId ? dragOver.pos : null,
      onDragStart: (e) => {
        // dataTransfer payload is unused (identity lives in React state) but
        // setting it keeps Firefox from rejecting the drag.
        e.dataTransfer.setData("text/plain", groupId);
        e.dataTransfer.effectAllowed = "move";
        setDragGroupId(groupId);
      },
      onDragEnter: (e) => {
        e.preventDefault();
      },
      onDragOver: (e) => {
        if (!dragGroupId || dragGroupId === groupId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const pos: DropPos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
        setDragOver((prev) =>
          prev && prev.id === groupId && prev.pos === pos ? prev : { id: groupId, pos },
        );
      },
      onDragLeave: (e) => {
        // Only clear if leaving the head row entirely (not a child element).
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver((prev) => (prev && prev.id === groupId ? null : prev));
      },
      onDrop: (e) => {
        e.preventDefault();
        handleGroupDrop(groupId);
      },
      onDragEnd: clearDrag,
    };
  };

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
                onNewWindow={onNewWindow}
                dragProps={dragProps(g.key, g.key !== OTHER_REPO_KEY)}
              />
            ))
          ) : (
            sessionRows.map(({ session, windows: ws }) => (
              <SessionGroup
                key={session.id}
                session={session}
                windows={ws}
                selectedPaneId={selectedPaneId}
                onNewWindow={onNewWindow ? () => onNewWindow(session.id) : undefined}
                dragProps={dragProps(session.id, true)}
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
          <Detail
            window={selected}
            onFocus={onFocus}
            onToast={onToast}
          />
        ) : (
          <div className="sb-detail-empty">
            <p>Select a pane from the rail to see its live terminal.</p>
            <p className="sb-detail-empty-sub">
              The rest of the dashboard's chrome stays where it is — Kanban,
              Grid, List still open the modal on click.
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
  /** Drag-to-reorder wiring (null when reorder is disabled — e.g. while the
   *  rail is collapsed). */
  dragProps: GroupDragProps | null;
}

function SessionGroup({
  session,
  windows,
  selectedPaneId,
  onNewWindow,
  dragProps,
}: SessionGroupProps) {
  return (
    <div className="sb-group">
      <HeadRow
        dragProps={dragProps}
        aria-label={`Session ${session.name}`}
      >
        <span className="ic">
          <Icon name="kanban" size={11} />
        </span>
        <span className="lbl">{session.name}</span>
      </HeadRow>
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
   *  session ID that owns the new tab. */
  onNewWindow?: (sessionId: string) => void;
  /** Drag-to-reorder wiring (null for the "Other" bucket and while
   *  collapsed). */
  dragProps: GroupDragProps | null;
}

function RepoGroupView({
  group,
  selectedPaneId,
  onNewWindow,
  dragProps,
}: RepoGroupViewProps) {
  const isOther = group.key === OTHER_REPO_KEY;
  // The "+ New tab" in repos mode lands in the session of the first window
  // in this bucket. THI-244-style cwd-aware spawning (so the new tab opens
  // in the repo's path) is wired up at the NewWindowOverlay layer — out of
  // scope for the rail itself.
  const firstSessionId = group.windows[0]?.session;
  const handleNewWindow =
    onNewWindow && firstSessionId ? () => onNewWindow(firstSessionId) : undefined;
  return (
    <div className="sb-group">
      <HeadRow
        dragProps={dragProps}
        title={isOther ? "Windows whose cwd isn't a git repo" : group.key}
        aria-label={`Repo ${group.label}`}
      >
        <span className="ic">
          <Icon name="git-branch" size={11} />
        </span>
        <span className="lbl">{group.label}</span>
        <span className="count">{group.windows.length}</span>
      </HeadRow>
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

/** Group head row with drag handlers and drop-indicator styling. Spreads
 *  `dragProps` (when present) onto the row's DOM node; otherwise renders a
 *  plain head row. */
function HeadRow({
  dragProps,
  title,
  children,
  ...rest
}: {
  dragProps: GroupDragProps | null;
  title?: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  const className =
    "sb-row sb-row-head" +
    (dragProps?.isDragging ? " is-dragging" : "") +
    (dragProps?.dropIndicator === "before" ? " drop-before" : "") +
    (dragProps?.dropIndicator === "after" ? " drop-after" : "");
  if (!dragProps) {
    return (
      <div className={className} title={title} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <div
      className={className}
      title={title}
      draggable={dragProps.draggable}
      onDragStart={dragProps.onDragStart}
      onDragEnter={dragProps.onDragEnter}
      onDragOver={dragProps.onDragOver}
      onDragLeave={dragProps.onDragLeave}
      onDrop={dragProps.onDrop}
      onDragEnd={dragProps.onDragEnd}
      {...rest}
    >
      {children}
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

/** The detail pane's content: header + inline xterm + connection chip.
 *
 *  PaneTerminal is keyed on `paneId` so changing the selected pane tears
 *  down the previous xterm + WebSocket and remounts a fresh one. As long as
 *  the same pane stays selected — even across `windows[]` re-renders from
 *  every /api/state poll — the key is stable and PaneTerminal reuses its
 *  existing terminal + connection.
 *
 *  Toast handling is optional; older callers / tests don't supply it and
 *  pass-throughs become no-ops. */
function Detail({
  window: w,
  onFocus,
  onToast,
}: {
  window: Window;
  onFocus: (w: Window) => void;
  onToast?: (msg: string) => void;
}) {
  const [conn, setConn] = useState<Connection>("connecting");
  const handleToast = onToast ?? (() => {});
  return (
    <>
      <DetailHeader window={w} onFocus={onFocus} conn={conn} />
      <PaneTerminal
        key={w.paneId}
        window={w}
        onEscape={() => {
          /* No-op for the inline detail. The terminal already swallowed Esc
           * via xterm's customKeyEventHandler; the parent wants to keep the
           * pane focused. Future work: clear the selectedPaneId so the rail
           * returns to the empty hint. */
        }}
        onToast={handleToast}
        onConnectionChange={(state) => setConn(state)}
      />
    </>
  );
}

/** Pixel-stable wrapping chip header for the Split detail pane. Mirrors
 *  TerminalModal's chip layout (branch/PR + spinner + StatusPill + action)
 *  so the at-a-glance signal is the same whether the user is in modal or
 *  inline mode. Connection state surfaces as a dim trailing pill so the
 *  user can tell a stalled stream from a healthy one without a modal footer. */
function DetailHeader({
  window: w,
  onFocus,
  conn,
}: {
  window: Window;
  onFocus: (w: Window) => void;
  conn?: Connection;
}) {
  const agent = w.agent;
  return (
    <header className="sb-pane-hd">
      <span className="pid">
        <span className={`ic ${w.kind === "agent" ? "agent" : ""}`}>
          <Icon name={w.kind === "agent" ? "agent" : "shell"} size={13} />
        </span>
        <b className="pname">{w.name}</b>
      </span>
      <span className="meta sess" title={`session ${w.session}, window ${w.index}`}>
        {w.session}
        <span className="sep">›</span>:{w.index}
      </span>
      {(w.branch || w.pr) && (
        <Chip
          className={`branch-pr ${w.ci ? `ci-${w.ci}` : ""}`}
          title={w.branch || `PR #${w.pr}`}
        >
          {w.ci && <span className={`ci-dot ci-${w.ci}`} aria-hidden="true" />}
          {w.branch && <Icon name="git-branch" size={10} />}
          {w.branch && <span>{w.branch}</span>}
          {w.branch && w.pr && <span className="pr-sep">›</span>}
          {w.pr && w.prUrl ? (
            <a
              className="pr-num pr-link"
              href={w.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open PR #${w.pr} on GitHub`}
            >
              #{w.pr}
            </a>
          ) : (
            w.pr && <span className="pr-num">#{w.pr}</span>
          )}
        </Chip>
      )}
      {agent?.spinner && (
        <Chip className="spinner" title="agent activity">
          <span className="spin" />
          <span>{agent.spinner}</span>
          {agent.duration && <span className="dur">{agent.duration}</span>}
        </Chip>
      )}
      {/* Ctx% chip — only when the parser surfaced it. Same field the Kanban
          card shows; placed last in the metadata strip so it sits beside the
          status pill. */}
      {agent?.contextPct !== undefined && (
        <Chip className="ctx" title={`Claude context: ${agent.contextPct}% used`}>
          <span>ctx {agent.contextPct}%</span>
        </Chip>
      )}
      <span className="grow" />
      {/* Connection state — dim pill so it doesn't compete with the status
          pill. The xterm itself surfaces [reconnecting…] inline, so this is
          a redundant safety net rather than a primary signal. */}
      {conn && conn !== "live" && (
        <span className={`sb-pane-conn ${conn}`} title={`WebSocket: ${conn}`}>
          {conn}
        </span>
      )}
      <StatusPill status={w.status} />
      {/* Pending-input hint, same shape TerminalModal's header uses. Lets
          the user see what to answer from the detail header without
          scrolling the terminal. */}
      {w.pendingInput && agent?.action && (
        <span className="sb-pane-action" title={agent.action}>
          {agent.action}
        </span>
      )}
      <button
        className="btn btn-icon btn-ghost"
        onClick={() => onFocus(w)}
        title="Focus this window in tmux"
        aria-label="Focus in tmux"
      >
        <Icon name="focus" />
      </button>
    </header>
  );
}
