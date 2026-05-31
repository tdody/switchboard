/**
 * Formatters + tone thresholds for the Claude usage pill (THI-110).
 *
 * Kept in a tiny standalone module so the constants are tunable and the
 * component (UsagePill) stays pure render.
 */

export type Tone = "ok" | "warn" | "danger";

/**
 * Compact human token count.
 *   42         -> "42"
 *   1532       -> "1.5k"
 *   1_240_000  -> "1.24M"
 *
 * Truncates rather than rounds-up so a "1.0M" reading doesn't visually cross
 * the million-tokens threshold until it's genuinely past it.
 */
export function fmtTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * "in 2h 11m" / "in 4m" / "now" — countdown from `now` to `resetAtSeconds`,
 * the unix epoch seconds at which the rolling window reopens. Returns null
 * when no anchor is set (no in-window message recorded yet).
 */
export function fmtResetCountdown(resetAtSeconds: number | null, now = Date.now()): string | null {
  if (resetAtSeconds === null) return null;
  const delta = resetAtSeconds * 1000 - now;
  if (delta <= 0) return "now";
  const totalMin = Math.floor(delta / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `in ${m}m`;
  return `in ${h}h ${m}m`;
}

/**
 * "Active" tokens — the ones that actually draw down plan quota at full price.
 * Periscope's grid.js uses the same definition: input + cache_creation + output.
 * `cache_read_tokens` is excluded because it's heavily discounted (~10% of
 * input price) and including it would make every Claude Code session look
 * pinned at 100M+ on a heavy day, drowning the signal.
 */
export function activeTokens(usage: {
  inputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}): number {
  return usage.inputTokens + usage.cacheCreationTokens + usage.outputTokens;
}

// Active-token tone thresholds, calibrated for a typical Claude Code session:
//   ok    < 3M   normal coding day
//   warn  3M–6M  heavy session, watch the burn
//   danger ≥ 6M  pushing the plan
// Tunable here if a future plan shifts the soft cap, without touching the pill.
export const ACTIVE_TOKEN_WARN_THRESHOLD = 3_000_000;
export const ACTIVE_TOKEN_DANGER_THRESHOLD = 6_000_000;

export function tokenTone(activeTokenCount: number): Tone {
  if (activeTokenCount >= ACTIVE_TOKEN_DANGER_THRESHOLD) return "danger";
  if (activeTokenCount >= ACTIVE_TOKEN_WARN_THRESHOLD) return "warn";
  return "ok";
}

/**
 * Percentage-based tone for the optional `claude /usage` meters (THI-110
 * commit 2). Kept here so all the tone math lives in one file.
 */
export function meterTone(percent: number): Tone {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warn";
  return "ok";
}

/**
 * USD cost formatter for the usage pill (THI-139).
 *   0       -> "$0.00"
 *   0.6592  -> "$0.66"
 *   12.345  -> "$12.35"
 *   1234.5  -> "$1,234.50"
 *
 * `Intl.NumberFormat` handles the grouping and rounding; we ask for 2
 * fraction digits unconditionally so the field width is stable on the pill.
 */
const _USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function fmtCost(usd: number): string {
  return _USD.format(usd);
}
