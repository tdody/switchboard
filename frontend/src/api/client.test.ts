import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetFetchStateCache,
  createSession,
  createWindowWithBoot,
  fetchIdeConfig,
  fetchState,
  openInIde,
  openPaneWS,
  pasteImage,
} from "./client";
import type { StateResponse, Window } from "../types";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "sb_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

describe("pasteImage", () => {
  it("POSTs the blob with its content-type and the CSRF header", async () => {
    document.cookie = "sb_csrf=tok-123";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const ok = await pasteImage("dev", 2, blob);

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/paste-image?session=dev&index=2");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("image/png");
    expect(init.headers["x-csrf-token"]).toBe("tok-123");
    expect(init.body).toBe(blob);
  });

  it("resolves false on a non-2xx response", async () => {
    document.cookie = "sb_csrf=tok-123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    expect(await pasteImage("dev", 2, blob)).toBe(false);
  });
});

describe("createWindowWithBoot", () => {
  it("creates the window and autotypes `claude\\n` in claude mode", async () => {
    document.cookie = "sb_csrf=tok-abc";
    // Two-arg signature so `mock.calls` is typed `[url, init?]` — needed
    // for the `sendCall[1].body` assertion below. CI's stricter tsc rejects
    // a 1-arg signature here (TS2493 / TS2532).
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.startsWith("/api/window")) {
        return {
          ok: true,
          json: async () => ({ index: 7, id: "dev:7" }),
        } as Response;
      }
      if (url.startsWith("/api/send")) {
        return { ok: true } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const win = await createWindowWithBoot("dev", "claude");
    expect(win).toEqual({ index: 7, id: "dev:7" });

    // The two fetches: POST /api/window?…&name=claude then POST /api/send.
    const calls = fetchMock.mock.calls.map(([u]) => u);
    expect(calls[0]).toBe("/api/window?session=dev&name=claude");
    // sendKeys is fire-and-forget but should have been issued synchronously.
    // Allow the microtask to drain so the void-awaited send resolves.
    await Promise.resolve();
    expect(calls).toContain("/api/send?session=dev&index=7");
    const sendCall = fetchMock.mock.calls.find(([u]) => u.startsWith("/api/send"));
    expect(sendCall).toBeDefined();
    expect(JSON.parse(sendCall![1]!.body as string)).toEqual({
      paste: "claude",
      keys: ["Enter"],
    });
  });

  it("creates the window WITHOUT a follow-up sendKeys in shell mode", async () => {
    document.cookie = "sb_csrf=tok-abc";
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ index: 9, id: "dev:9" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const win = await createWindowWithBoot("dev", "shell");
    expect(win).toEqual({ index: 9, id: "dev:9" });
    // Only the createWindow call — no auto-type for shells.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/window?session=dev&name=shell");
  });

  it("returns null when the createWindow call fails (and never sends keys)", async () => {
    document.cookie = "sb_csrf=tok-abc";
    const fetchMock = vi.fn(async (_url: string) => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock);

    const win = await createWindowWithBoot("dev", "claude");
    expect(win).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the failed createWindow
  });
});

describe("createSession", () => {
  it("POSTs /api/session with the name and CSRF header, resolves 'ok' on 2xx", async () => {
    document.cookie = "sb_csrf=tok-abc";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createSession("my-feat");

    expect(result).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/session?name=my-feat");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("tok-abc");
  });

  it("resolves 'in-use' on 409 so the overlay can show a name-specific hint", async () => {
    document.cookie = "sb_csrf=tok-abc";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    expect(await createSession("dev")).toBe("in-use");
  });

  it("resolves 'error' on any other non-2xx", async () => {
    document.cookie = "sb_csrf=tok-abc";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await createSession("dev")).toBe("error");
  });

  // THI-244: callers can pass a cwd; client should body-encode it as JSON so
  // the backend's CwdBody validator picks it up.
  it("sends the cwd as a JSON body when provided", async () => {
    document.cookie = "sb_csrf=tok-abc";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await createSession("my-feat", "/Users/me/dev/foo");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ cwd: "/Users/me/dev/foo" }));
  });

  it("omits the body and content-type header when no cwd is passed", async () => {
    document.cookie = "sb_csrf=tok-abc";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await createSession("my-feat");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers["content-type"]).toBeUndefined();
  });
});

