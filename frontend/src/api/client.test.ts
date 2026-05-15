import { afterEach, describe, expect, it, vi } from "vitest";
import { pasteImage } from "./client";

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
