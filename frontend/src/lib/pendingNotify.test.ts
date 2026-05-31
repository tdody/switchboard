import { describe, expect, it } from "vitest";
import { mkWindow } from "../test/factories";
import {
  detectPendingEdges,
  emptyNotifyState,
  hydrateNotifyState,
  markJustEnabled,
  NOTIFY_DEDUP_MS,
  type NotifyState,
} from "./pendingNotify";

const NOW = 1_750_000_000_000;

describe("detectPendingEdges", () => {
  it("first hydration captures pending set but emits NO edges", () => {
    // Reload-the-page case: there are already-pending panes on the very
    // first non-empty state. They were pending before the user could care;
    // we must not fire a barrage on every fresh tab.
    const windows = [
      mkWindow({ paneId: "%1", pendingInput: true }),
      mkWindow({ paneId: "%2", pendingInput: false }),
    ];
    const { edges, state } = detectPendingEdges(windows, emptyNotifyState(), NOW);
    expect(edges).toEqual([]);
    expect(state.hydrated).toBe(true);
    expect(state.lastPendingIds).toEqual(new Set(["%1"]));
  });

  it("emits an edge for a pane that flips false → true after hydration", () => {
    const hydrated: NotifyState = {
      lastPendingIds: new Set(),
      lastNotifiedAt: new Map(),
      hydrated: true,
    };
    const windows = [
      mkWindow({
        paneId: "%5",
        session: "dev",
        index: 3,
        name: "claude",
        pendingInput: true,
        agent: {
          branch: null,
          spinner: null,
          duration: null,
          recap: null,
          action: "Do you want to proceed?",
        },
      }),
    ];
    const { edges, state } = detectPendingEdges(windows, hydrated, NOW);
    expect(edges).toEqual([
      {
        paneId: "%5",
        session: "dev",
        index: 3,
        windowName: "claude",
        action: "Do you want to proceed?",
      },
    ]);
    expect(state.lastNotifiedAt.get("%5")).toBe(NOW);
  });

  it("falls back to 'waiting on input' when agent.action is missing", () => {
    // The notification BODY string is built in App.tsx, but the edge object
    // surfaces `action: null` here so the caller can do its own fallback.
    // Pinning this so a future Agent shape change can't quietly turn the
    // fallback into "null" or "undefined" on screen.
    const hydrated: NotifyState = {
      lastPendingIds: new Set(),
      lastNotifiedAt: new Map(),
      hydrated: true,
    };
    const windows = [mkWindow({ paneId: "%6", pendingInput: true })];
    const { edges } = detectPendingEdges(windows, hydrated, NOW);
    expect(edges[0].action).toBeNull();
  });

  it("does NOT emit for a pane that was pending last tick", () => {
    // Steady-state pending across two polls = one notification, not two.
    const prev: NotifyState = {
      lastPendingIds: new Set(["%1"]),
      lastNotifiedAt: new Map([["%1", NOW - 5000]]),
      hydrated: true,
    };
    const windows = [mkWindow({ paneId: "%1", pendingInput: true })];
    const { edges } = detectPendingEdges(windows, prev, NOW);
    expect(edges).toEqual([]);
  });

  it("suppresses re-fire within the dedup window when a pane flickers off→on", () => {
    // pendingInput briefly cleared between two polls (parser race), then
    // re-asserted. This is one prompt, not two — dedup must hold.
    const prev: NotifyState = {
      lastPendingIds: new Set(), // ← key: not pending on the immediately prior tick
      lastNotifiedAt: new Map([["%1", NOW - 5000]]), // notified 5 s ago
      hydrated: true,
    };
    const windows = [mkWindow({ paneId: "%1", pendingInput: true })];
    const { edges } = detectPendingEdges(windows, prev, NOW);
    expect(edges).toEqual([]);
  });

  it("re-fires for the same pane after the dedup window expires", () => {
    // A genuinely separate prompt several minutes later should notify again.
    const prev: NotifyState = {
      lastPendingIds: new Set(),
      lastNotifiedAt: new Map([["%1", NOW - NOTIFY_DEDUP_MS - 1000]]),
      hydrated: true,
    };
    const windows = [mkWindow({ paneId: "%1", pendingInput: true })];
    const { edges } = detectPendingEdges(windows, prev, NOW);
    expect(edges.map((e) => e.paneId)).toEqual(["%1"]);
  });

  it("emits multiple edges in a single tick when several panes flip at once", () => {
    // Wake-up scenario: tab was backgrounded, several agents reached prompts
    // while the JS loop was throttled. First foreground tick should fire all
    // of them (subject to dedup).
    const prev: NotifyState = {
      lastPendingIds: new Set(),
      lastNotifiedAt: new Map(),
      hydrated: true,
    };
    const windows = [
      mkWindow({ paneId: "%a", pendingInput: true }),
      mkWindow({ paneId: "%b", pendingInput: true }),
      mkWindow({ paneId: "%c", pendingInput: false }),
    ];
    const { edges } = detectPendingEdges(windows, prev, NOW);
    expect(edges.map((e) => e.paneId).sort()).toEqual(["%a", "%b"]);
  });

  it("garbage-collects lastNotifiedAt entries for closed, long-gone panes", () => {
    // A pane that was notified long ago and is no longer present in the
    // windows[] should be evicted from lastNotifiedAt — otherwise the map
    // grows unbounded across a long session of spawn/kill cycles.
    const prev: NotifyState = {
      lastPendingIds: new Set(),
      lastNotifiedAt: new Map([
        ["%old", NOW - 5 * NOTIFY_DEDUP_MS],
        ["%recent", NOW - 1000],
      ]),
      hydrated: true,
    };
    const { state } = detectPendingEdges([], prev, NOW);
    expect(state.lastNotifiedAt.has("%old")).toBe(false);
    // Recent entries stick around — they may still gate a re-fire.
    expect(state.lastNotifiedAt.has("%recent")).toBe(true);
  });

  it("keeps recent entries even when their pane is gone (dedup honoring closed panes)", () => {
    // A pane killed seconds after notifying must NOT be GC'd immediately:
    // if a new pane somehow reuses %N before NOTIFY_DEDUP_MS, dedup should
    // still apply. The GC threshold is 2 × DEDUP — well past the dedup
    // window itself.
    const prev: NotifyState = {
      lastPendingIds: new Set(),
      lastNotifiedAt: new Map([["%just-killed", NOW - 5000]]),
      hydrated: true,
    };
    const { state } = detectPendingEdges([], prev, NOW);
    expect(state.lastNotifiedAt.has("%just-killed")).toBe(true);
  });
});

