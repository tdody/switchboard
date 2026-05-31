import { describe, expect, it } from "vitest";

import { XtermStreamRewriter } from "./xtermStreamRewriter";

function encode(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
function decode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

describe("XtermStreamRewriter", () => {
  it("no-op for dark theme", () => {
    const r = new XtermStreamRewriter("dark");
    const input = encode("\x1b[48;2;58;14;16mHELLO\x1b[0m");
    expect(decode(r.rewriteBytes(input))).toBe(decode(input));
  });

  it("no-op for phosphor theme", () => {
    const r = new XtermStreamRewriter("phosphor");
    const input = encode("\x1b[48;2;58;14;16mHELLO\x1b[0m");
    expect(decode(r.rewriteBytes(input))).toBe(decode(input));
  });

  it("rewrites dark-red diff bg to pastel red in light theme", () => {
    const r = new XtermStreamRewriter("light");
    // (58, 14, 16) — the empirical color Claude Code paints diff-removed bgs
    const input = encode("\x1b[48;2;58;14;16m- old line\x1b[0m");
    const out = decode(r.rewriteBytes(input));
    expect(out).toContain("\x1b[48;2;245;214;214m"); // pastel red #f5d6d6
    expect(out).not.toContain("\x1b[48;2;58;14;16m");
    // Content after the escape is preserved
    expect(out).toContain("- old line");
  });

  it("rewrites dark-green diff bg to pastel green in light theme", () => {
    const r = new XtermStreamRewriter("light");
    const input = encode("\x1b[48;2;14;58;30m+ new line\x1b[0m");
    const out = decode(r.rewriteBytes(input));
    expect(out).toContain("\x1b[48;2;205;230;205m"); // pastel green #cde6cd
    expect(out).toContain("+ new line");
  });

  it("rewrites dark-grey inverse block bg to cream in light theme", () => {
    const r = new XtermStreamRewriter("light");
    // (30, 30, 36) — typical channel-balanced dark grey for user-prompt blocks
    const input = encode("\x1b[48;2;30;30;36mUser message\x1b[0m");
    const out = decode(r.rewriteBytes(input));
    expect(out).toContain("\x1b[48;2;240;238;232m"); // cream #f0eee8
  });

  it("leaves bright/saturated truecolor bgs alone (only rewrites dark fills)", () => {
    const r = new XtermStreamRewriter("light");
    // Mid-tone yellow bg used as a warning highlight — keep it
    const input = encode("\x1b[48;2;180;160;40mWARN\x1b[0m");
    const out = decode(r.rewriteBytes(input));
    expect(out).toBe(decode(input));
  });

  it("leaves foreground truecolor (38;2;…) alone", () => {
    const r = new XtermStreamRewriter("light");
    const input = encode("\x1b[38;2;58;14;16mdim red text\x1b[0m");
    const out = decode(r.rewriteBytes(input));
    expect(out).toBe(decode(input));
  });

  it("buffers a partial truecolor escape across chunk boundaries", () => {
    const r = new XtermStreamRewriter("light");
    // Split mid-escape: first chunk ends at `\x1b[48;2;58;14`, second
    // chunk has the rest. Naive regex would miss the rewrite without
    // the cross-chunk tail buffer.
    const a = r.rewriteBytes(encode("\x1b[48;2;58;14"));
    const b = r.rewriteBytes(encode(";16m- old line\x1b[0m"));
    // The partial chunk should emit nothing (buffered).
    expect(decode(a)).toBe("");
    // Combined output of the second chunk should have the rewrite applied.
    expect(decode(b)).toContain("\x1b[48;2;245;214;214m");
    expect(decode(b)).toContain("- old line");
  });

  it("passes through non-ASCII bytes (emoji, box-drawing) unchanged", () => {
    const r = new XtermStreamRewriter("light");
    // Euro sign UTF-8 bytes [0xe2, 0x82, 0xac] + an unrelated escape
    const input = new Uint8Array([
      0x1b, 0x5b, 0x33, 0x32, 0x6d, // \x1b[32m (FG green ANSI 16 — no rewrite)
      0xe2, 0x82, 0xac, // €
      0x1b, 0x5b, 0x30, 0x6d, // \x1b[0m
    ]);
    const out = r.rewriteBytes(input);
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it("setTheme(light → dark) clears the partial buffer so the next chunk isn't mis-rewritten", () => {
    const r = new XtermStreamRewriter("light");
    r.rewriteBytes(encode("\x1b[48;2;58;14")); // buffered tail
    r.setTheme("dark");
    // Next chunk in dark mode should round-trip exactly, with no
    // dangling buffer corrupting the front.
    const out = r.rewriteBytes(encode(";16m- old line\x1b[0m"));
    expect(decode(out)).toBe(";16m- old line\x1b[0m");
  });

  it("does not buffer pathologically long incomplete escapes", () => {
    const r = new XtermStreamRewriter("light");
    // Long ESC-prefixed garbage with no terminator — must not grow
    // the buffer unboundedly. The rewriter caps at 64 chars.
    const input = encode("\x1b[" + "x".repeat(200));
    r.rewriteBytes(input);
    // Send a normal sequence next; if the buffer were stuck on the
    // garbage, the rewrite below would see the wrong leading bytes.
    const out = r.rewriteBytes(encode("\x1b[48;2;58;14;16mtest\x1b[0m"));
    expect(decode(out)).toContain("\x1b[48;2;245;214;214m");
    expect(decode(out)).toContain("test");
  });

  it("rewriteString matches rewriteBytes semantics", () => {
    const r1 = new XtermStreamRewriter("light");
    const r2 = new XtermStreamRewriter("light");
    const input = "\x1b[48;2;30;30;36mUser\x1b[0m";
    expect(decode(r1.rewriteBytes(encode(input)))).toBe(r2.rewriteString(input));
  });
});
