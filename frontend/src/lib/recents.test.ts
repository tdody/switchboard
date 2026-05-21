import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENTS, addRecent, readRecents, removeRecent } from "./recents";

beforeEach(() => {
  localStorage.clear();
});

describe("readRecents", () => {
  it("returns empty for an unseen session", () => {
    expect(readRecents("dev")).toEqual([]);
  });

  it("ignores corrupt JSON", () => {
    localStorage.setItem("switchboard:recents:dev", "{not json");
    expect(readRecents("dev")).toEqual([]);
  });

  it("ignores non-array payloads", () => {
    localStorage.setItem("switchboard:recents:dev", JSON.stringify({ foo: 1 }));
    expect(readRecents("dev")).toEqual([]);
  });
});

describe("addRecent", () => {
  it("prepends a new entry (MRU first)", () => {
    addRecent("dev", { label: "ls", paste: "ls", enter: true });
    addRecent("dev", { label: "pwd", paste: "pwd", enter: true });
    expect(readRecents("dev").map((e) => e.label)).toEqual(["pwd", "ls"]);
  });

  it("dedups by exact payload and promotes to MRU", () => {
    addRecent("dev", { label: "ls", paste: "ls", enter: true });
    addRecent("dev", { label: "pwd", paste: "pwd", enter: true });
    addRecent("dev", { label: "ls", paste: "ls", enter: true });
    expect(readRecents("dev").map((e) => e.label)).toEqual(["ls", "pwd"]);
  });

  it("treats a different `enter` flag as a distinct entry", () => {
    addRecent("dev", { label: "ls", paste: "ls", enter: true });
    addRecent("dev", { label: "ls (no enter)", paste: "ls", enter: false });
    expect(readRecents("dev")).toHaveLength(2);
  });

  it("caps the list at MAX_RECENTS", () => {
    for (let i = 0; i < MAX_RECENTS + 5; i++) {
      addRecent("dev", { label: `cmd ${i}`, paste: `cmd ${i}`, enter: true });
    }
    const got = readRecents("dev");
    expect(got).toHaveLength(MAX_RECENTS);
    // newest first → last-pushed sits at index 0
    expect(got[0].label).toBe(`cmd ${MAX_RECENTS + 4}`);
  });

  it("scopes by session", () => {
    addRecent("a", { label: "x", paste: "x", enter: true });
    addRecent("b", { label: "y", paste: "y", enter: true });
    expect(readRecents("a").map((e) => e.label)).toEqual(["x"]);
    expect(readRecents("b").map((e) => e.label)).toEqual(["y"]);
  });

  it("persists across readers", () => {
    addRecent("dev", { label: "ls", paste: "ls", enter: true });
    // simulate a fresh read by going through localStorage
    expect(readRecents("dev")).toEqual([{ label: "ls", paste: "ls", enter: true }]);
  });
});

describe("removeRecent", () => {
  it("drops the matching entry only", () => {
    addRecent("dev", { label: "ls", paste: "ls", enter: true });
    addRecent("dev", { label: "pwd", paste: "pwd", enter: true });
    const next = removeRecent("dev", { label: "ls", paste: "ls", enter: true });
    expect(next.map((e) => e.label)).toEqual(["pwd"]);
    expect(readRecents("dev").map((e) => e.label)).toEqual(["pwd"]);
  });

  it("is a no-op when the entry isn't present", () => {
    addRecent("dev", { label: "ls", paste: "ls", enter: true });
    const next = removeRecent("dev", { label: "missing", paste: "missing", enter: true });
    expect(next.map((e) => e.label)).toEqual(["ls"]);
  });
});
