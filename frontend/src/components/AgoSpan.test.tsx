import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { AgoSpan } from "./AgoSpan";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgoSpan", () => {
  it("renders the current `formatAgo(ts)` value", () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(now);

    const { container } = render(<AgoSpan ts={now - 10_000} />);
    expect(container.textContent).toBe("10s");
  });

  it("ticks the displayed text every second without remounting", () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(now);

    const { container } = render(<AgoSpan ts={now - 10_000} />);
    expect(container.textContent).toBe("10s");

    // advanceTimersByTime both advances the fake Date.now() AND fires the
    // useTick interval — so formatAgo sees the new clock on the next render.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(container.textContent).toBe("15s");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toBe("1m");
  });

  it("returns the em-dash placeholder when ts is 0 (falsy lastActivity)", () => {
    const { container } = render(<AgoSpan ts={0} />);
    expect(container.textContent).toBe("—");
  });
});
