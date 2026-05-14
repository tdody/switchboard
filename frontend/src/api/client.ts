import type { StateResponse } from "../types";

const BASE = "/api";

// Module-scoped ETag + cached state so 304 responses reuse the prior body.
let lastEtag: string | null = null;
let lastState: StateResponse | null = null;

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
    { method: "POST" },
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  return r.ok;
}

export function openPaneWS(session: string, index: number): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(
    `${proto}://${window.location.host}/ws/pane?session=${encodeURIComponent(session)}&index=${index}`,
  );
}
