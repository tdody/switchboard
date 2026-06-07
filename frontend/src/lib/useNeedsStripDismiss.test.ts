import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { Window } from "../types";
import { useNeedsStripDismiss } from "./useNeedsStripDismiss";

const STORAGE_KEY = "switchboard:needsStrip:dismissed";

function pendingWindow(paneId: string): Window {
  return {
    id: `main:${paneId}`,
    paneId,
    session: "main",
    index: 0,
    name: paneId,
    kind: "agent",
    status: "waiting",
    lastActivity: 0,
    cpu: 0,
    mem: 0,
    cmd: "claude",
    cwd: "",
    pendingInput: true,
    branch: null,
    pr: null,
    prUrl: null,
    ci: null,
    repoUrl: null,
    repoKey: null,
    repoLabel: null,
    agent: null,
    preview: [],
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
});

describe("useNeedsStripDismiss", () => {
  it("starts with nothing dismissed: every pending window is visible", () => {
    const { result } = renderHook(() =>
      useNeedsStripDismiss([pendingWindow("%1"), pendingWindow("%2")]),
    );
    expect(result.current.visibleWindows.map((w) => w.paneId)).toEqual([
      "%1",
      "%2",
    ]);
  });

  it("dismiss() hides every currently-pending pane until a new one arrives", () => {
    const initial = [pendingWindow("%1"), pendingWindow("%2")];
    const { result, rerender } = renderHook(
      ({ pending }: { pending: Window[] }) => useNeedsStripDismiss(pending),
      { initialProps: { pending: initial } },
    );

    act(() => result.current.dismiss());
    expect(result.current.visibleWindows).toEqual([]);

    // Same panes still pending → still hidden.
    rerender({ pending: initial });
    expect(result.current.visibleWindows).toEqual([]);

    // A new pane (%3) becomes pending → visible.
    rerender({
      pending: [pendingWindow("%1"), pendingWindow("%2"), pendingWindow("%3")],
    });
    expect(result.current.visibleWindows.map((w) => w.paneId)).toEqual(["%3"]);
  });

  it("re-shows a pane that previously resolved and then became pending again", () => {
    // User dismisses {%1}. %1 resolves (no longer pending). %1 then becomes
    // pending again — the dismissed set must have GC'd it so the user is
    // notified about the new event.
    const { result, rerender } = renderHook(
      ({ pending }: { pending: Window[] }) => useNeedsStripDismiss(pending),
      { initialProps: { pending: [pendingWindow("%1")] } },
    );
    act(() => result.current.dismiss());
    expect(result.current.visibleWindows).toEqual([]);

    rerender({ pending: [] });
    rerender({ pending: [pendingWindow("%1")] });
    expect(result.current.visibleWindows.map((w) => w.paneId)).toEqual(["%1"]);
  });

  it("persists the dismissed set across remounts via sessionStorage", () => {
    const pending = [pendingWindow("%1"), pendingWindow("%2")];
    const first = renderHook(() => useNeedsStripDismiss(pending));
    act(() => first.result.current.dismiss());
    first.unmount();

    const stored = sessionStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).sort()).toEqual(["%1", "%2"]);

    // New mount with the same pending set should pick the dismissal back up.
    const second = renderHook(() => useNeedsStripDismiss(pending));
    expect(second.result.current.visibleWindows).toEqual([]);
  });

  it("tolerates a missing / corrupt sessionStorage entry", () => {
    sessionStorage.setItem(STORAGE_KEY, "not-valid-json}");
    const { result } = renderHook(() =>
      useNeedsStripDismiss([pendingWindow("%1")]),
    );
    // Falls back to empty dismissed set; pending stays visible.
    expect(result.current.visibleWindows.map((w) => w.paneId)).toEqual(["%1"]);
  });
});
