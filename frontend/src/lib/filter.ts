import type { Window } from "../types";

export type StatusFilter = "all" | "waiting" | "running" | "idle";

export interface ParsedQuery {
  tokens: { kind?: string; status?: string; session?: string };
  freeText: string;
}

const KEYS = new Set(["kind", "status", "session"]);

export function parseQuery(q: string): ParsedQuery {
  const tokens: ParsedQuery["tokens"] = {};
  const rest: string[] = [];
  for (const part of (q || "").split(/\s+/).filter(Boolean)) {
    const m = part.match(/^(\w+):(.+)$/);
    if (m && KEYS.has(m[1].toLowerCase())) {
      (tokens as Record<string, string>)[m[1].toLowerCase()] = m[2].toLowerCase();
    } else {
      rest.push(part);
    }
  }
  return { tokens, freeText: rest.join(" ") };
}

export function applyFilter(
  windows: Window[],
  filter: StatusFilter,
  parsed: ParsedQuery,
): Window[] {
  const { tokens, freeText } = parsed;
  const q = freeText.toLowerCase();
  return windows.filter((w) => {
    if (filter !== "all" && w.status !== filter) return false;
    if (tokens.kind && w.kind !== tokens.kind) return false;
    if (tokens.status && w.status !== tokens.status) return false;
    if (tokens.session && w.session !== tokens.session) return false;
    if (!q) return true;
    return (
      w.name.toLowerCase().includes(q) ||
      w.session.toLowerCase().includes(q) ||
      (w.agent?.branch ?? "").toLowerCase().includes(q) ||
      (w.agent?.recap ?? "").toLowerCase().includes(q) ||
      (w.cmd ?? "").toLowerCase().includes(q)
    );
  });
}

// Coarse buckets keep Claude panes from shuffling mid-poll: a window
// oscillating between running and idle stayed in two different ranks under
// the old 5-bucket scheme, swapping positions every tick (THI-122).
const rank = (w: Window): number => {
  if (w.pendingInput) return 0;
  if (w.status === "error") return 1;
  return 2;
};

export function sortPendingFirst(ws: Window[]): Window[] {
  // Secondary sort by tmux window-index pins within-bucket position to the
  // same order the user sees in tmux — predictable for clicks + keyboard nav.
  return [...ws].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
}
