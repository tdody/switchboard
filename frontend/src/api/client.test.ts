import { afterEach, describe, expect, it, vi } from "vitest";
import { createWindowWithBoot, openPaneWS, pasteImage } from "./client";

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
