import type {
  AiStatus,
  AutoRenameResponse,
  Session,
  StateResponse,
  UsageConfig,
  UsageResponse,
  Window,
} from "../types";

const BASE = "/api";

// Module-scoped ETag + cached state so 304 responses reuse the prior body.
let lastEtag: string | null = null;
let lastState: StateResponse | null = null;

/** Test-only: clear the module-scoped fetchState cache. Production code
 *  never calls this. */
export function _resetFetchStateCache(): void {
  lastEtag = null;
  lastState = null;
}

// The backend issues a readable `sb_csrf` cookie on the first GET. Mutating
// requests must echo it back in the X-CSRF-Token header (double-submit). A
// cross-origin attacker can't read the cookie, so can't forge the header.
function csrfHeaders(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)sb_csrf=([^;]+)/);
  return m ? { "x-csrf-token": decodeURIComponent(m[1]) } : {};
}

// THI-185: per-element dedup. The backend issues a new ETag whenever ANY
// field of the state changes — but the FE consumer cares about per-window
// (and per-session) identity. JSON.parse always produces fresh references,
// so without this step every poll cascade-invalidates every memoized child.
// Comparing via JSON.stringify is O(state-size) per poll, but state is small
// enough (~tens of KB) that the saved render work dominates.
function structurallyEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function dedupeList<T>(
  prev: readonly T[],
  next: readonly T[],
  key: (x: T) => string,
): T[] | readonly T[] {
  if (
    prev.length === next.length &&
    prev.every((p, i) => structurallyEqual(p, next[i]))
  ) {
    // Same length AND every position is structurally equal — reuse the
    // prior array reference so consumers' shallow-equality checks short-
    // circuit.
    return prev;
  }
  const prevByKey = new Map(prev.map((x) => [key(x), x]));
  return next.map((n) => {
    const p = prevByKey.get(key(n));
    return p !== undefined && structurallyEqual(p, n) ? p : n;
  });
}

function dedupeState(prev: StateResponse, next: StateResponse): StateResponse {
  const sessions = dedupeList<Session>(prev.sessions, next.sessions, (s) => s.id);
  const windows = dedupeList<Window>(prev.windows, next.windows, (w) => w.paneId);
  if (
    sessions === prev.sessions &&
    windows === prev.windows &&
    next.serverRunning === prev.serverRunning
  ) {
    return prev;
  }
  return {
    sessions: sessions as Session[],
    windows: windows as Window[],
    serverRunning: next.serverRunning,
  };
}

export async function fetchState(signal?: AbortSignal): Promise<StateResponse> {
  const headers: HeadersInit = {};
  if (lastEtag) headers["if-none-match"] = lastEtag;
  const r = await fetch(`${BASE}/state`, { headers, signal });
  if (r.status === 304 && lastState) return lastState;
  if (!r.ok) throw new Error(`state ${r.status}`);
  const etag = r.headers.get("etag");
  const body = (await r.json()) as StateResponse;
  const merged = lastState ? dedupeState(lastState, body) : body;
  if (etag) lastEtag = etag;
  lastState = merged;
  return merged;
}

export async function focusWindow(session: string, index: number): Promise<boolean> {
  const r = await fetch(
    `${BASE}/focus?session=${encodeURIComponent(session)}&index=${index}`,
    { method: "POST", headers: { ...csrfHeaders() } },
  );
  if (!r.ok) return false;
  const data = (await r.json()) as { focused: boolean };
  return data.focused;
}

export async function sendKeys(
  session: string,
  index: number,
  body: { keys?: string[]; paste?: string },
): Promise<boolean> {
  const r = await fetch(
    `${BASE}/send?session=${encodeURIComponent(session)}&index=${index}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(body),
    },
  );
  return r.ok;
}

/** Upload a clipboard image to a Claude Code agent pane. Resolves false on any
 *  non-2xx (415 unsupported type / 413 too large / 409 non-agent / 404). */
export async function pasteImage(
  session: string,
  index: number,
  blob: Blob,
): Promise<boolean> {
  const r = await fetch(
    `${BASE}/paste-image?session=${encodeURIComponent(session)}&index=${index}`,
    {
      method: "POST",
      headers: { "content-type": blob.type, ...csrfHeaders() },
      body: blob,
    },
  );
  return r.ok;
}

export async function renameWindow(
  session: string,
  index: number,
  name: string,
): Promise<boolean> {
  const r = await fetch(
    `${BASE}/rename?session=${encodeURIComponent(session)}&index=${index}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ name }),
    },
  );
  return r.ok;
}

