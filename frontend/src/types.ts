export type Status = "running" | "waiting" | "idle" | "done" | "error";
export type Kind = "shell" | "editor" | "server" | "agent" | "logs";
export type CIState = "passing" | "failing" | "running";

export interface Client {
  tty: string;
  term: string;
  since: number;
}

export interface Session {
  id: string;
  name: string;
  attached: boolean;
  created: number;
  clients: Client[];
}

export interface Agent {
  branch: string | null;
  spinner: string | null;
  duration: string | null;
  recap: string | null;
  action: string | null;
}

export interface Window {
  id: string; // "{session}:{index}" — addressing label; changes on rename/move
  paneId: string; // tmux %N — stable identity; use for React keys + selection
  session: string;
  index: number;
  name: string;
  kind: Kind;
  status: Status;
  lastActivity: number;
  cpu: number;
  mem: number;
  cmd: string;
  cwd: string;
  pendingInput: boolean;
  // Git branch of the pane's cwd, if any — populated for shell panes too, not
  // just agents. For agents this is the same value as `agent.branch`.
  branch: string | null;
  // PR number + CI rollup for the pane's `branch`, surfaced on every pane
  // (not just agents) so shell tiles on a branch with an open PR also get a
  // CI-tinted chip. Null when there's no branch or no open PR.
  pr: number | null;
  ci: CIState | null;
  agent: Agent | null;
  preview: string[];
}

export interface StateResponse {
  sessions: Session[];
  windows: Window[];
  serverRunning: boolean;
}
