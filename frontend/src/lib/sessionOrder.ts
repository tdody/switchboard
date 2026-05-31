/**
 * Drag-to-reorder support for session columns in the Kanban (THI-115 item 1).
 *
 * The user-defined order is persisted to localStorage under
 * `switchboard:sessionOrder` as a JSON `string[]` of session names. The order
 * is treated as a "pin list" rather than the full source of truth:
 *
 *   - sessions named in saved order render first, in saved order
 *   - any other sessions render after, in their natural (server-supplied) order
 *
 * That way the user only owns the explicit movements they made; a newly-spawned
 * tmux session shows up at the end automatically and a killed session drops
 * silently (no orphan slot left behind).
 *
 * Multi-tab caveat: writes are read-modify-write with no `storage` event
 * listener, so two open dashboard tabs have last-writer-wins semantics on the
 * order. Acceptable for a personal tool — same trade as `recents.ts`.
 */

import type { Session } from "../types";

const STORAGE_KEY = "switchboard:sessionOrder";

export function loadSessionOrder(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that isn't a string — keeps a corrupt write from breaking
    // every subsequent render. Same lenient-parse pattern as readRecents.
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function saveSessionOrder(order: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* storage unavailable — don't blow up the caller */
  }
}

/**
 * Move `src` to immediately before (or after) `dst` in `all`. Returns a new
 * array; never mutates. No-ops when either id is missing or src === dst, so
 * accidental drops onto the same column don't churn the saved order.
 */
export function reorderSessions(
  all: string[],
  src: string,
  dst: string,
  before: boolean,
): string[] {
  if (src === dst) return all;
  const srcIdx = all.indexOf(src);
  const dstIdx = all.indexOf(dst);
  if (srcIdx < 0 || dstIdx < 0) return all;

  const without = all.filter((x) => x !== src);
  // After removing src, dst's index in `without` may have shifted down by one
  // if src appeared before dst in the original list.
  const dstInWithout = without.indexOf(dst);
  const insertAt = before ? dstInWithout : dstInWithout + 1;
  return [...without.slice(0, insertAt), src, ...without.slice(insertAt)];
}

/**
 * Apply a saved pin list to the natural session list. Saved entries that
 * match a current session float to the top in saved order; everything else
 * keeps its natural index.
 *
 * Returns the input `sessions` array reference unchanged when the order is a
 * no-op (empty pin list, or pin list matches the head of `sessions`) so
 * `useMemo` consumers can avoid spurious re-renders.
 */
export function applySessionOrder(sessions: Session[], saved: string[]): Session[] {
  if (saved.length === 0) return sessions;

  // Index by id so we can pull each saved entry in O(1) and skip the rest.
  const byId = new Map<string, Session>();
  for (const s of sessions) byId.set(s.id, s);

  const pinned: Session[] = [];
  const pinnedIds = new Set<string>();
  for (const id of saved) {
    const s = byId.get(id);
    if (!s || pinnedIds.has(id)) continue;
    pinned.push(s);
    pinnedIds.add(id);
  }
  const rest = sessions.filter((s) => !pinnedIds.has(s.id));

  // If the pin list happened to be a no-op (e.g. all saved ids are absent),
  // return the original reference so downstream `useMemo` is stable.
  if (pinned.length === 0) return sessions;
  return [...pinned, ...rest];
}