/** kill-window for `session:index`. Resolves false on any non-2xx. */
export async function killWindow(session: string, index: number): Promise<boolean> {
  const r = await fetch(
    `${BASE}/window?session=${encodeURIComponent(session)}&index=${index}`,
    { method: "DELETE", headers: { ...csrfHeaders() } },
  );
  return r.ok;
}

/** kill-session for `session`. Resolves false on any non-2xx. */
export async function killSession(session: string): Promise<boolean> {
  const r = await fetch(
    `${BASE}/session?session=${encodeURIComponent(session)}`,
    { method: "DELETE", headers: { ...csrfHeaders() } },
  );
  return r.ok;
}

/** rename-session for `session`. Resolves false on any non-2xx (e.g. missing
 *  session or duplicate target name). */
export async function renameSession(session: string, name: string): Promise<boolean> {
  const r = await fetch(
    `${BASE}/rename-session?session=${encodeURIComponent(session)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ name }),
    },
  );
  return r.ok;
}

/** new-session for `name`. Resolves `"ok"` on success, `"in-use"` when tmux
 *  rejects the name as a duplicate (HTTP 409), or `"error"` otherwise. The
 *  in-use case is split so NewSessionOverlay can show a name-specific hint
 *  instead of a generic failure (THI-144). */
export async function createSession(name: string): Promise<"ok" | "in-use" | "error"> {
  const r = await fetch(
    `${BASE}/session?name=${encodeURIComponent(name)}`,
    { method: "POST", headers: { ...csrfHeaders() } },
  );
  if (r.ok) return "ok";
  if (r.status === 409) return "in-use";
  return "error";
}

/** new-window in `session`; resolves the new window's id, or null on failure. */
export async function createWindow(
  session: string,
  name: string,
): Promise<{ index: number; id: string } | null> {
  const r = await fetch(
    `${BASE}/window?session=${encodeURIComponent(session)}&name=${encodeURIComponent(name)}`,
    { method: "POST", headers: { ...csrfHeaders() } },
  );
  if (!r.ok) return null;
  const data = (await r.json()) as { index: number; id: string };
  return { index: data.index, id: data.id };
}

/** Create a new window and, in `claude` mode, type `claude⏎` into it so
 *  Claude Code boots automatically. Used by the kanban's quick-create buttons
 *  (THI-115). Resolves the new window id, or null on failure.
 *
 *  Race note: the shell that backs the new window buffers stdin into its pty
 *  before its prompt is drawn, so the queued `claude\n` reaches it as soon as
 *  the prompt is ready — no client-side sleep needed. If `sendKeys` fails
 *  (network blip, etc.) we still leave the empty window behind: the user can
 *  type `claude` themselves. */
export async function createWindowWithBoot(
  session: string,
  mode: "shell" | "claude",
): Promise<{ index: number; id: string } | null> {
  const win = await createWindow(session, mode);
  if (!win) return null;
  if (mode === "claude") {
    // Fire-and-forget the autotype; a failed sendKeys shouldn't roll back the
    // window creation, just leave an empty shell the user can type into.
    void sendKeys(session, win.index, { paste: "claude", keys: ["Enter"] });
  }
  return win;
}

// --- Auto-rename modal (THI-67) -------------------------------------------

/** Tagged-union result so the modal can distinguish "key not set" (503) from
 *  "model returned garbage" (502) and surface a useful CTA per case, instead
 *  of collapsing every non-2xx into a single error string. */
export type AutoRenameResult =
  | { ok: true; data: AutoRenameResponse }
  | { ok: false; status: number; error: string };

async function readAutoRenameError(r: Response, status: number): Promise<string> {
  try {
    const body = (await r.json()) as { detail?: string };
    return body.detail ?? `HTTP ${status}`;
  } catch {
    return `HTTP ${status}`;
  }
}

export async function fetchAiStatus(): Promise<AiStatus> {
  const r = await fetch(`${BASE}/auto-rename/status`);
  if (!r.ok) throw new Error(`auto-rename status ${r.status}`);
  return (await r.json()) as AiStatus;
}

export async function autoRenameSession(session: string): Promise<AutoRenameResult> {
  const r = await fetch(
    `${BASE}/auto-rename-session?session=${encodeURIComponent(session)}`,
    { method: "POST", headers: { ...csrfHeaders() } },
  );
  if (!r.ok) return { ok: false, status: r.status, error: await readAutoRenameError(r, r.status) };
  return { ok: true, data: (await r.json()) as AutoRenameResponse };
}

export async function autoRenameWindow(
  session: string,
  index: number,
): Promise<AutoRenameResult> {
  const r = await fetch(
    `${BASE}/auto-rename-window?session=${encodeURIComponent(session)}&index=${index}`,
    { method: "POST", headers: { ...csrfHeaders() } },
  );
  if (!r.ok) return { ok: false, status: r.status, error: await readAutoRenameError(r, r.status) };
  return { ok: true, data: (await r.json()) as AutoRenameResponse };
}

/** detach-client for a specific client tty. Resolves false on any non-2xx. */
export async function detachClient(tty: string): Promise<boolean> {
  const r = await fetch(`${BASE}/detach?tty=${encodeURIComponent(tty)}`, {
    method: "POST",
    headers: { ...csrfHeaders() },
  });
  return r.ok;
}

/** One-shot pane snapshot — used by the terminal modal when live streaming
 *  is disabled in settings. */
export async function fetchPane(
  session: string,
  index: number,
  lines = 500,
): Promise<string[]> {
  const r = await fetch(
    `${BASE}/pane?session=${encodeURIComponent(session)}&index=${index}&lines=${lines}`,
  );
  if (!r.ok) return [];
  const data = (await r.json()) as { lines: string[] };
  return data.lines;
}

// Claude rolling-window usage — small, no ETag (response changes every poll
// anyway; the saved bandwidth doesn't pay for the ETag round-trip overhead).
// Polled on a slower 30 s cadence than `/api/state`; see App.tsx (THI-110).
export async function fetchUsage(signal?: AbortSignal): Promise<UsageResponse> {
  const r = await fetch(`${BASE}/usage`, { signal });
  if (!r.ok) throw new Error(`usage ${r.status}`);
  return (await r.json()) as UsageResponse;
}

/** Read-only config knobs for the Claude usage pill — surfaced in the
 *  Settings panel (THI-110 commit 3). One-shot fetch; no polling. */
export async function fetchUsageConfig(): Promise<UsageConfig> {
  const r = await fetch(`${BASE}/usage/config`);
  if (!r.ok) throw new Error(`usage config ${r.status}`);
  return (await r.json()) as UsageConfig;
}

/** One probed entry in IdeConfig.available — drives the Settings dropdown
 *  (THI-146 PR 4). `id` is the launcher binary (must be in the backend's
 *  IDE_ALLOWLIST); `label` is the human-readable name. */
export interface AvailableIde {
  id: string;
  label: string;
}

/** Read-only IDE launcher config — drives whether the file-path linkifier
 *  inside TerminalModal renders code paths as clickable links (THI-146
 *  PR 3) and the "Open in IDE" dropdown in Settings (PR 4). One-shot at
 *  app mount; the launcher is env-controlled so it doesn't change during a
 *  session, and `available` is cached server-side after the first probe. */
export interface IdeConfig {
  enabled: boolean;
  /** Same value as `default`, retained for backward compat with PR 3 callers. */
  command: string | null;
  allowed: string[];
  /** Probed-and-installed editors, in stable order — render directly into
   *  the dropdown. Empty when no known editor is on PATH. */
  available: AvailableIde[];
  /** What /api/open uses when no `ide` param is sent. Mirrors `command`. */
  default: string | null;
}
export async function fetchIdeConfig(): Promise<IdeConfig> {
  const r = await fetch(`${BASE}/ide-config`);
  if (!r.ok) throw new Error(`ide config ${r.status}`);
  return (await r.json()) as IdeConfig;
}

/** Open a file from a pane's cwd in an IDE. When `ide` is provided, the
 *  backend uses that binary instead of its env-var default (subject to the
 *  allowlist). Resolves a discrete status so the caller can surface the
 *  right toast — `disabled` (server has no IDE configured, or `ide` is not
 *  on the allowlist), `not-found` (path doesn't resolve to a file),
 *  `escaped` (path resolved outside the pane's cwd — almost certainly a
 *  linkifier bug), or `error` for anything else. */
export async function openInIde(
  session: string,
  index: number,
  path: string,
  ide?: string,
): Promise<"ok" | "disabled" | "not-found" | "escaped" | "error"> {
  let url = `${BASE}/open?session=${encodeURIComponent(session)}&index=${index}&path=${encodeURIComponent(path)}`;
  if (ide) url += `&ide=${encodeURIComponent(ide)}`;
  const r = await fetch(url, { method: "POST", headers: { ...csrfHeaders() } });
  if (r.ok) return "ok";
  if (r.status === 400) return "disabled";
  if (r.status === 404) return "not-found";
  if (r.status === 422) return "escaped";
  return "error";
}

export function openPaneWS(session: string, index: number): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${proto}://${window.location.host}/ws/pane?session=${encodeURIComponent(session)}&index=${index}`,
  );
  // Without this, the browser delivers each ws.send_bytes() chunk as a Blob
  // — TerminalModal's `instanceof ArrayBuffer` check then drops them and the
  // pane never paints after the initial snapshot.
  ws.binaryType = "arraybuffer";
  return ws;
}
