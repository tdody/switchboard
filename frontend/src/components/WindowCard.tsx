import type { Window } from "../types";
import { formatAgo, formatMem } from "../lib/format";
import { cpuLevel, kindIcon, memLevel } from "../lib/status";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";

interface Props {
  w: Window;
  isFocused: boolean;
  onOpen: () => void;
  onSendKeys: () => void;
  onRename: () => void;
  onFocus: () => void;
}

export function WindowCard({ w, isFocused, onOpen, onSendKeys, onRename, onFocus }: Props) {
  const pending = !!w.pendingInput;
  const ago = formatAgo(w.lastActivity);
  const agent = w.agent;
  const cpu = cpuLevel(w.cpu);
  const mem = memLevel(w.mem);
  const showResources = !!cpu || !!mem;
  return (
    <div
      className={`card ${pending ? "card-pending" : ""} ${isFocused ? "card-focused" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
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
          onClick={onFocus}
          title="Jump to this window in your terminal (tmux switch-client)"
        >
          <Icon name="focus" size={12} />
        </button>
        <button className="act act-icon" onClick={onRename} title="Rename window">
          <Icon name="rename" size={12} />
        </button>
        <button className="act act-icon" onClick={onSendKeys} title="Send keys">
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
