/**
 * Edge detector for `pendingInput` → fires browser notifications (THI-78).
 *
 * Kept as a pure module so the dedup / hydration logic can be unit-tested
 * without a DOM. Callers (App.tsx) thread `NotifyState` through a ref across
 * polls and dispatch notifications themselves — this module only decides
 * WHICH paneIds just transitioned to pending.
 */

import type { Window } from "../types";

/** Per-tick state — opaque to callers; thread the returned value back in. */
export interface NotifyState {
  /** paneIds last seen as pending. An edge is a paneId pending NOW but not
   *  on the previous tick (and not within the dedup window). */
  lastPendingIds: ReadonlySet<string>;
  /** paneId → epoch ms of the last notification we emitted. Used to suppress
   *  rapid re-fires when `pendingInput` oscillates inside a single agent
   *  turn (the parser briefly clears the flag, then reasserts it). */
  lastNotifiedAt: ReadonlyMap<string, number>;
  /** False until the first non-empty windows[] is seen. The first hydration
   *  must NOT fire notifications for already-pending panes — the user just
   *  reloaded the page; everything they see was pending before they could
   *  care about it. */
  hydrated: boolean;
}

/** One paneId that just flipped to pending, plus the metadata App needs to
 *  build the notification body and click handler. */
export interface PendingEdge {
  paneId: string;
  session: string;
  index: number;
  windowName: string;
  action: string | null;
}

/** Initial state — pass on first call, then keep threading the return value. */
export function emptyNotifyState(): NotifyState {
  return { lastPendingIds: new Set(), lastNotifiedAt: new Map(), hydrated: false };
}

/** Call on the off→on transition of the notification toggle so the next
 *  detectPendingEdges call treats every currently-pending pane as a rising
 *  edge. Without this, a user enabling notifications while a prompt is
 *  already pending would get nothing until the prompt cleared and re-fired.
 *
 *  Clears `lastPendingIds` (currently-pending → edges) but preserves
 *  `lastNotifiedAt` so the dedup window still suppresses rapid re-fires
 *  (e.g. user flips off→on inside 30 s on the same prompt). `hydrated`
 *  is passed through verbatim — callers should only invoke this when
 *  already hydrated; the !hydrated path is reload protection. */
export function markJustEnabled(state: NotifyState): NotifyState {
  return {
    lastPendingIds: new Set(),
    lastNotifiedAt: state.lastNotifiedAt,
    hydrated: state.hydrated,
  };
}

/** Refresh `lastPendingIds` / `hydrated` from current windows WITHOUT
 *  emitting edges or touching `lastNotifiedAt`. Used by callers that want to
 *  keep state warm while the notification toggle is off, so a future
 *  off→on transition has accurate baseline state to diff against — without
 *  poisoning the dedup map with panes that never actually got a notification
 *  (which would silently block the off→on edge for those panes). */
export function hydrateNotifyState(windows: Window[], prev: NotifyState): NotifyState {
  const currentPending = new Set<string>();
  for (const w of windows) if (w.pendingInput) currentPending.add(w.paneId);
  return {
    lastPendingIds: currentPending,
    lastNotifiedAt: prev.lastNotifiedAt,
    hydrated: true,
  };
}

/** Dedup window: ignore re-fires for the same paneId within this many ms.
 *  Polling tier ranges 1–8 s (lib/pollTier), so 30 s comfortably covers a few
 *  ticks of `pendingInput` flicker without suppressing genuinely separate
 *  prompts (which arrive turns apart, not seconds). */
export const NOTIFY_DEDUP_MS = 30_000;

/** Pure edge detector. Given the new windows[] and the prior state, returns
 *  the edges to notify plus the next-tick state. No DOM, no side effects.
 */
export function detectPendingEdges(
  windows: Window[],
  prev: NotifyState,
  now: number,
): { edges: PendingEdge[]; state: NotifyState } {
  const currentPending = new Set<string>();
  const edges: PendingEdge[] = [];
  const nextNotifiedAt = new Map(prev.lastNotifiedAt);

  for (const w of windows) {
    if (!w.pendingInput) continue;
    currentPending.add(w.paneId);

    // First hydration: capture the set but don't emit. The user reloaded the
    // page; anything pending right now isn't news.
    if (!prev.hydrated) continue;

    // Not an edge — pane was already pending last tick. (Stays in the
    // currentPending set above so the next tick's edge detector still has
    // the correct baseline.)
    if (prev.lastPendingIds.has(w.paneId)) continue;

    // Edge — but was it recently notified? A pane that oscillates within
    // NOTIFY_DEDUP_MS (e.g. parser flickers pendingInput off→on across two
    // polls of the same prompt) shouldn't re-fire.
    const lastAt = prev.lastNotifiedAt.get(w.paneId);
    if (lastAt !== undefined && now - lastAt < NOTIFY_DEDUP_MS) continue;

    nextNotifiedAt.set(w.paneId, now);
    edges.push({
      paneId: w.paneId,
      session: w.session,
      index: w.index,
      windowName: w.name,
      action: w.agent?.action ?? null,
    });
  }

  // Garbage-collect lastNotifiedAt: anything older than 2 × DEDUP_MS and not
  // currently pending is safe to forget. Prevents unbounded growth as panes
  // come and go over a long session.
  const expiry = now - 2 * NOTIFY_DEDUP_MS;
  for (const [paneId, at] of nextNotifiedAt) {
    if (at < expiry && !currentPending.has(paneId)) {
      nextNotifiedAt.delete(paneId);
    }
  }

  return {
    edges,
    state: {
      lastPendingIds: currentPending,
      lastNotifiedAt: nextNotifiedAt,
      hydrated: true,
    },
  };
}
