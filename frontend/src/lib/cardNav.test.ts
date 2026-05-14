import { describe, expect, it } from "vitest";
import { mkSession, mkWindow } from "../test/factories";
import { columnsForNav, navigateCard } from "./cardNav";

// Two sessions: A has 3 windows, B has 2. paneIds are explicit so navigation
// assertions read clearly.
function fixture() {
  const sessions = [mkSession({ id: "A", name: "A" }), mkSession({ id: "B", name: "B" })];
  const windows = [
    mkWindow({ paneId: "%a0", session: "A" }),
    mkWindow({ paneId: "%a1", session: "A" }),
    mkWindow({ paneId: "%a2", session: "A" }),
    mkWindow({ paneId: "%b0", session: "B" }),
    mkWindow({ paneId: "%b1", session: "B" }),
  ];
  return { sessions, windows };
}

describe("columnsForNav", () => {
  it("groups windows by session, preserving session order", () => {
    const { sessions, windows } = fixture();
    const cols = columnsForNav(sessions, windows);
    expect(cols.map((c) => c.sessionId)).toEqual(["A", "B"]);
    expect(cols[0].windows.map((w) => w.paneId)).toEqual(["%a0", "%a1", "%a2"]);
    expect(cols[1].windows.map((w) => w.paneId)).toEqual(["%b0", "%b1"]);
  });
});

describe("navigateCard", () => {
  const { sessions, windows } = fixture();
  const cols = columnsForNav(sessions, windows);

  it("null current → first card of first column", () => {
    expect(navigateCard(cols, null, "down")?.paneId).toBe("%a0");
  });

  it("down moves within a column", () => {
    expect(navigateCard(cols, "%a0", "down")?.paneId).toBe("%a1");
  });

  it("down at the column bottom stays put", () => {
    expect(navigateCard(cols, "%a2", "down")?.paneId).toBe("%a2");
  });

  it("up moves within a column", () => {
    expect(navigateCard(cols, "%a1", "up")?.paneId).toBe("%a0");
  });

  it("up at the column top stays put", () => {
    expect(navigateCard(cols, "%a0", "up")?.paneId).toBe("%a0");
  });

  it("right moves to the same row in the next column", () => {
    expect(navigateCard(cols, "%a1", "right")?.paneId).toBe("%b1");
  });

  it("right clamps the row to a shorter target column", () => {
    expect(navigateCard(cols, "%a2", "right")?.paneId).toBe("%b1");
  });

  it("right from the last column returns null", () => {
    expect(navigateCard(cols, "%b0", "right")).toBeNull();
  });

  it("left moves to the previous column", () => {
    expect(navigateCard(cols, "%b1", "left")?.paneId).toBe("%a1");
  });

  it("left from the first column returns null", () => {
    expect(navigateCard(cols, "%a0", "left")).toBeNull();
  });

  it("an unknown current id falls back to the first card", () => {
    expect(navigateCard(cols, "%does-not-exist", "down")?.paneId).toBe("%a0");
  });

  it("returns null when every column is empty", () => {
    expect(navigateCard(columnsForNav(sessions, []), null, "down")).toBeNull();
  });

  it("skips empty columns on a horizontal move", () => {
    const s = [mkSession({ id: "A" }), mkSession({ id: "B" }), mkSession({ id: "C" })];
    const w = [mkWindow({ paneId: "%x", session: "A" }), mkWindow({ paneId: "%y", session: "C" })];
    const c = columnsForNav(s, w);
    expect(navigateCard(c, "%x", "right")?.paneId).toBe("%y");
  });
});
