import type { Agent, Session, Window } from "../types";

let seq = 0;

export function mkAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    branch: null,
    pr: null,
    ci: null,
    spinner: null,
    duration: null,
    recap: null,
    action: null,
    ...overrides,
  };
}

export function mkWindow(overrides: Partial<Window> = {}): Window {
  seq += 1;
  return {
    id: `main:${seq}`,
    paneId: `%${seq}`,
    session: "main",
    index: seq,
    name: `win-${seq}`,
    kind: "shell",
    status: "idle",
    lastActivity: 0,
    cpu: 0,
    mem: 0,
    cmd: "",
    cwd: "",
    pendingInput: false,
    agent: null,
    preview: [],
    ...overrides,
  };
}

export function mkSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "main",
    name: "main",
    attached: false,
    created: 0,
    clients: [],
    ...overrides,
  };
}