describe("markJustEnabled", () => {
  it("clears lastPendingIds so currently-pending panes become edges next tick", () => {
    // The pure-module half of the "user toggled notifications ON mid-session"
    // fix: by emptying lastPendingIds, the next detectPendingEdges call sees
    // every currently-pending paneId as a rising edge — exactly what the user
    // wants to know when they opt in.
    const prev: NotifyState = {
      lastPendingIds: new Set(["%1", "%2"]),
      lastNotifiedAt: new Map(),
      hydrated: true,
    };
    const next = markJustEnabled(prev);
    expect(next.lastPendingIds.size).toBe(0);
  });

  it("preserves lastNotifiedAt so the dedup window still blocks rapid re-fires", () => {
    // If the user toggles off → on within the dedup window (e.g. testing the
    // toggle a few times), we must not spam them with re-notifications for the
    // same prompt. lastNotifiedAt is the gate that prevents that.
    const prev: NotifyState = {
      lastPendingIds: new Set(["%1"]),
      lastNotifiedAt: new Map([["%1", NOW - 5000]]),
      hydrated: true,
    };
    const next = markJustEnabled(prev);
    expect(next.lastNotifiedAt.get("%1")).toBe(NOW - 5000);
  });

  it("preserves hydrated flag (caller decides whether to call this)", () => {
    // Caller (App.tsx) only invokes markJustEnabled when hydrated is already
    // true — the !hydrated case is the initial-page-load reload-protection
    // path, which must NOT fire for already-pending panes. We don't enforce
    // that here; we just don't lie about hydration state.
    expect(markJustEnabled(emptyNotifyState()).hydrated).toBe(false);
    const hydrated: NotifyState = {
      lastPendingIds: new Set(["%1"]),
      lastNotifiedAt: new Map(),
      hydrated: true,
    };
    expect(markJustEnabled(hydrated).hydrated).toBe(true);
  });

  it("integrates: detectPendingEdges after markJustEnabled emits currently-pending as edges", () => {
    // End-to-end of the off→on flow: pane was pending and tracked (no edge in
    // the disabled tick), user enables notifications, next tick fires.
    const prev: NotifyState = {
      lastPendingIds: new Set(["%1"]),
      lastNotifiedAt: new Map(),
      hydrated: true,
    };
    const justEnabled = markJustEnabled(prev);
    const windows = [mkWindow({ paneId: "%1", pendingInput: true })];
    const { edges } = detectPendingEdges(windows, justEnabled, NOW);
    expect(edges.map((e) => e.paneId)).toEqual(["%1"]);
  });

  it("integrates: dedup window still blocks a re-fire after markJustEnabled", () => {
    // User notified at NOW-5s, toggled off, toggled back on. Same pane is
    // still pending. markJustEnabled would normally make it an edge — but
    // lastNotifiedAt still gates it, so no second notification.
    const prev: NotifyState = {
      lastPendingIds: new Set(["%1"]),
      lastNotifiedAt: new Map([["%1", NOW - 5000]]),
      hydrated: true,
    };
    const justEnabled = markJustEnabled(prev);
    const windows = [mkWindow({ paneId: "%1", pendingInput: true })];
    const { edges } = detectPendingEdges(windows, justEnabled, NOW);
    expect(edges).toEqual([]);
  });
});

