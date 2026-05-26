/**
 * Drag-to-reorder support for tiles within a session column (THI-141).
 *
 * Parallel to `sessionOrder.ts` but keyed per session: each column owns
 * its own pin list of paneIds. localStorage shape:
 *
 *   switchboard:windowOrder => { "<sessionId>": ["%12", "%7", ...] }
 *
 * Treated as a pin list (not the source of truth):
 *
 *   - panes named in the saved order render first, in saved order;
 *   - any other panes fall through to the natural sort (tmux index).
 *
 * That way the user only owns the explicit moves they made; new panes
 * appear at the end of their bucket automatically, and killed panes
 * drop silently (no orphan slot left behind).
 *
 * Multi-tab caveat: writes are read-modify-write with no `storage` event
 * listener, so two open dashboard tabs have last-writer-wins semantics on
 * the order. Acceptable for a personal tool — same trade as `recents.ts`
 * and `sessionOrder.ts`.
 */

const STORAGE_KEY = "switchboard:windowOrder";

export type WindowOrderMap = Record<string, string[]>;

function isWindowOrderMap(value: unknown): value is WindowOrderMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  for (const [key, arr] of Object.entries(value)) {
    if (typeof key !== "string") return false;
    if (!Array.isArray(arr)) return false;
    if (!arr.every((x) => typeof x === "string")) return false;
  }
  return true;
}

export function loadWindowOrder(): WindowOrderMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isWindowOrderMap(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveWindowOrder(order: WindowOrderMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* storage unavailable (private mode / SSR) — keep in-memory value */
  }
}

/**
 * Move `src` immediately before (or after) `dst` within the pin list for
 * `sessionId`. Returns a new map; never mutates the input.
 *
 * The function treats the saved list as a pin list, so a `src` not yet in
 * the list gets added at the requested position (creating a pin slot for
 * it). Same for `dst` — if neither id is in the saved list yet, the result
 * is a fresh `[src, dst]` (or `[dst, src]`) pair, which is the user's
 * first explicit positioning of those two panes.
 *
 * No-ops on `src === dst` so a drag-and-release-on-self doesn't churn
 * storage.
 */
export function reorderWindow(
  current: WindowOrderMap,
  sessionId: string,
  src: string,
  dst: string,
  before: boolean,
): WindowOrderMap {
  if (src === dst) return current;

  const existing = current[sessionId] ?? [];
  // Remove src if present; we'll re-insert at the chosen position.
  const without = existing.filter((id) => id !== src);
  let dstIdx = without.indexOf(dst);
  if (dstIdx < 0) {
    // dst hadn't been pinned yet. Add it at the end first, then we'll
    // insert src relative to it. End-position is the natural default for
    // an unpinned pane (matches `sortPendingFirst` fallback).
    without.push(dst);
    dstIdx = without.length - 1;
  }
  const insertAt = before ? dstIdx : dstIdx + 1;
  const next = [...without.slice(0, insertAt), src, ...without.slice(insertAt)];

  return { ...current, [sessionId]: next };
}
