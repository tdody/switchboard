import type { UsageResponse } from "../types";
import { activeTokens, fmtResetCountdown, fmtTokens, tokenTone } from "../lib/usageFormat";

interface Props {
  usage: UsageResponse | null;
}

/**
 * Header pill showing Claude rolling-window token usage (THI-110).
 *
 * Three render branches, priority-ordered:
 *   1. Scrape available → render `claude /usage` meters (commit 2).
 *   2. Tokens available → render token-window text pill with countdown.
 *   3. Nothing available → render nothing (zero visual weight).
 *
 * Commit 1 only ships the tokens branch; the scrape data is always null until
 * commit 2 adds the backend support. The branch is wired here already so the
 * component contract stays stable across the two commits.
 */
export function UsagePill({ usage }: Props) {
  if (!usage) return null;

  // Scrape branch is a commit-2 deliverable — guard but don't render meters yet.
  // Falling through to the tokens branch when scrape is null keeps the v1 pill
  // working unchanged.

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

  // Tokens unavailable (no ~/.claude/projects dir) AND no scrape — render nothing.
  return null;
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
