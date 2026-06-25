import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires fn on mount and again every ms", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    renderHook(() => usePolling(fn, 1000));
    // initial fire happens synchronously inside the effect
    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await tick(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("tears down the slow interval and applies the new rate when ms changes (THI-105)", async () => {
    // Opening the terminal modal hands a fast interval to usePolling; closing
    // it hands the slow one back. The hook must re-key its interval — otherwise
    // the modal header / status pill would still refresh at the slow cadence.
    const fn = vi.fn().mockResolvedValue("ok");
    const { rerender } = renderHook(({ ms }: { ms: number }) => usePolling(fn, ms), {
      initialProps: { ms: 3000 },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    // No more calls within the slow interval...
    await tick(500);
    expect(fn).toHaveBeenCalledTimes(1);
    // ...until we drop to a fast interval; the initial fire happens again on
    // re-mount of the effect, then every 100 ms.
    rerender({ ms: 100 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(2);
    await tick(100);
    expect(fn).toHaveBeenCalledTimes(3);
    await tick(100);
    expect(fn).toHaveBeenCalledTimes(4);
    // Back to slow — no firing within the new fast interval.
    rerender({ ms: 3000 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(5); // re-mount fires once
    await tick(500);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("skips ticks when the document is hidden", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    renderHook(() => usePolling(fn, 1000));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    // Hide the document; the interval still fires but the tick should bail.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await tick(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    // Reset for other tests.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("keeps polling while hidden when pollWhenHidden=true (THI-78)", async () => {
    // Notifications-on path: skipping ticks while the tab is backgrounded is
    // exactly when the user *needs* the data to update — otherwise no
    // pendingInput edge is ever detected and no OS notification fires.
    const fn = vi.fn().mockResolvedValue("ok");
    renderHook(() => usePolling(fn, 1000, true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await tick(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await tick(1000);
    expect(fn).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  // --- adaptive back-off: `degraded` reflects slow / outpaced backend ---

  it("flags the backend degraded when response latency is high", async () => {
    // fn resolves after 900 ms of (fake) time; the interval (2 s) is longer so
    // the fetch completes and its latency is measured.
    const slowFn = () =>
      new Promise<string>((res) => {
        window.setTimeout(() => res("ok"), 900);
      });
    const { result } = renderHook(() => usePolling(slowFn, 2000));
    await tick(900);
    expect(result.current.degraded).toBe(true);
  });

  it("stays not degraded when responses are fast", async () => {
    const fastFn = () =>
      new Promise<string>((res) => {
        window.setTimeout(() => res("ok"), 20);
      });
    const { result } = renderHook(() => usePolling(fastFn, 1000));
    await tick(20);
    await tick(1000);
    await tick(20);
    expect(result.current.degraded).toBe(false);
  });

  it("flags degraded when polls are repeatedly superseded (backend outpaced)", async () => {
    // fn never resolves on its own; it rejects AbortError when its signal
    // fires — i.e. when the next tick aborts it before it completed.
    const fn = vi.fn((signal: AbortSignal) => {
      return new Promise<string>((_res, rej) => {
        signal.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const { result } = renderHook(() => usePolling(fn, 100));
    await act(async () => {
      await Promise.resolve();
    });
    await tick(100); // tick 2 aborts tick 1's fetch → supersede #1
    await tick(100); // tick 3 aborts tick 2's fetch → supersede #2 → degraded
    expect(result.current.degraded).toBe(true);
  });
});
