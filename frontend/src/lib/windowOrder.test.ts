import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadWindowOrder,
  reorderWindow,
  saveWindowOrder,
  type WindowOrderMap,
} from "./windowOrder";

const STORAGE_KEY = "switchboard:windowOrder";

describe("loadWindowOrder", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns an empty map when no key is set", () => {
    expect(loadWindowOrder()).toEqual({});
  });

  it("round-trips a valid map", () => {
    saveWindowOrder({ main: ["%1", "%2"], work: ["%5"] });
    expect(loadWindowOrder()).toEqual({ main: ["%1", "%2"], work: ["%5"] });
  });

  it("ignores corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadWindowOrder()).toEqual({});
  });

  it("ignores non-object payloads (array / string / null)", () => {
    // Same lenient-parse pattern the other localStorage modules use.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["%1", "%2"]));
    expect(loadWindowOrder()).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify("nope"));
    expect(loadWindowOrder()).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
    expect(loadWindowOrder()).toEqual({});
  });

  it("ignores entries whose value isn't a string[]", () => {
    // A whole-payload reject keeps a single corrupt key from poisoning all
    // other sessions' orders.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ main: "not an array" }));
    expect(loadWindowOrder()).toEqual({});
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ main: [1, 2, 3] }));
    expect(loadWindowOrder()).toEqual({});
  });
});

describe("reorderWindow", () => {
  const SESSION = "main";

  it("returns the input map unchanged when src === dst", () => {
    const before: WindowOrderMap = { main: ["%1", "%2"] };
    expect(reorderWindow(before, SESSION, "%1", "%1", true)).toBe(before);
  });

  it("moves src before dst when both are already pinned", () => {
    const before: WindowOrderMap = { main: ["%1", "%2", "%3"] };
    expect(reorderWindow(before, SESSION, "%3", "%1", true)).toEqual({
      main: ["%3", "%1", "%2"],
    });
  });

  it("moves src after dst when both are already pinned", () => {
    const before: WindowOrderMap = { main: ["%1", "%2", "%3"] };
    expect(reorderWindow(before, SESSION, "%1", "%2", false)).toEqual({
      main: ["%2", "%1", "%3"],
    });
  });

  it("inserts a not-yet-pinned src relative to a pinned dst", () => {
    const before: WindowOrderMap = { main: ["%2"] };
    expect(reorderWindow(before, SESSION, "%1", "%2", true)).toEqual({
      main: ["%1", "%2"],
    });
    expect(reorderWindow(before, SESSION, "%1", "%2", false)).toEqual({
      main: ["%2", "%1"],
    });
  });

  it("creates a fresh pin list when neither src nor dst was pinned", () => {
    // First drag in this session ever — dst gets implicitly added at the end,
    // then src goes in at the requested side. Net result is a 2-pane list
    // that captures the user's first explicit positioning.
    const before: WindowOrderMap = {};
    expect(reorderWindow(before, SESSION, "%3", "%4", true)).toEqual({
      main: ["%3", "%4"],
    });
    expect(reorderWindow(before, SESSION, "%3", "%4", false)).toEqual({
      main: ["%4", "%3"],
    });
  });

  it("leaves other sessions' lists untouched", () => {
    const before: WindowOrderMap = { main: ["%1"], work: ["%5", "%6"] };
    const after = reorderWindow(before, "main", "%2", "%1", true);
    expect(after).toEqual({ main: ["%2", "%1"], work: ["%5", "%6"] });
    // Same reference is fine but a shallow-cloned root is required since
    // we changed `main`. The other key's array must be the same reference
    // to keep useMemo consumers stable.
    expect(after.work).toBe(before.work);
  });

  it("does not mutate the input map", () => {
    const before: WindowOrderMap = { main: ["%1", "%2"] };
    const snapshot = JSON.stringify(before);
    reorderWindow(before, SESSION, "%2", "%1", true);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
