import { beforeEach, describe, expect, it, vi } from "vitest";

import { isTourDismissed, markTourDismissed, replayTour, resetTour } from "./tour";

beforeEach(() => {
  localStorage.clear();
});

describe("tour storage", () => {
  it("returns false initially when nothing has been written", () => {
    expect(isTourDismissed()).toBe(false);
  });

  it("returns true after markTourDismissed", () => {
    markTourDismissed();
    expect(isTourDismissed()).toBe(true);
  });

  it("returns false again after resetTour", () => {
    markTourDismissed();
    expect(isTourDismissed()).toBe(true);
    resetTour();
    expect(isTourDismissed()).toBe(false);
  });

  it("tolerates any non-`1` value as not-dismissed", () => {
    // Strict equality on "1" — defends against a future schema bump where
    // someone writes a different sentinel. The user re-sees the tour rather
    // than the code crashing.
    localStorage.setItem("switchboard:tour:v1:dismissed", "true");
    expect(isTourDismissed()).toBe(false);
  });

  it("replayTour clears the dismissed flag AND triggers a reload", () => {
    // `Tour` reads `isTourDismissed()` once at mount, so just clearing the
    // flag without reloading would leave the dismissed-at-mount component
    // stuck hidden. `replayTour` exists to fold the two steps into one
    // user-visible action — verify both halves fire.
    markTourDismissed();
    const reload = vi.fn();
    // happy-dom's `location.reload` is non-writable; replace through the
    // descriptor so the spy lands.
    Object.defineProperty(window.location, "reload", { value: reload, configurable: true });

    replayTour();

    expect(isTourDismissed()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
