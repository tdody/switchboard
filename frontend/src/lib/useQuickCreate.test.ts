import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuickCreate } from "./useQuickCreate";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.cookie = "sb_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

const createCallCount = (
  mock: { mock: { calls: unknown[][] } },
): number =>
  mock.mock.calls.filter(([url]) => String(url).startsWith("/api/window")).length;

describe("useQuickCreate — rapid-click guard (THI-115)", () => {
  it("ignores a second invocation that races the first synchronously", async () => {
    // Slow fetch — first call's createWindow stays pending while the second
    // invocation arrives. Without the ref-based guard, both handlers race
    // past the in-flight check (state-based `quickCreating` only updates
    // after React commits) and both issue a createWindow POST.
    document.cookie = "sb_csrf=tok-1";
    let resolveFetch: (r: Response) => void = () => {};
    const slow = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => slow);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useQuickCreate(() => {}));

    const firstCall = result.current.handleQuickCreate("main", "claude");
    void result.current.handleQuickCreate("main", "claude");

    expect(createCallCount(fetchMock)).toBe(1);

    resolveFetch({
      ok: true,
      json: async () => ({ index: 1, id: "main:1" }),
    } as Response);
    // Drain microtasks for the fetch → json → createWindowWithBoot chain,
    // then advance past MIN_LOCK_MS so the cooldown clears the in-flight
    // ref and a fresh invocation is allowed through.
    await vi.advanceTimersByTimeAsync(500);
    await firstCall;

    void result.current.handleQuickCreate("main", "shell");
    expect(createCallCount(fetchMock)).toBe(2);
  });

  it("holds the lock past a fast fetch so a delayed second click is still blocked", async () => {
    // The fetch resolves in single-digit ms on localhost — faster than the
    // OS double-click interval. Without the cooldown, the in-flight ref
    // clears before the second click of a real-world double-click arrives,
    // and a duplicate window slips through. This test pins that behavior:
    // a click arriving after fetch resolution but inside the MIN_LOCK_MS
    // window must be ignored.
    document.cookie = "sb_csrf=tok-2";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ index: 1, id: "main:1" }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useQuickCreate(() => {}));

    void result.current.handleQuickCreate("main", "claude");
    // Drain a tick — enough for the fast mock fetch + json chain to resolve
    // and for the handler to enter its cooldown await. The lock should
    // still be held (cooldown is 500 ms, we've only burned a fraction).
    await vi.advanceTimersByTimeAsync(50);
    void result.current.handleQuickCreate("main", "claude");
    expect(createCallCount(fetchMock)).toBe(1);

    // Advance past the remaining cooldown — the lock clears and a fresh
    // click is allowed through.
    await vi.advanceTimersByTimeAsync(500);
    void result.current.handleQuickCreate("main", "shell");
    expect(createCallCount(fetchMock)).toBe(2);
  });

  it("does not block a second invocation against a different session", () => {
    // The guard is keyed per-session — two sessions can each have their own
    // create in flight concurrently.
    document.cookie = "sb_csrf=tok-3";
    const slow = new Promise<Response>(() => {}); // never resolves
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => slow);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useQuickCreate(() => {}));

    void result.current.handleQuickCreate("main", "claude");
    void result.current.handleQuickCreate("dev", "claude");

    expect(createCallCount(fetchMock)).toBe(2);
  });
});
