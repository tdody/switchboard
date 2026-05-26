import { describe, expect, it } from "vitest";
import { mkAgent, mkWindow } from "../test/factories";
import { applyFilter, parseQuery, sortPendingFirst, stripKindToken } from "./filter";

describe("parseQuery", () => {
  it("extracts kind/status/session tokens, lowercased", () => {
    const r = parseQuery("kind:Agent status:WAITING session:main");
    expect(r.tokens).toEqual({ kind: "agent", status: "waiting", session: "main" });
    expect(r.freeText).toBe("");
  });

  it("treats an unknown key:value as free text", () => {
    const r = parseQuery("foo:bar hello");
    expect(r.tokens).toEqual({});
    expect(r.freeText).toBe("foo:bar hello");
  });

  it("collects free text around tokens", () => {
    const r = parseQuery("deploy kind:server script");
    expect(r.tokens.kind).toBe("server");
    expect(r.freeText).toBe("deploy script");
  });

  it("handles empty input", () => {
    expect(parseQuery("")).toEqual({ tokens: {}, freeText: "" });
  });
});

describe("applyFilter", () => {
  const windows = [
    mkWindow({ name: "build", session: "main", kind: "server", status: "running" }),
    mkWindow({ name: "agent-x", session: "agents", kind: "agent", status: "waiting" }),
    mkWindow({ name: "shell", session: "main", kind: "shell", status: "idle" }),
  ];
  const noQuery = parseQuery("");

  it("status filter narrows to one status", () => {
    expect(applyFilter(windows, "waiting", "", noQuery).map((w) => w.name)).toEqual(["agent-x"]);
  });

  it("'all' returns everything", () => {
    expect(applyFilter(windows, "all", "", noQuery)).toHaveLength(3);
  });

  it("kind token filters by kind", () => {
    const r = applyFilter(windows, "all", "", parseQuery("kind:agent"));
    expect(r.map((w) => w.name)).toEqual(["agent-x"]);
  });

  it("session token filters by session", () => {
    expect(applyFilter(windows, "all", "", parseQuery("session:main"))).toHaveLength(2);
  });

  it("free text matches the window name", () => {
    const r = applyFilter(windows, "all", "", parseQuery("buil"));
    expect(r.map((w) => w.name)).toEqual(["build"]);
  });

  it("free text matches the agent branch", () => {
    const ws = [mkWindow({ name: "a", agent: mkAgent({ branch: "feat/login" }) })];
    expect(applyFilter(ws, "all", "", parseQuery("login"))).toHaveLength(1);
  });

  it("composes status chip + token + free text with AND", () => {
    const r = applyFilter(windows, "running", "", parseQuery("kind:server build"));
    expect(r.map((w) => w.name)).toEqual(["build"]);
  });

  it("returns nothing when free text matches no field", () => {
    expect(applyFilter(windows, "all", "", parseQuery("zzzznomatch"))).toHaveLength(0);
  });

  // THI-130 — kind chip behavior.
  it("kind chip empty leaves all kinds visible", () => {
    expect(applyFilter(windows, "all", "", noQuery).map((w) => w.name)).toEqual([
      "build",
      "agent-x",
      "shell",
    ]);
  });

  it("kind chip=agent narrows to agent kind", () => {
    expect(applyFilter(windows, "all", "agent", noQuery).map((w) => w.name)).toEqual(["agent-x"]);
  });

  it("kind chip=shell narrows to shell kind", () => {
    expect(applyFilter(windows, "all", "shell", noQuery).map((w) => w.name)).toEqual(["shell"]);
  });

  it("kind chip AND-composes with status filter", () => {
    expect(
      applyFilter(windows, "waiting", "agent", noQuery).map((w) => w.name),
    ).toEqual(["agent-x"]);
  });

  it("kind chip and conflicting kind: search token AND to empty", () => {
    expect(applyFilter(windows, "all", "agent", parseQuery("kind:shell"))).toHaveLength(0);
  });

  it("kind chip and redundant matching kind: token still narrows", () => {
    expect(
      applyFilter(windows, "all", "agent", parseQuery("kind:agent")).map((w) => w.name),
    ).toEqual(["agent-x"]);
  });
});

describe("stripKindToken", () => {
  it("removes a kind:value token and trims whitespace", () => {
    expect(stripKindToken("foo kind:agent bar")).toBe("foo bar");
  });

  it("removes every kind: token, leaving an empty string", () => {
    expect(stripKindToken("kind:agent kind:shell")).toBe("");
  });

  it("is case-insensitive on the key", () => {
    expect(stripKindToken("Kind:Agent extra")).toBe("extra");
  });

  it("leaves text without kind: tokens unchanged", () => {
    expect(stripKindToken("hello world")).toBe("hello world");
  });
});

describe("sortPendingFirst", () => {
  it("floats pending to the top, error to the second tier, and keeps the rest in tmux index order", () => {
    // THI-122: collapse running/done/idle into one bucket so a Claude pane
    // oscillating between running and idle no longer reorders mid-poll.
    const ws = [
      mkWindow({ name: "idle1", status: "idle", index: 4 }),
      mkWindow({ name: "done1", status: "done", index: 3 }),
      mkWindow({ name: "pending1", status: "running", pendingInput: true, index: 5 }),
      mkWindow({ name: "error1", status: "error", index: 2 }),
      mkWindow({ name: "running1", status: "running", index: 1 }),
    ];
    expect(sortPendingFirst(ws).map((w) => w.name)).toEqual([
      "pending1",
      "error1",
      "running1", // index 1 — tied with done1/idle1 in rank, beats them on index
      "done1", // index 3
      "idle1", // index 4
    ]);
  });

  it("does not reorder when a single pane flips running ↔ idle", () => {
    // The flicker the bug is about: same panes, only the middle one's status
    // changes between polls. Output positions must be identical.
    const running = [
      mkWindow({ name: "a", status: "running", index: 1 }),
      mkWindow({ name: "b", status: "running", index: 2 }),
      mkWindow({ name: "c", status: "running", index: 3 }),
    ];
    const idleMiddle = [
      mkWindow({ name: "a", status: "running", index: 1 }),
      mkWindow({ name: "b", status: "idle", index: 2 }),
      mkWindow({ name: "c", status: "running", index: 3 }),
    ];
    expect(sortPendingFirst(running).map((w) => w.name)).toEqual(["a", "b", "c"]);
    expect(sortPendingFirst(idleMiddle).map((w) => w.name)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const ws = [mkWindow({ status: "done" }), mkWindow({ status: "error" })];
    const before = [...ws];
    sortPendingFirst(ws);
    expect(ws).toEqual(before);
  });
});