describe("fetchIdeConfig + openInIde", () => {
  it("fetchIdeConfig surfaces the read-only IDE launcher state", async () => {
    // PR 4 shape: `available` is the probed dropdown, `default` mirrors
    // `command` for backwards compat with PR 3 callers.
    const body = {
      enabled: true,
      command: "code",
      default: "code",
      allowed: ["code", "cursor"],
      available: [
        { id: "code", label: "Visual Studio Code" },
        { id: "cursor", label: "Cursor" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => body }),
    );
    const cfg = await fetchIdeConfig();
    expect(cfg).toEqual(body);
  });

  it("openInIde POSTs to /api/open with session/index/path + CSRF header", async () => {
    document.cookie = "sb_csrf=tok-xyz";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await openInIde("dev", 2, "src/foo.py");
    expect(result).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/open?session=dev&index=2&path=src%2Ffoo.py");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("tok-xyz");
  });

  it("openInIde forwards the chosen `ide` as a query param (THI-146 PR 4)", async () => {
    // Settings dropdown stores the user's pick; TerminalModal passes it
    // through here so a per-user choice overrides the server-side default.
    document.cookie = "sb_csrf=tok-xyz";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await openInIde("dev", 2, "src/foo.py", "cursor");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/open?session=dev&index=2&path=src%2Ffoo.py&ide=cursor");
  });

  it("openInIde omits `ide` when not supplied (server uses default)", async () => {
    document.cookie = "sb_csrf=tok-xyz";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await openInIde("dev", 2, "src/foo.py");
    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain("ide=");
  });

  it("openInIde maps 400/404/422 to discrete status strings", async () => {
    document.cookie = "sb_csrf=tok-xyz";
    for (const [status, expected] of [
      [400, "disabled"],
      [404, "not-found"],
      [422, "escaped"],
      [500, "error"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
      expect(await openInIde("dev", 0, "x.py")).toBe(expected);
    }
  });
});

describe("openPaneWS", () => {
  // The browser default binaryType is "blob"; with that default, the
  // backend's pipe-pane stream (sent via ws.send_bytes) arrives as a Blob
  // and the TerminalModal's `instanceof ArrayBuffer` check silently drops
  // every chunk — leaving the modal's xterm blank while keystrokes still
  // reach tmux. Pinning "arraybuffer" is what makes the round-trip render.
  it('sets binaryType to "arraybuffer" so streamed pane bytes render', () => {
    const created: { url: string; binaryType: string }[] = [];
    class FakeWS {
      url: string;
      binaryType = "blob";
      constructor(url: string) {
        this.url = url;
        created.push(this);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWS);

    const ws = openPaneWS("dev", 2);

    expect(ws.binaryType).toBe("arraybuffer");
    expect(created[0].url).toMatch(/\/ws\/pane\?session=dev&index=2$/);
  });
});

// ---------------------------------------------------------------------------
// THI-185: stabilize /api/state response identity at the polling layer
// ---------------------------------------------------------------------------

function makeWindow(overrides: Partial<Window>): Window {
  return {
    id: `${overrides.session ?? "main"}:${overrides.index ?? 0}`,
    paneId: "%1",
    session: "main",
    index: 0,
    name: "shell",
    kind: "shell",
    status: "idle",
    lastActivity: 1_700_000_000,
    cpu: 0,
    mem: 0,
    cmd: "zsh",
    cwd: "/Users/test",
    pendingInput: false,
    branch: null,
    pr: null,
    prUrl: null,
    ci: null,
    repoUrl: null,
    repoKey: null,
    repoLabel: null,
    agent: null,
    preview: [],
    ...overrides,
  };
}

function makeState(windows: Window[]): StateResponse {
  return {
    sessions: [
      { id: "main", name: "main", attached: true, created: 0, clients: [] },
    ],
    windows,
    serverRunning: true,
  };
}

function mockStateResponse(body: StateResponse, etag: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === "etag" ? etag : null) },
    json: async () => body,
  } as unknown as Response;
}

describe("fetchState referential stability (THI-185)", () => {
  beforeEach(() => {
    _resetFetchStateCache();
  });

  it("reuses window references for windows whose content is unchanged across polls", async () => {
    const baseWindows = [
      makeWindow({ paneId: "%1", index: 0, status: "idle" }),
      makeWindow({ paneId: "%2", index: 1, status: "idle" }),
      makeWindow({ paneId: "%3", index: 2, status: "idle" }),
    ];
    const firstBody = makeState(baseWindows);
    // Only the middle window flipped — the backend re-serializes the whole
    // state (fresh array refs all the way down), but the FE should detect
    // the unchanged tiles and keep the prior references for them.
    const secondBody = makeState([
      makeWindow({ paneId: "%1", index: 0, status: "idle" }),
      makeWindow({ paneId: "%2", index: 1, status: "running" }),
      makeWindow({ paneId: "%3", index: 2, status: "idle" }),
    ]);

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? mockStateResponse(firstBody, '"v1"')
          : mockStateResponse(secondBody, '"v2"');
      }),
    );

    const state1 = await fetchState();
    const state2 = await fetchState();

    expect(state2.windows[0]).toBe(state1.windows[0]);
    expect(state2.windows[1]).not.toBe(state1.windows[1]);
    expect(state2.windows[2]).toBe(state1.windows[2]);
  });

  it("reuses the windows array when every window is unchanged", async () => {
    // The backend issued a new etag (so fetchState parses a fresh body), but
    // the content is byte-identical to the prior poll. The FE should detect
    // this and reuse the previous array reference, not return a fresh
    // top-level identity — keeps memoized children from re-rendering.
    const windows = [
      makeWindow({ paneId: "%1", index: 0 }),
      makeWindow({ paneId: "%2", index: 1 }),
    ];
    const firstBody = makeState(windows);
    const secondBody = makeState([
      makeWindow({ paneId: "%1", index: 0 }),
      makeWindow({ paneId: "%2", index: 1 }),
    ]);

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? mockStateResponse(firstBody, '"v1"')
          : mockStateResponse(secondBody, '"v2"');
      }),
    );

    const state1 = await fetchState();
    const state2 = await fetchState();

    expect(state2.windows).toBe(state1.windows);
    expect(state2).toBe(state1);
  });

  it("returns a fresh windows array when a window is added or removed", async () => {
    // Pane killed: list length changed, prior reference cannot be reused.
    const firstBody = makeState([
      makeWindow({ paneId: "%1", index: 0 }),
      makeWindow({ paneId: "%2", index: 1 }),
    ]);
    const secondBody = makeState([
      makeWindow({ paneId: "%1", index: 0 }),
    ]);

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? mockStateResponse(firstBody, '"v1"')
          : mockStateResponse(secondBody, '"v2"');
      }),
    );

    const state1 = await fetchState();
    const state2 = await fetchState();

    expect(state2.windows).not.toBe(state1.windows);
    expect(state2.windows).toHaveLength(1);
    // The surviving pane still reuses its prior reference.
    expect(state2.windows[0]).toBe(state1.windows[0]);
  });
});
