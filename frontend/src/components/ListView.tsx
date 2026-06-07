import { memo } from "react";

import type { Window } from "../types";
import { sortPendingFirst } from "../lib/filter";
import { formatMem } from "../lib/format";
import { groupByRepo } from "../lib/groupByRepo";
import { quickActionsFor, type QuickAction } from "../lib/quickActions";
import type { GroupingMode } from "../lib/settings";
import { cpuLevel, kindIcon, memLevel, STATUS_META } from "../lib/status";
import { AgoSpan } from "./AgoSpan";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import { Tooltip } from "./Tooltip";

interface Props {
  windows: Window[];
  focusedId: string | null;
  highlightedId: string | null;
  onOpen: (w: Window) => void;
  onSend: (w: Window) => void;
  onRename: (w: Window) => void;
  onFocus: (w: Window) => void;
  onKill: (w: Window, skipConfirm: boolean) => void;
  onQuickAction?: (w: Window, action: QuickAction) => void;
  pinnedPaneIds?: Set<string>;
  onTogglePin?: (w: Window) => void;
  /** THI-243: when "repos", rows are interleaved with repo header rows
   *  derived from each pane's `repoKey`. Default "sessions" preserves the
   *  flat-list legacy behavior. */
  groupingMode?: GroupingMode;
}

/**
 * THI-60: dense, single-line tabular layout. One <ListRow> per visible
 * window. Pending panes float to the top (same rule as Kanban/Grid), then
 * pinned (THI-98), then natural tmux index.
 *
 * Sessions mode groups rows under session headers; repos mode (THI-243)
 * groups under repo headers via groupByRepo(). Both share the .list-group
 * DOM structure so CSS stays one ruleset.
 *
 * Best for many small panes where the Kanban/Grid card footprint is too big.
 */
export function ListView({
  windows,
  focusedId,
  highlightedId,
  onOpen,
  onSend,
  onRename,
  onFocus,
  onKill,
  onQuickAction,
  pinnedPaneIds,
  onTogglePin,
  groupingMode,
}: Props) {
  const sorted = sortPendingFirst(
    windows,
    pinnedPaneIds && pinnedPaneIds.size > 0 ? [...pinnedPaneIds] : undefined,
  );

  if (sorted.length === 0) {
    return (
      <div className="list-view">
        <div className="list-empty">no matching windows</div>
      </div>
    );
  }

  const rowFor = (w: Window) => (
    <ListRow
      key={w.paneId}
      w={w}
      isFocused={focusedId === w.paneId}
      isHighlighted={highlightedId === w.paneId}
      isPinned={!!pinnedPaneIds?.has(w.paneId)}
      onOpen={onOpen}
      onSend={onSend}
      onRename={onRename}
      onFocus={onFocus}
      onKill={onKill}
      onQuickAction={onQuickAction}
      onTogglePin={onTogglePin}
    />
  );

  // THI-243: discovery mode inserts a repo header row before each group.
  // groupByRepo preserves the sortPendingFirst ordering within each bucket.
  if (groupingMode === "repos") {
    const groups = groupByRepo(sorted);
    return (
      <div className="list-view" role="table" aria-label="windows">
        {groups.map((g) => (
          <div key={g.key} className="list-group">
            <div
              className="list-group-head"
              role="rowheader"
              title={g.key === "__other__" ? "Sessions without a git repo" : g.key}
            >
              <Icon name="git-branch" size={11} />
              <span className="list-group-label">{g.label}</span>
              <span className="list-group-count">{g.windows.length}</span>
            </div>
            {g.windows.map(rowFor)}
          </div>
        ))}
      </div>
    );
  }

  // Sessions mode: group rows under one header per tmux session. Sessions
  // appear in first-seen order from the post-sort window list, so a session
  // containing a pending window floats to the top of the page along with
  // the row inside it.
  const sessionBuckets = new Map<string, Window[]>();
  for (const w of sorted) {
    const bucket = sessionBuckets.get(w.session);
    if (bucket) bucket.push(w);
    else sessionBuckets.set(w.session, [w]);
  }
  return (
    <div className="list-view" role="table" aria-label="windows">
      {[...sessionBuckets].map(([session, ws]) => (
        <div key={session} className="list-group">
          <div
            className="list-group-head"
            role="rowheader"
            title={`session: ${session}`}
          >
            <Icon name="session" size={11} />
            <span className="list-group-label">{session}</span>
            <span className="list-group-count">{ws.length}</span>
          </div>
          {ws.map(rowFor)}
        </div>
      ))}
    </div>
  );
}

interface RowProps {
  w: Window;
  isFocused: boolean;
  isHighlighted: boolean;
  isPinned: boolean;
  onOpen: (w: Window) => void;
  onSend: (w: Window) => void;
  onRename: (w: Window) => void;
  onFocus: (w: Window) => void;
  onKill: (w: Window, skipConfirm: boolean) => void;
  onQuickAction?: (w: Window, action: QuickAction) => void;
  onTogglePin?: (w: Window) => void;
}

