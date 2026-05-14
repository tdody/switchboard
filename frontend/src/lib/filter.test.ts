import { describe, expect, it } from "vitest";
import { mkAgent, mkWindow } from "../test/factories";
import { applyFilter, parseQuery, sortPendingFirst } from "./filter";

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
    expect(applyFilter(windows, "waiting", noQuery).map((w) => w.name)).toEqual(["agent-x"]);
  });

  it("'all' returns everything", () => {
    expect(applyFilter(windows, "all", noQuery)).toHaveLength(3);
  });

  it("kind token filters by kind", () => {
    const r = applyFilter(windows, "all", parseQuery("kind:agent"));
    expect(r.map((w) => w.name)).toEqual(["agent-x"]);
  });

  it("session token filters by session", () => {
    expect(applyFilter(windows, "all", parseQuery("session:main"))).toHaveLength(2);
  });

  it("free text matches the window name", () => {
    const r = applyFilter(windows, "all", parseQuery("buil"));
    expect(r.map((w) => w.name)).toEqual(["build"]);
  });

  it("free text matches the agent branch", () => {
    const ws = [mkWindow({ name: "a", agent: mkAgent({ branch: "feat/login" }) })];
    expect(applyFilter(ws, "all", parseQuery("login"))).toHaveLength(1);
  });

  it("composes status chip + token + free text with AND", () => {
    const r = applyFilter(windows, "running", parseQuery("kind:server build"));
    expect(r.map((w) => w.name)).toEqual(["build"]);
  });

  it("returns nothing when free text matches no field", () => {
    expect(applyFilter(windows, "all", parseQuery("zzzznomatch"))).toHaveLength(0);
  });
});

describe("sortPendingFirst", () => {
  it("orders pending → error → running → done → other", () => {
    const ws = [
      mkWindow({ name: "idle1", status: "idle" }),
      mkWindow({ name: "done1", status: "done" }),
      mkWindow({ name: "pending1", status: "running", pendingInput: true }),
      mkWindow({ name: "error1", status: "error" }),
      mkWindow({ name: "running1", status: "running" }),
    ];
    expect(sortPendingFirst(ws).map((w) => w.name)).toEqual([
      "pending1",
      "error1",
      "running1",
      "done1",
      "idle1",
    ]);
  });

  it("does not mutate the input array", () => {
    const ws = [mkWindow({ status: "done" }), mkWindow({ status: "error" })];
    const before = [...ws];
    sortPendingFirst(ws);
    expect(ws).toEqual(before);
  });
});
