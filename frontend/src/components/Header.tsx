import type { UsageResponse } from "../types";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";
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
  onHelp: () => void;
  onSettings: () => void;
  onRetry?: () => void;
}

export function Header({
  counts,
  serverAddr,
  inEmpty,
  usage,
  onHelp,
  onSettings,
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

      {!inEmpty && <UsagePill usage={usage ?? null} />}

      <div className="hdr-cta">
        {inEmpty && onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            <Icon name="spinner" /> Retry
          </button>
        )}
        <button
          className="btn btn-icon btn-ghost"
          onClick={onHelp}
          title="Keyboard shortcuts (?)"
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, lineHeight: 1 }}>?</span>
        </button>
        <button className="btn btn-icon btn-ghost" onClick={onSettings} title="Settings">
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}
