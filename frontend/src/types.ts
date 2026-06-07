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
  // Claude Code's current context-window usage, 0..100 integer percent,
  // scraped from the TUI footer (THI-131). Optional/absent when the parser
  // hasn't seen the `Context:` line in the recent capture.
  contextPct?: number;
  // Running USD cost for THIS pane's claude session, scraped from the `💰`
  // marker in the TUI status line (THI-139). Null when the marker isn't
  // visible (fresh session, or a TUI screen that doesn't render the footer).
  // Frontend sums these across visible agent panes for the header pill.
  sessionCostUsd?: number;
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
  // Direct URL to the PR — fetched by the backend's `gh pr view --json url`
  // alongside the number. Drives the clickable PR chip (THI-146 PR 2).
  prUrl: string | null;
  ci: CIState | null;
  // Normalized `https://github.com/owner/repo` for the pane's cwd, or null if
  // the cwd isn't inside a github repo. The xterm linkProvider appends
  // `/pull/N` to this base when linkifying `PR #N` mentions in the pane.
  repoUrl: string | null;
  agent: Agent | null;
  preview: string[];
}

export interface StateResponse {
  sessions: Session[];
  windows: Window[];
  serverRunning: boolean;
}

// Pane history search (THI-100). One row in the SearchModal's result list.
export interface SearchMatch {
  paneId: string;
  session: string;
  windowName: string;
  windowIndex: number;
  /** 1-based line within the capture buffer. */
  lineNumber: number;
  /** Exactly 3 entries: [above, match line, below]. Ends pad with "". */
  context: [string, string, string];
}

export interface SearchResponse {
  query: string;
  matches: SearchMatch[];
  /** THI-220: True when the route capped the result list (200) and the tail
   *  was dropped. The SearchModal surfaces a banner in this case so the
   *  user knows to narrow the query rather than treating the list as
   *  complete. Optional for backward-compat with older snapshots. */
  truncated?: boolean;
}

// Session templates (THI-99).
export interface TemplateSummary {
  name: string;
  windowCount: number;
  variables: string[];
}

export interface TemplatesResponse {
  templates: TemplateSummary[];
}

// Auto-rename modal (THI-67). Preview-only — applying happens via the
// existing /api/rename per accepted row. `Usage.estCostUsd` is a Haiku 4.5
// rate-card estimate; actual billing is what Anthropic charges. Note the
// per-call `Usage` shape here is distinct from `ClaudeUsage` below — that
// one is rolling-window plan usage scraped from JSONL session logs.
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
  /** Where the key was picked up (or "none" if not configured). Drives the
   *  Settings panel's instruction text — `env` users edit their shell rc,
   *  `config` users edit `.env`. */
  source: "env" | "config" | "none";
  /** Short safe-to-show fingerprint like `sk-ant-…XYZ1`. Null when no key
   *  is set. Never the full key. */
  masked: string | null;
}

// Claude rolling-window token usage parsed from `~/.claude/projects/*.jsonl`
// (THI-110). `available=false` means the projects directory doesn't exist —
// e.g. the user has never run Claude Code. `resetAt` is unix epoch seconds for
// the *earliest* in-window message + windowHours.
export interface ClaudeUsage {
  available: boolean;
  windowHours: number;
  messages: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  resetAt: number | null;
}

// One row of the `claude /usage` TUI; populated only when the optional scrape
// is enabled (THI-110 commit 2).
export interface UsageMeter {
  label: string;
  percent: number;
  resets: string;
}

export interface UsageScrape {
  available: boolean;
  meters: Record<string, UsageMeter>;
}

export interface UsageResponse {
  tokens: ClaudeUsage;
  scrape: UsageScrape | null;
}

// Read-only knobs for the Settings panel (THI-110 commit 3). The TTL values
// are seconds (per-server-startup config — toggling them at runtime would
// invalidate caches, not worth the complexity here).
export interface UsageConfig {
  scrapeEnabled: boolean;
  scrapeTtlS: number;
  tokenTtlS: number;
}
