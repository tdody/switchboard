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
  pr: number | null;
  ci: CIState | null;
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
  agent: Agent | null;
  preview: string[];
}

export interface StateResponse {
  sessions: Session[];
  windows: Window[];
  serverRunning: boolean;
}

// Auto-rename modal (THI-67). Preview-only — applying happens via the
// existing /api/rename per accepted row. `Usage.estCostUsd` is a Haiku 4.5
// rate-card estimate; actual billing is what Anthropic charges.
export interface RenameSuggestion {
  index: number;
  old: string;
  suggested: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
}

export interface AutoRenameResponse {
  suggestions: RenameSuggestion[];
  usage: Usage;
}

export interface AiStatus {
  enabled: boolean;
  model: string;
}
