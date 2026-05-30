import { describe, expect, it } from "vitest";

import { ACTIVE_POLL_MS, INPUT_ACTIVE_MIN_MS, pickPollInterval } from "./pollTier";
import type { Status, Window } from "../types";

const MODAL_OPEN_POLL_MS = 100;

function makeWindow(status: Status, paneId = "%1"): Window {
  return {
    id: "s:0",
    paneId,
    session: "s",
    index: 0,
    name: "w",
    kind: "shell",
    status,
    lastActivity: 0,
    cpu: 0,
    mem: 0,
    cmd: "",
    cwd: "",
    pendingInput: false,
    branch: null,
    pr: null,
    prUrl: null,
    ci: null,
    repoUrl: null,
    agent: null,
    preview: [],
  };
}

describe("pickPollInterval", () => {
  it("returns the modal cadence when a modal is open, regardless of windows or configured", () => {
    expect(pickPollInterval(true, [], 3000, MODAL_OPEN_POLL_MS)).toBe(100);
    expect(
      pickPollInterval(
        true,
        [makeWindow("running"), makeWindow("idle", "%2")],
        9999,
        MODAL_OPEN_POLL_MS,
      ),
    ).toBe(100);
  });

  it("returns the configured cadence when there are no windows (pre-hydration / empty)", () => {
    expect(pickPollInterval(false, [], 3000, MODAL_OPEN_POLL_MS)).toBe(3000);
    expect(pickPollInterval(false, [], 5000, MODAL_OPEN_POLL_MS)).toBe(5000);
  });

  it("applies the 8 s floor when every window is idle and configured is default 3000", () => {
    expect(
      pickPollInterval(
        false,
        [makeWindow("idle"), makeWindow("idle", "%2")],
        3000,
        MODAL_OPEN_POLL_MS,
      ),
    ).toBe(8000);
  });

  it("doubles the configured cadence when every window is idle and configured > 4000", () => {
    expect(
      pickPollInterval(
        false,
        [makeWindow("idle"), makeWindow("idle", "%2")],
        5000,
        MODAL_OPEN_POLL_MS,
      ),
    ).toBe(10000);
  });

  it("returns the active cadence when any window is running", () => {
    expect(
      pickPollInterval(
        false,
        [makeWindow("running"), makeWindow("idle", "%2")],
        3000,
        MODAL_OPEN_POLL_MS,
      ),
    ).toBe(ACTIVE_POLL_MS);
    expect(ACTIVE_POLL_MS).toBe(1000);
  });

  it("returns the active cadence when any window is waiting", () => {
    expect(
      pickPollInterval(
        false,
        [makeWindow("waiting")],
        3000,
        MODAL_OPEN_POLL_MS,
      ),
    ).toBe(ACTIVE_POLL_MS);
  });

  it("treats done + error as idle and applies the slowdown", () => {
    // Configured 3000 → max(8000, 6000) = 8000
    expect(
      pickPollInterval(
        false,
        [makeWindow("done"), makeWindow("error", "%2")],
        3000,
        MODAL_OPEN_POLL_MS,
      ),
    ).toBe(8000);
    // Configured 6000 → max(8000, 12000) = 12000
    expect(
      pickPollInterval(
        false,
        [makeWindow("done"), makeWindow("error", "%2")],
        6000,
        MODAL_OPEN_POLL_MS,
      ),
    ).toBe(12000);
  });

  // ── THI-138: input-active backoff ─────────────────────────────────
  // Each tier above gets clamped to INPUT_ACTIVE_MIN_MS when the user is
  // typing, so polling renders yield to keystrokes regardless of tier.

  it("clamps the modal-open tier to INPUT_ACTIVE_MIN_MS while typing", () => {
    expect(
      pickPollInterval(true, [], 3000, MODAL_OPEN_POLL_MS, true),
    ).toBe(INPUT_ACTIVE_MIN_MS);
    expect(INPUT_ACTIVE_MIN_MS).toBe(1500);
  });

  it("clamps the active tier to INPUT_ACTIVE_MIN_MS while typing", () => {
    expect(
      pickPollInterval(
        false,
        [makeWindow("running")],
        3000,
        MODAL_OPEN_POLL_MS,
        true,
      ),
    ).toBe(INPUT_ACTIVE_MIN_MS);
  });

  it("leaves slow tiers alone when their base already exceeds the clamp", () => {
    // Idle tier returns 8000, which is already > 1500, so the clamp is a
    // no-op. Regression guard against accidentally setting *down* to the
    // clamp floor.
    expect(
      pickPollInterval(
        false,
        [makeWindow("done")],
        3000,
        MODAL_OPEN_POLL_MS,
        true,
      ),
    ).toBe(8000);
  });

  it("is a no-op when inputActive is false (default arg)", () => {
    // The bare 4-arg call (existing call sites pre-THI-138) keeps
    // behaving exactly as before — the inputActive parameter defaults
    // to false so older callers don't see a behavior change.
    expect(
      pickPollInterval(true, [], 3000, MODAL_OPEN_POLL_MS),
    ).toBe(MODAL_OPEN_POLL_MS);
  });
});
