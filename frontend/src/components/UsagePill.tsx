import type { UsageMeter, UsageResponse } from "../types";
import {
  activeTokens,
  fmtResetCountdown,
  fmtTokens,
  meterTone,
  tokenTone,
} from "../lib/usageFormat";

interface Props {
  usage: UsageResponse | null;
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
 * Header pill showing Claude rolling-window token usage (THI-110).
 *
 * Three render branches, priority-ordered:
 *   1. Scrape available → render `claude /usage` meters with %-bars (commit 2).
 *   2. Tokens available → render token-window text pill with countdown.
 *   3. Nothing available → render nothing (zero visual weight).
 *
 * The scrape branch is preferred because percentages map directly to plan
 * limits; the token branch is a free local approximation that's good enough
 * when the optional scrape hasn't run yet or is disabled.
 */
export function UsagePill({ usage }: Props) {
  if (!usage) return null;

  if (usage.scrape?.available) {
    return (
      <span className="usage-pill usage-pill-meters" title={scrapeTitle(usage)}>
        {METER_ORDER.flatMap((key) => {
          const meter = usage.scrape!.meters[key];
          if (!meter) return [];
          return [
            <UsageMeterChip key={key} short={METER_SHORT_LABELS[key] ?? key} meter={meter} />,
          ];
        })}
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
      <span className={`usage-pill usage-pill-${tone}`} title={pillTitle(usage)}>
        <span className="usage-window">5h</span>
        <span className="usage-total">{fmtTokens(active)}</span>
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

function pillTitle(usage: UsageResponse): string {
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
  return parts.join("\n");
}

function scrapeTitle(usage: UsageResponse): string {
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
  return parts.join("\n");
}
