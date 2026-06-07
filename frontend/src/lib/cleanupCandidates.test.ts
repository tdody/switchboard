import { describe, expect, it } from "vitest";

import {
  computeCandidates,
  defaultChecked,
  isMidTurn,
  lastWindowSessions,
} from "./cleanupCandidates";
import { mkWindow } from "../test/factories";

const DAY_MS = 86_400_000;

describe("computeCandidates", () => {
  const now = 10 * DAY_MS;
  const fresh = mkWindow({ paneId: "%fresh", lastActivity: now - 1 * DAY_MS });
  const stale = mkWindow({ paneId: "%stale", lastActivity: now - 8 * DAY_MS });
  const ancient = mkWindow({ paneId: "%ancient", lastActivity: now - 30 * DAY_MS });

  it("returns only windows past the threshold", () => {
    const result = computeCandidates([fresh, stale, ancient], now, 7);
    expect(result.map((w) => w.paneId)).toEqual(["%ancient", "%stale"]);
    // (`ancient` first because it's older — sort by lastActivity ascending.)
  });

  it("sorts oldest-idle first", () => {
    const result = computeCandidates([stale, ancient], now, 7);
    expect(result[0]?.paneId).toBe("%ancient");
    expect(result[1]?.paneId).toBe("%stale");
  });

  it("returns empty when threshold is 0", () => {
    expect(computeCandidates([stale, ancient], now, 0)).toEqual([]);
  });

  it("returns empty when no windows are stale", () => {
    expect(computeCandidates([fresh], now, 7)).toEqual([]);
  });

  it("skips windows with lastActivity === 0 (no recorded activity)", () => {
    const unrecorded = mkWindow({ paneId: "%unrecorded", lastActivity: 0 });
    const result = computeCandidates([unrecorded, ancient], now, 7);
    expect(result.map((w) => w.paneId)).toEqual(["%ancient"]);
  });
});

describe("isMidTurn", () => {
  it("is true for agent + running", () => {
    expect(isMidTurn(mkWindow({ kind: "agent", status: "running" }))).toBe(true);
  });
  it("is true for agent + waiting", () => {
    expect(isMidTurn(mkWindow({ kind: "agent", status: "waiting" }))).toBe(true);
  });
  it("is true for agent + pendingInput", () => {
    expect(
      isMidTurn(mkWindow({ kind: "agent", status: "idle", pendingInput: true })),
    ).toBe(true);
  });
  it("is false for agent + idle (no pendingInput)", () => {
    expect(isMidTurn(mkWindow({ kind: "agent", status: "idle" }))).toBe(false);
  });
  it("is false for non-agent kinds even when running", () => {
    expect(isMidTurn(mkWindow({ kind: "server", status: "running" }))).toBe(false);
  });
});

describe("defaultChecked", () => {
  const pinned = new Set<string>(["%pin"]);

  it("checks plain idle shells", () => {
    expect(defaultChecked(mkWindow({ paneId: "%a" }), pinned)).toBe(true);
  });

  it("unchecks pinned windows", () => {
    expect(defaultChecked(mkWindow({ paneId: "%pin" }), pinned)).toBe(false);
  });

  it("unchecks mid-turn agents", () => {
    const w = mkWindow({ paneId: "%a", kind: "agent", status: "running" });
    expect(defaultChecked(w, pinned)).toBe(false);
  });
});

describe("lastWindowSessions", () => {
  it("returns sessions whose only-window in `windows` is in the selection", () => {
    const onlyOne = mkWindow({ paneId: "%a", session: "alpha", index: 1 });
    const oneOfTwo = mkWindow({ paneId: "%b", session: "beta", index: 1 });
    const beta2 = mkWindow({ paneId: "%c", session: "beta", index: 2 });
    const all = [onlyOne, oneOfTwo, beta2];
    expect(lastWindowSessions([onlyOne], all)).toEqual(["alpha"]);
    expect(lastWindowSessions([oneOfTwo], all)).toEqual([]); // beta still has %c
    expect(lastWindowSessions([oneOfTwo, beta2], all)).toEqual(["beta"]);
  });
});
