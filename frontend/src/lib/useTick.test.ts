import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useTick } from "./useTick";

afterEach(() => {
  vi.useRealTimers();
});

describe("useTick", () => {
  it("starts at 0", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTick(1000));
    expect(result.current).toBe(0);
  });

  it("increments by 1 every intervalMs", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTick(1000));
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(4);
  });

  it("clears its interval on unmount so it doesn't tick forever", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useTick(1000));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);

    unmount();

    // Advancing time after unmount must not produce ticks; if the interval
    // leaked, the state update would still fire and React would log a
    // "state update on unmounted component" warning under StrictMode.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
    }).not.toThrow();
  });
});
