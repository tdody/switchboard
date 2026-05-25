import type { StateResponse, UsageConfig, UsageResponse } from "../types";

const BASE = "/api";

// Module-scoped ETag + cached state so 304 responses reuse the prior body.
let lastEtag: string | null = null;
let lastState: StateResponse | null = null;

// The backend issues a readable `sb_csrf` cookie on the first GET. Mutating
// requests must echo it back in the X-CSRF-Token header (double-submit). A
// cross-origin attacker can't read the cookie, so can't forge the header.
function csrfHeaders(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)sb_csrf=([^;]+)/);
  return m ? { "x-csrf-token": decodeURIComponent(m[1]) } : {};
}

export async function fetchState(signal?: AbortSignal): Promise<StateResponse> {
  const headers: HeadersInit = {};
  if (lastEtag) headers["if-none-match"] = lastEtag;
  const r = await fetch(`${BASE}/state`, { headers, signal });
  if (r.status === 304 && lastState) return lastState;
  if (!r.ok) throw new Error(`state ${r.status}`);
  const etag = r.headers.get("etag");
  const body = (await r.json()) as StateResponse;
  if (etag) lastEtag = etag;
  lastState = body;
  return body;
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
