import type { UsageMeter, UsageResponse } from "../types";
import {
  activeTokens,
  fmtCost,
  fmtResetCountdown,
  fmtTokens,
  meterTone,
  tokenTone,
} from "../lib/usageFormat";

interface Props {
  usage: UsageResponse | null;
  /** Sum of `agent.sessionCostUsd` across visible agent panes (THI-139).
   *  Aggregated in App.tsx; 0 when no pane reports a `💰` line yet (e.g.
   *  fresh sessions before the first billed turn). */
  activeSessionCostUsd?: number;
}

// Short labels for the chip — the full label ("Current week (all models)") is
// too long for the header. The full label still renders in the title tooltip.
const METER_SHORT_LABELS: Record<string, string> = {
  session: "session",
  week_all: "week",
  week_sonnet: "sonnet",
};

// Display order matches periscope's grid.js so the layout reads
// session → week → sonnet left-to-right (matches how /usage renders them).
const METER_ORDER = ["session", "week_all", "week_sonnet"];

/**
 * Header pill showing Claude rolling-window token usage (THI-110) and the
 * aggregate per-session cost across visible agent panes (THI-139).
 *
 * Three render branches, priority-ordered:
 *   1. Scrape available → render `claude /usage` meters with %-bars.
 *   2. Tokens available → render token-window text pill with countdown.
 *   3. Nothing available → render nothing (zero visual weight).
 *
 * The scrape branch is preferred because percentages map directly to plan
 * limits; the token branch is a free local approximation that's good enough
 * when the optional scrape hasn't run yet or is disabled. The cost figure is
 * appended to both branches when `activeSessionCostUsd > 0` — it's the same
 * total the user would get by summing `💰 $X.XX` across every claude pane.
 */
export function UsagePill({ usage, activeSessionCostUsd = 0 }: Props) {
  if (!usage) return null;

  const showCost = activeSessionCostUsd > 0;
  const costChip = showCost ? (
    <span className="usage-cost">{fmtCost(activeSessionCostUsd)}</span>
  ) : null;

  if (usage.scrape?.available) {
    return (
      <span
        className="usage-pill usage-pill-meters"
        title={scrapeTitle(usage, activeSessionCostUsd)}
      >
        {METER_ORDER.flatMap((key) => {
          const meter = usage.scrape!.meters[key];
          if (!meter) return [];
          return [
            <UsageMeterChip key={key} short={METER_SHORT_LABELS[key] ?? key} meter={meter} />,
          ];
        })}
        {costChip}
      </span>
    );
  }

  if (usage.tokens.available) {
    // Show *active* tokens (input + cache_creation + output) — see
    // `activeTokens` doc for why we exclude cache_read.
    const active = activeTokens(usage.tokens);
    const tone = tokenTone(active);
    const countdown = fmtResetCountdown(usage.tokens.resetAt);
    return (
      <span
        className={`usage-pill usage-pill-${tone}`}
        title={pillTitle(usage, activeSessionCostUsd)}
      >
        <span className="usage-window">5h</span>
        <span className="usage-total">{fmtTokens(active)}</span>
        {showCost && <span className="usage-cost">· {fmtCost(activeSessionCostUsd)}</span>}
        {countdown && <span className="usage-reset">· resets {countdown}</span>}
      </span>
    );
  }

  // Neither tokens (no ~/.claude/projects dir) nor scrape — render nothing.
  return null;
}

function UsageMeterChip({ short, meter }: { short: string; meter: UsageMeter }) {
  const tone = meterTone(meter.percent);
  return (
    <span className="usage-meter">
      <span className="usage-meter-label">{short}</span>
      <span className="usage-meter-bar">
        <span
          className={`usage-meter-fill usage-meter-fill-${tone}`}
          style={{ width: `${Math.min(100, meter.percent)}%` }}
          aria-hidden
        />
      </span>
      <span className="usage-meter-pct">{meter.percent}%</span>
    </span>
  );
}

function pillTitle(usage: UsageResponse, costUsd: number): string {
  const t = usage.tokens;
  const active = activeTokens(t);
  // Multi-line title via newlines — most browsers render tooltips honoring \n.
  const parts = [
    `Claude usage — ${t.messages} messages in the last ${t.windowHours}h`,
    `  ${active.toLocaleString()} active tokens (drives the pill)`,
    `    input:        ${t.inputTokens.toLocaleString()}`,
    `    cache create: ${t.cacheCreationTokens.toLocaleString()}`,
    `    output:       ${t.outputTokens.toLocaleString()}`,
    `  ${t.cacheReadTokens.toLocaleString()} cache reads (discounted, excluded from pill)`,
  ];
  if (costUsd > 0) {
    parts.push(`  ${fmtCost(costUsd)} sum of 💰 across visible claude panes`);
  }
  return parts.join("\n");
}

function scrapeTitle(usage: UsageResponse, costUsd: number): string {
  // Full meter labels + reset strings in the tooltip — short labels in the
  // chip itself save space but lose the "Current week (all models)" nuance.
  const meters = usage.scrape!.meters;
  const parts = ["Claude plan usage (claude /usage)"];
  for (const key of METER_ORDER) {
    const m = meters[key];
    if (!m) continue;
    parts.push(`  ${m.label}: ${m.percent}% used`);
    if (m.resets) parts.push(`    resets ${m.resets}`);
  }
  if (costUsd > 0) {
    parts.push(`  ${fmtCost(costUsd)} sum of 💰 across visible claude panes (THI-139)`);
  }
  return parts.join("\n");
}
