import type { Window } from "../types";

/** Group a flat list of windows by session id (THI-219). The result preserves
 *  first-seen order within each bucket so callers can still rely on tmux's
 *  window-index sequence before any per-view sort.
 *
 *  Used by App.tsx once per `/api/state` poll; Kanban + GridView read the
 *  per-session bucket directly instead of re-running `windows.filter(...)`
 *  inside every `sessions.map(...)` body. With S sessions and N visible
 *  windows that drops S × O(N) filter passes to one O(N) walk. */
export function groupBySession(
  windows: readonly Window[],
): ReadonlyMap<string, Window[]> {
  const out = new Map<string, Window[]>();
  for (const w of windows) {
    const bucket = out.get(w.session);
    if (bucket) bucket.push(w);
    else out.set(w.session, [w]);
  }
  return out;
}
