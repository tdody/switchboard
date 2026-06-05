import type { Window } from "../types";

export type StatusFilter = "all" | "waiting" | "running" | "idle";
// Chip-driven kind filter. "" means "no chip selected" (show all kinds).
// Scoped to agent/shell only per THI-130; other kinds remain reachable via
// the search-box `kind:` token.
export type KindFilter = "" | "agent" | "shell";
export const KIND_FILTERS: KindFilter[] = ["", "agent", "shell"];

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
  kindFilter: KindFilter,
  parsed: ParsedQuery,
): Window[] {
  const { tokens, freeText } = parsed;
  const q = freeText.toLowerCase();
  return windows.filter((w) => {
    if (filter !== "all" && w.status !== filter) return false;
    if (kindFilter && w.kind !== kindFilter) return false;
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

// Overlay rule for THI-98 pinned windows: a pinned pane stays visible even
// when the active filter would normally hide it. Non-pinned panes follow the
// usual `applyFilter` rules. Pinned panes already in the filtered result are
// not duplicated; pinned ids that don't reference an existing window are
// silently ignored so a torn-down session doesn't strand stale entries.
export function applyFilterWithPins(
  windows: Window[],
  filter: StatusFilter,
  kindFilter: KindFilter,
  parsed: ParsedQuery,
  pinnedIds: Set<string>,
): Window[] {
  const filtered = applyFilter(windows, filter, kindFilter, parsed);
  if (pinnedIds.size === 0) return filtered;
  const seen = new Set(filtered.map((w) => w.paneId));
  const extras = windows.filter(
    (w) => pinnedIds.has(w.paneId) && !seen.has(w.paneId),
  );
  return extras.length === 0 ? filtered : [...filtered, ...extras];
}

// Strip every `kind:value` token (case-insensitive) from a search-box string,
// preserving the rest. Used when the chip-click handler needs to clear a
// competing `kind:` token so the chip and the search box don't visually
// disagree (THI-130).
export function stripKindToken(q: string): string {
  return q.replace(/\bkind:\S+\s*/gi, "").trim();
}

// Coarse buckets keep Claude panes from shuffling mid-poll: a window
// oscillating between running and idle stayed in two different ranks under
// the old 5-bucket scheme, swapping positions every tick (THI-122).
const rank = (w: Window): number => {
  if (w.pendingInput) return 0;
  if (w.status === "error") return 1;
  return 2;
};

export function sortPendingFirst(
  ws: Window[],
  pinnedPaneIds: string[] = [],
): Window[] {
  // Within-bucket tie-break: pinned panes come first in pinned order,
  // unpinned panes fall back to tmux window-index (THI-141). Pinned panes
  // never outrank a higher bucket — a pending pane still floats above a
  // pinned non-pending one, matching THI-122's "pending is always visible"
  // rule.
  //
  // The Map turns Array.indexOf into O(1), which matters for sessions with
  // many panes since the comparator runs N log N times.
  const pinIndex = new Map<string, number>();
  for (let i = 0; i < pinnedPaneIds.length; i++) {
    pinIndex.set(pinnedPaneIds[i], i);
  }
  return [...ws].sort((a, b) => {
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    const pa = pinIndex.get(a.paneId);
    const pb = pinIndex.get(b.paneId);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1; // a pinned, b not: a first
    if (pb !== undefined) return 1; //  b pinned, a not: b first
    return a.index - b.index;
  });
}