function ListRowImpl({
  w,
  isFocused,
  isHighlighted,
  isPinned,
  onOpen,
  onSend,
  onRename,
  onFocus,
  onKill,
  onQuickAction,
  onTogglePin,
}: RowProps) {
  const agent = w.agent;
  const pending = !!w.pendingInput;
  const tone = STATUS_META[w.status]?.tone ?? "gray";
  const cpu = cpuLevel(w.cpu);
  const mem = memLevel(w.mem);
  const quickActions = onQuickAction ? quickActionsFor(w) : [];
  // Recap takes priority over raw cmd for the description column: agents
  // usually have an informative recap, shells fall through to the running
  // command. Empty string collapses the column gracefully.
  const description = agent?.recap || w.cmd || "";
  const className =
    `list-row${pending ? " is-pending" : ""}` +
    (isFocused ? " is-focused" : "") +
    (isHighlighted ? " is-hl" : "") +
    (isPinned ? " is-pinned" : "");
  return (
    <div className={className} role="row" data-card-id={w.paneId}>
      <span
        className={`list-status-dot tone-${tone}`}
        title={STATUS_META[w.status]?.label ?? w.status}
        aria-hidden="true"
      />
      <span className={`list-kind kind-${w.kind}`} title={w.kind}>
        <Icon name={kindIcon(w.kind)} size={12} />
      </span>
      <button
        type="button"
        className="list-row-body"
        onClick={() => onOpen(w)}
        title={`Open ${w.session}:${w.name}`}
      >
        <span className="list-session" title={`session: ${w.session}`}>
          {w.session}
        </span>
        <span className="list-name" title={w.name}>
          {w.name}
        </span>
        <span className="list-idx">:{w.index}</span>
        {isPinned && (
          <span className="list-pin-badge" aria-label="pinned">
            <Icon name="pin" size={10} />
          </span>
        )}
        <span className="list-desc" title={description}>
          {description}
        </span>
      </button>
      <span className="list-chips">
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
                onClick={(e) => e.stopPropagation()}
                title={`Open PR #${w.pr} on GitHub`}
              >
                #{w.pr}
              </a>
            ) : (
              w.pr && <span className="pr-num">#{w.pr}</span>
            )}
          </Chip>
        )}
      </span>
      <span className="list-resources" title="cpu / memory">
        {(cpu || mem) && (
          <>
            <span className={`resource ${cpu}`}>
              <b>{w.cpu.toFixed(0)}%</b>
            </span>
            <span className="sep">·</span>
            <span className={`resource ${mem}`}>{formatMem(w.mem)}</span>
          </>
        )}
      </span>
      <StatusPill status={w.status} />
      <span className="list-ago" title="last activity">
        <Icon name="clock" size={11} style={{ opacity: 0.6 }} />
        <AgoSpan ts={w.lastActivity} />
      </span>
      <span className="list-actions" onClick={(e) => e.stopPropagation()}>
        <Tooltip content="Jump to this window in your terminal">
          <button className="act act-icon" onClick={() => onFocus(w)}>
            <Icon name="focus" size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Rename window">
          <button className="act act-icon" onClick={() => onRename(w)}>
            <Icon name="rename" size={12} />
          </button>
        </Tooltip>
        <Tooltip content="Send keys">
          <button className="act act-icon" onClick={() => onSend(w)}>
            <Icon name="send" size={12} />
          </button>
        </Tooltip>
        {onTogglePin && (
          <Tooltip content={isPinned ? "Unpin window" : "Pin window"}>
            <button
              className={`act act-icon act-pin${isPinned ? " is-pinned" : ""}`}
              onClick={() => onTogglePin(w)}
              aria-pressed={isPinned}
            >
              <Icon name="pin" size={12} />
            </button>
          </Tooltip>
        )}
        {quickActions.map((a) => (
          <Tooltip key={a.id} content={a.title}>
            <button
              className="act act-quick"
              onClick={() => onQuickAction!(w, a)}
            >
              {a.label}
            </button>
          </Tooltip>
        ))}
        <Tooltip content="Kill window — Shift-click to skip the confirm">
          <button
            className="act act-icon act-danger"
            onClick={(e) => onKill(w, e.shiftKey)}
          >
            <Icon name="trash" size={12} />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

// Same shallow-field memo strategy as WindowCard — every poll hands us a
// fresh Window object, so referential equality is useless. Compare only the
// fields the row renders.
const ListRow = memo(ListRowImpl, (prev, next) => {
  if (prev.isFocused !== next.isFocused) return false;
  if (prev.isHighlighted !== next.isHighlighted) return false;
  if (prev.isPinned !== next.isPinned) return false;
  if (prev.onOpen !== next.onOpen) return false;
  if (prev.onSend !== next.onSend) return false;
  if (prev.onRename !== next.onRename) return false;
  if (prev.onFocus !== next.onFocus) return false;
  if (prev.onKill !== next.onKill) return false;
  if (prev.onQuickAction !== next.onQuickAction) return false;
  if (prev.onTogglePin !== next.onTogglePin) return false;
  const a = prev.w;
  const b = next.w;
  return (
    a.paneId === b.paneId &&
    a.id === b.id &&
    a.session === b.session &&
    a.name === b.name &&
    a.index === b.index &&
    a.kind === b.kind &&
    a.status === b.status &&
    a.lastActivity === b.lastActivity &&
    a.cpu === b.cpu &&
    a.mem === b.mem &&
    a.pendingInput === b.pendingInput &&
    a.branch === b.branch &&
    a.pr === b.pr &&
    a.prUrl === b.prUrl &&
    a.ci === b.ci &&
    a.cmd === b.cmd &&
    a.agent?.recap === b.agent?.recap
  );
});
