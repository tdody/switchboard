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
});
