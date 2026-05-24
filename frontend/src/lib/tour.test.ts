import { beforeEach, describe, expect, it } from "vitest";

import { isTourDismissed, markTourDismissed, resetTour } from "./tour";

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
});
