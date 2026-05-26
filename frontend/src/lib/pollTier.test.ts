import { describe, expect, it } from "vitest";

import { ACTIVE_POLL_MS, pickPollInterval } from "./pollTier";
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
    ci: null,
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
});
