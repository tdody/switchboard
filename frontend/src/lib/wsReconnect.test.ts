import { describe, expect, it } from "vitest";
import { BACKOFF_MS, decideCloseAction } from "./wsReconnect";

describe("decideCloseAction — intentional / stale shortcuts", () => {
  it("returns ignore when isIntentional is true (regardless of close code)", () => {
    expect(decideCloseAction(1006, 0, true, false)).toEqual({ kind: "ignore" });
    expect(decideCloseAction(4404, 5, true, false)).toEqual({ kind: "ignore" });
  });

  it("returns ignore when isStale is true (a replaced socket fired late)", () => {
    expect(decideCloseAction(1006, 0, false, true)).toEqual({ kind: "ignore" });
    expect(decideCloseAction(4404, 0, false, true)).toEqual({ kind: "ignore" });
  });
});

describe("decideCloseAction — permanent failures", () => {
  it("maps 4404 (pane not found) to gone", () => {
    expect(decideCloseAction(4404, 0, false, false)).toEqual({ kind: "gone" });
  });

  it("maps 4410 (stream ended) to gone", () => {
    expect(decideCloseAction(4410, 3, false, false)).toEqual({ kind: "gone" });
  });
});

describe("decideCloseAction — normal close", () => {
  it("maps 1000 (normal) to ignore (treated as intentional)", () => {
    expect(decideCloseAction(1000, 0, false, false)).toEqual({ kind: "ignore" });
  });
});

describe("decideCloseAction — backoff scheduling", () => {
  it("schedules retry with BACKOFF_MS[attempt] for attempts 0..7", () => {
    BACKOFF_MS.forEach((delayMs, attempt) => {
      expect(decideCloseAction(1006, attempt, false, false)).toEqual({
        kind: "retry",
        delayMs,
        attempt,
      });
    });
  });

  it("returns exhausted when attempt equals BACKOFF_MS.length", () => {
    expect(decideCloseAction(1006, BACKOFF_MS.length, false, false)).toEqual({
      kind: "exhausted",
    });
  });

  it("returns exhausted when attempt exceeds the cap", () => {
    expect(decideCloseAction(1006, 99, false, false)).toEqual({ kind: "exhausted" });
  });

  it("treats unknown close codes as retryable (network blips)", () => {
    expect(decideCloseAction(1011, 0, false, false)).toEqual({
      kind: "retry",
      delayMs: BACKOFF_MS[0],
      attempt: 0,
    });
  });
});

describe("BACKOFF_MS", () => {
  it("is the periscope curve: 250, 500, 1000, 2000, then steady 4000", () => {
    expect(BACKOFF_MS).toEqual([250, 500, 1000, 2000, 4000, 4000, 4000, 4000]);
  });
});
