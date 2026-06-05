import { describe, expect, it } from "vitest";

import type { Window } from "../types";
import { quickActionsFor } from "./quickActions";

function makeWindow(overrides: Partial<Window> = {}): Window {
  return {
    id: "main:0",
    paneId: "%0",
    session: "main",
    index: 0,
    name: "shell",
    kind: "shell",
    status: "idle",
    lastActivity: 0,
    cpu: 0,
    mem: 0,
    cmd: "zsh",
    cwd: "",
    pendingInput: false,
    branch: null,
    pr: null,
    prUrl: null,
    ci: null,
    repoUrl: null,
    agent: null,
    preview: [],
    ...overrides,
  };
}

describe("quickActionsFor", () => {
  it("pending agent: y, n, and Ctrl-C — y/n send the letter + Enter", () => {
    const actions = quickActionsFor(
      makeWindow({ kind: "agent", status: "waiting", pendingInput: true }),
    );
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(["agent.yes", "agent.no", "agent.interrupt"]);

    const y = actions.find((a) => a.id === "agent.yes")!;
    expect(y.payload).toEqual({ paste: "y", keys: ["Enter"] });

    const n = actions.find((a) => a.id === "agent.no")!;
    expect(n.payload).toEqual({ paste: "n", keys: ["Enter"] });

    const ctrlc = actions.find((a) => a.id === "agent.interrupt")!;
    expect(ctrlc.payload).toEqual({ keys: ["C-c"] });
  });

  it("non-pending running agent: Ctrl-C only (no y/n on a busy spinner)", () => {
    const actions = quickActionsFor(
      makeWindow({
        kind: "agent",
        status: "running",
        pendingInput: false,
      }),
    );
    expect(actions.map((a) => a.id)).toEqual(["agent.interrupt"]);
  });

  it("non-pending idle agent: Ctrl-C only", () => {
    const actions = quickActionsFor(
      makeWindow({ kind: "agent", status: "idle", pendingInput: false }),
    );
    expect(actions.map((a) => a.id)).toEqual(["agent.interrupt"]);
  });

  it("shell: clear-screen one-click", () => {
    const actions = quickActionsFor(makeWindow({ kind: "shell" }));
    expect(actions.map((a) => a.id)).toEqual(["shell.clear"]);
    expect(actions[0].payload).toEqual({ keys: ["C-l"] });
  });

  it("editor: nothing — keep the standard set", () => {
    const actions = quickActionsFor(makeWindow({ kind: "editor" }));
    expect(actions).toEqual([]);
  });

  it("server: nothing in this PR — Restart needs multi-step timing (follow-up)", () => {
    const actions = quickActionsFor(makeWindow({ kind: "server" }));
    expect(actions).toEqual([]);
  });

  it("logs: nothing in this PR — Pause/Resume is stateful (follow-up)", () => {
    const actions = quickActionsFor(makeWindow({ kind: "logs" }));
    expect(actions).toEqual([]);
  });
});
