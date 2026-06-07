import type { Window } from "../types";

const DAY_MS = 86_400_000;

/** Filter `windows` to those idle past `thresholdDays`, oldest first.
 *  Threshold `0` returns no candidates (cleanup action is hidden in that case). */
export function computeCandidates(
  windows: readonly Window[],
  pollNow: number,
  thresholdDays: number,
): Window[] {
  if (thresholdDays <= 0) return [];
  const limit = pollNow - thresholdDays * DAY_MS;
  return windows
    .filter(
      // lastActivity === 0 means tmux has not reported activity for this
      // window yet (startup races, brand-new windows). Skip those rather
      // than treat them as "ancient".
      (w) => w.lastActivity !== 0 && w.lastActivity < limit,
    )
    .sort((a, b) => a.lastActivity - b.lastActivity);
}

/** Mid-turn agent windows are auto-unchecked in the candidate list. The user
 *  can still opt in by checking the box manually. */
export function isMidTurn(w: Window): boolean {
  if (w.kind !== "agent") return false;
  return w.status === "running" || w.status === "waiting" || w.pendingInput;
}

/** Initial checkbox state for a candidate row. Default is checked; pinned and
 *  mid-turn windows are unchecked. */
export function defaultChecked(w: Window, pinnedIds: ReadonlySet<string>): boolean {
  if (pinnedIds.has(w.paneId)) return false;
  if (isMidTurn(w)) return false;
  return true;
}

/** Session names where the entire selection covers every window in the session.
 *  Used in the Confirm step to warn the user that killing those wipes the
 *  session too (tmux's natural cascade). */
export function lastWindowSessions(
  selection: readonly Window[],
  allWindows: readonly Window[],
): string[] {
  const totalsBySession = new Map<string, number>();
  for (const w of allWindows) {
    totalsBySession.set(w.session, (totalsBySession.get(w.session) ?? 0) + 1);
  }
  const selectedBySession = new Map<string, number>();
  for (const w of selection) {
    selectedBySession.set(w.session, (selectedBySession.get(w.session) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [session, total] of totalsBySession) {
    if ((selectedBySession.get(session) ?? 0) === total) {
      out.push(session);
    }
  }
  // Stable order: alphabetic by session name so the hint reads predictably.
  out.sort();
  return out;
}
