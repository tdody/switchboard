import { memo } from "react";
import type { Window } from "../types";
import { formatAgo, formatMem } from "../lib/format";
import { cpuLevel, kindIcon, memLevel } from "../lib/status";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";

interface Props {
  w: Window;
  isFocused: boolean;
  isHighlighted: boolean;
  onOpen: (w: Window) => void;
  onSendKeys: (w: Window) => void;
  onRename: (w: Window) => void;
  onFocus: (w: Window) => void;
}

function WindowCardImpl({
  w,
  isFocused,
  isHighlighted,
  onOpen,
  onSendKeys,
  onRename,
  onFocus,
}: Props) {
  const pending = !!w.pendingInput;
  const ago = formatAgo(w.lastActivity);
  const agent = w.agent;
  const cpu = cpuLevel(w.cpu);
  const mem = memLevel(w.mem);
  const showResources = !!cpu || !!mem;
  const className =
    `card ${pending ? "card-pending" : ""} ${isFocused ? "card-focused" : ""}` +
    (isHighlighted ? " card-hl" : "");
  return (
    <div
      className={className}
      data-card-id={w.id}
      onClick={() => onOpen(w)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(w);
        }
      }}
    >
      <div className="card-head">
        <span className={`card-kind kind-${w.kind}`} title={w.kind}>
          <Icon name={kindIcon(w.kind)} size={12} />
        </span>
        <span className="card-name" title={w.name}>
          {w.name}
        </span>
        <span className="card-idx">:{w.index}</span>
        <StatusPill status={w.status} />
      </div>

      {agent && (
        <div className="card-agent">
          <div className="chip-row">
            {(agent.branch || agent.pr) && (
              <Chip
                className={`branch-pr ${agent.ci ? `ci-${agent.ci}` : ""}`}
                title={agent.branch || `PR #${agent.pr}`}
              >
                {agent.ci && <span className={`ci-dot ci-${agent.ci}`} aria-hidden="true" />}
                {agent.branch && <Icon name="git-branch" size={10} />}
                {agent.branch && <span>{agent.branch}</span>}
                {agent.branch && agent.pr && <span className="pr-sep">›</span>}
                {agent.pr && <span className="pr-num">#{agent.pr}</span>}
              </Chip>
            )}
            {agent.spinner && (
              <Chip className="spinner" title="agent activity">
                <span className="spin" />
                <span>{agent.spinner}</span>
                {agent.duration && <span className="dur">{agent.duration}</span>}
              </Chip>
            )}
          </div>
          {agent.recap && <div className="recap">{agent.recap}</div>}
          {pending && agent.action && (
            <div className="pending">
              <span className="glyph">›</span>
              <span>{agent.action}</span>
            </div>
          )}
        </div>
      )}

      <div className="preview">
        {w.preview.map((line, i) => (
          <div key={i} className="ln">
            {line}
          </div>
        ))}
      </div>

      {showResources && (
        <div className="card-meta">
          <span className={`resource ${cpu}`} title="cpu">
            <b>{w.cpu.toFixed(1)}%</b> cpu
          </span>
          <span className="sep">·</span>
          <span className={`resource ${mem}`} title="memory">
            <b>{formatMem(w.mem)}</b> mem
          </span>
        </div>
      )}

      <div className="card-foot" onClick={(e) => e.stopPropagation()}>
        <button
          className="act act-icon"
          onClick={() => onFocus(w)}
          title="Jump to this window in your terminal (tmux switch-client)"
        >
          <Icon name="focus" size={12} />
        </button>
        <button className="act act-icon" onClick={() => onRename(w)} title="Rename window">
          <Icon name="rename" size={12} />
        </button>
        <button className="act act-icon" onClick={() => onSendKeys(w)} title="Send keys">
          <Icon name="send" size={12} />
        </button>
        <span className="spacer" />
        <span className="ago" title="last activity">
          <Icon name="clock" size={11} style={{ opacity: 0.6 }} />
          <span>{ago}</span>
        </span>
      </div>
    </div>
  );
}

export const WindowCard = memo(WindowCardImpl, (prev, next) => {
  if (prev.isFocused !== next.isFocused) return false;
  if (prev.isHighlighted !== next.isHighlighted) return false;
  if (prev.onOpen !== next.onOpen) return false;
  if (prev.onSendKeys !== next.onSendKeys) return false;
  if (prev.onRename !== next.onRename) return false;
  if (prev.onFocus !== next.onFocus) return false;
  // The Window object is replaced wholesale on each poll. Shallow-compare the
  // fields the card actually renders. (No deep-compare to keep this cheap.)
  const a = prev.w;
  const b = next.w;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.index === b.index &&
    a.kind === b.kind &&
    a.status === b.status &&
    a.lastActivity === b.lastActivity &&
    a.cpu === b.cpu &&
    a.mem === b.mem &&
    a.pendingInput === b.pendingInput &&
    a.agent?.branch === b.agent?.branch &&
    a.agent?.pr === b.agent?.pr &&
    a.agent?.ci === b.agent?.ci &&
    a.agent?.spinner === b.agent?.spinner &&
    a.agent?.duration === b.agent?.duration &&
    a.agent?.recap === b.agent?.recap &&
    a.agent?.action === b.agent?.action
  );
});
