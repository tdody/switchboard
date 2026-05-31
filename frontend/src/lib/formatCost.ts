/**
 * Cost + token formatters for the auto-rename modal footer (THI-67).
 *
 * USD is rendered with progressively fewer decimals as the magnitude grows —
 * the goal is "show enough precision to be meaningful" without padding zeros.
 * Tokens use the same k/M compression as the Claude usage pill.
 */

/** Always-prefixed `~$X.YYYY` / `~$X.YYY` / `~$X.YY` depending on magnitude.
 *  Pinned at 4 sig figs to keep "$0.0001" and "$1.23" readable in the same row. */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "~$0.0000";
  if (usd >= 1) return `~$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `~$${usd.toFixed(3)}`;
  return `~$${usd.toFixed(4)}`;
}

/**
 * Compact token count. Matches `usageFormat.fmtTokens` so the rename modal
 * and the header pill speak the same shorthand.
 *   42         -> "42"
 *   1532       -> "1.5k"
 *   1_240_000  -> "1.24M"
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1_000) return String(Math.floor(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Combined `~$0.0021 · 2.4k tokens` rendering used in the modal footer. */
export function formatCost(usd: number, tokens: number): string {
  return `${formatUsd(usd)} · ${formatTokens(tokens)} tokens`;
}