describe("hydrateNotifyState", () => {
  it("captures currently-pending paneIds and marks state hydrated", () => {
    const windows = [
      mkWindow({ paneId: "%1", pendingInput: true }),
      mkWindow({ paneId: "%2", pendingInput: false }),
      mkWindow({ paneId: "%3", pendingInput: true }),
    ];
    const next = hydrateNotifyState(windows, emptyNotifyState());
    expect(next.lastPendingIds).toEqual(new Set(["%1", "%3"]));
    expect(next.hydrated).toBe(true);
  });

  it("does NOT touch lastNotifiedAt — preserves the dedup map as-is", () => {
    // The whole point of this helper vs detectPendingEdges: keeping state
    // warm while notifications are off must not record fake "notifications"
    // that would later block a real edge under the dedup window.
    const prev: NotifyState = {
      lastPendingIds: new Set(),
      lastNotifiedAt: new Map([
        ["%1", NOW - 5000],
        ["%2", NOW - 10_000],
      ]),
      hydrated: true,
    };
    const windows = [mkWindow({ paneId: "%new", pendingInput: true })];
    const next = hydrateNotifyState(windows, prev);
    expect(next.lastNotifiedAt.get("%1")).toBe(NOW - 5000);
    expect(next.lastNotifiedAt.get("%2")).toBe(NOW - 10_000);
    expect(next.lastNotifiedAt.has("%new")).toBe(false); // ← no fake notify
  });

  it("integrates: a pane that went pending while disabled fires an edge on re-enable", () => {
    // This is the regression-test for the App.tsx wiring fix. Sequence:
    //   t=0: notifications OFF. Pane %1 not pending. State hydrated empty.
    //   t=1: pane %1 goes pending. App calls hydrateNotifyState (still OFF).
    //   t=2: user toggles ON. App calls markJustEnabled, then detectPendingEdges.
    //        %1 must be an edge, and lastNotifiedAt[%1] must NOT have been
    //        polluted by the t=1 hydrate (otherwise dedup would silently
    //        block the notification the user actually wanted).
    let state = hydrateNotifyState([], emptyNotifyState()); // t=0
    state = hydrateNotifyState([mkWindow({ paneId: "%1", pendingInput: true })], state); // t=1
    state = markJustEnabled(state); // user toggles ON
    const { edges } = detectPendingEdges(
      [mkWindow({ paneId: "%1", pendingInput: true })],
      state,
      NOW,
    );
    expect(edges.map((e) => e.paneId)).toEqual(["%1"]);
  });
});
