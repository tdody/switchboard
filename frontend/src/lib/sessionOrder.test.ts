import { beforeEach, describe, expect, it } from "vitest";

import {
  applySessionOrder,
  loadSessionOrder,
  reorderSessions,
  saveSessionOrder,
} from "./sessionOrder";

beforeEach(() => {
  localStorage.clear();
});

describe("loadSessionOrder", () => {
  it("returns [] when the key is missing", () => {
    expect(loadSessionOrder()).toEqual([]);
  });

  it("tolerates corrupt JSON", () => {
    localStorage.setItem("switchboard:sessionOrder", "{not json");
    expect(loadSessionOrder()).toEqual([]);
  });

  it("tolerates a non-array payload", () => {
    localStorage.setItem("switchboard:sessionOrder", JSON.stringify({ foo: 1 }));
    expect(loadSessionOrder()).toEqual([]);
  });

  it("drops non-string array elements", () => {
    localStorage.setItem(
      "switchboard:sessionOrder",
      JSON.stringify(["main", 42, null, "agents"]),
    );
    expect(loadSessionOrder()).toEqual(["main", "agents"]);
  });
});

describe("saveSessionOrder", () => {
  it("round-trips an order through localStorage", () => {
    saveSessionOrder(["a", "b", "c"]);
    expect(loadSessionOrder()).toEqual(["a", "b", "c"]);
  });

  it("overwrites a previously-saved order", () => {
    saveSessionOrder(["a", "b"]);
    saveSessionOrder(["b", "a"]);
    expect(loadSessionOrder()).toEqual(["b", "a"]);
  });
});

describe("reorderSessions", () => {
  it("moves src to immediately before dst", () => {
    expect(reorderSessions(["a", "b", "c"], "c", "a", true)).toEqual(["c", "a", "b"]);
  });

  it("moves src to immediately after dst", () => {
    expect(reorderSessions(["a", "b", "c"], "a", "c", false)).toEqual(["b", "c", "a"]);
  });

  it("moves a middle item without affecting the others' relative order", () => {
    expect(reorderSessions(["a", "b", "c", "d"], "b", "d", false)).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
  });

  it("is a no-op when src equals dst", () => {
    expect(reorderSessions(["a", "b", "c"], "b", "b", true)).toEqual(["a", "b", "c"]);
  });

  it("returns the list unchanged when src is not present", () => {
    expect(reorderSessions(["a", "b", "c"], "z", "a", true)).toEqual(["a", "b", "c"]);
  });

  it("returns the list unchanged when dst is not present", () => {
    expect(reorderSessions(["a", "b", "c"], "a", "z", true)).toEqual(["a", "b", "c"]);
  });

  it("handles moving the last item to the front", () => {
    expect(reorderSessions(["a", "b", "c"], "c", "a", true)).toEqual(["c", "a", "b"]);
  });

  it("handles moving the first item to the end", () => {
    expect(reorderSessions(["a", "b", "c"], "a", "c", false)).toEqual(["b", "c", "a"]);
  });
});

describe("applySessionOrder", () => {
  const mk = (id: string) => ({ id, name: id, attached: false, created: 0, clients: [] });

  it("returns natural order when no saved order is present", () => {
    const sessions = [mk("alpha"), mk("beta")];
    expect(applySessionOrder(sessions, []).map((s) => s.id)).toEqual(["alpha", "beta"]);
  });

  it("pins saved-order entries to the front in the saved order", () => {
    const sessions = [mk("alpha"), mk("beta"), mk("gamma")];
    expect(
      applySessionOrder(sessions, ["gamma", "alpha"]).map((s) => s.id),
    ).toEqual(["gamma", "alpha", "beta"]);
  });

  it("appends new (unpinned) sessions after the pinned ones, in natural order", () => {
    const sessions = [mk("alpha"), mk("new1"), mk("new2"), mk("beta")];
    expect(
      applySessionOrder(sessions, ["beta", "alpha"]).map((s) => s.id),
    ).toEqual(["beta", "alpha", "new1", "new2"]);
  });

  it("drops saved-order entries that no longer correspond to a current session", () => {
    const sessions = [mk("alpha"), mk("beta")];
    expect(
      applySessionOrder(sessions, ["killed", "beta", "alpha"]).map((s) => s.id),
    ).toEqual(["beta", "alpha"]);
  });

  it("returns the input array reference when the order is already a no-op (perf)", () => {
    // Lets React.memo / useMemo downstream avoid re-renders when nothing
    // actually moved: empty saved order against any sessions list should
    // return the input array itself, not a fresh copy.
    const sessions = [mk("alpha"), mk("beta")];
    expect(applySessionOrder(sessions, [])).toBe(sessions);
  });
});
