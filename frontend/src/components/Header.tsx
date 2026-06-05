import type { UsageResponse } from "../types";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";
import { Tooltip } from "./Tooltip";
import { UsagePill } from "./UsagePill";

export interface HeaderCounts {
  all: number;
  waiting: number;
  running: number;
  idle: number;
}

interface Props {
  counts: HeaderCounts;
  serverAddr: string;
  inEmpty: boolean;
  /** Claude rolling-window usage; null while the first /api/usage poll is in
   *  flight. Pill hides itself when usage data isn't available (THI-110). */
  usage?: UsageResponse | null;
  /** Sum of `agent.sessionCostUsd` across the currently-visible agent panes,
   *  computed in App.tsx (THI-139). Drives the cost figure in the usage pill;
   *  0 when no claude pane reports a `💰` line yet. */
  activeSessionCostUsd?: number;
  onHelp: () => void;
  onSettings: () => void;
  onOpenDocs: () => void;
  onNewSession: () => void;
  /** Open the templates modal (THI-99). Optional so older callers that
   *  don't wire it up don't have to ship a button they won't use. */
  onOpenTemplates?: () => void;
  onRetry?: () => void;
}

export function Header({
  counts,
  serverAddr,
  inEmpty,
  usage,
  activeSessionCostUsd,
  onHelp,
  onSettings,
  onOpenDocs,
  onNewSession,
  onOpenTemplates,
  onRetry,
}: Props) {
  return (
    <header className="hdr">
      <div className="hdr-brand">
        <SwitchboardMark size={26} />
        <div>
          <div className="hdr-title">Switchboard</div>
        </div>
        <div className="hdr-sub">{serverAddr}</div>
      </div>

      {!inEmpty && (
        <div
          className="stats"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--text-mute)",
            whiteSpace: "nowrap",
            gap: 8,
          }}
        >
          <span>
            <span className="stat-n">{counts.all}</span> windows
          </span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          <span className="tone-amber">
            <span className="stat-n">{counts.waiting}</span> waiting
          </span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          <span className="tone-cyan">
            <span className="stat-n">{counts.running}</span> running
          </span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          <span className="tone-gray">
            <span className="stat-n">{counts.idle}</span> idle
          </span>
        </div>
      )}

      <div className="hdr-spacer" />

      {!inEmpty && (
        <UsagePill usage={usage ?? null} activeSessionCostUsd={activeSessionCostUsd ?? 0} />
      )}

      <div className="hdr-cta">
        {inEmpty && onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            <Icon name="spinner" /> Retry
          </button>
        )}
        <Tooltip content="Create a new tmux session">
          <button className="btn" onClick={onNewSession} aria-label="New session">
            <Icon name="plus" /> Session
          </button>
        </Tooltip>
        {onOpenTemplates && (
          <Tooltip content="Bootstrap from a template">
            <button
              className="btn btn-ghost"
              onClick={onOpenTemplates}
              aria-label="Open session templates"
            >
              Templates
            </button>
          </Tooltip>
        )}
        <Tooltip content="Keyboard shortcuts" shortcut="?">
          <button className="btn btn-icon btn-ghost" onClick={onHelp} data-tour="kbar-hint">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, lineHeight: 1 }}>?</span>
          </button>
        </Tooltip>
        <Tooltip content="Documentation">
          <button
            className="btn btn-icon btn-ghost"
            onClick={onOpenDocs}
            aria-label="Open documentation"
          >
            <Icon name="docs" size={15} />
          </button>
        </Tooltip>
        <Tooltip content="Settings">
          <button className="btn btn-icon btn-ghost" onClick={onSettings}>
            <Icon name="settings" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
