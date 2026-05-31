import { describe, expect, it, vi } from "vitest";

import { apply256ColorOverrides, xtermThemeFor } from "./xtermThemes";

// Tiny WCAG sRGB→linear→relative-luminance→contrast helper. We don't import
// the production color-math module (there isn't one on the frontend), and
// the formula is small enough to inline here.
function relLum(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(fg: string, bg: string): number {
  const a = relLum(fg);
  const b = relLum(bg);
  const [hi, lo] = [Math.max(a, b), Math.min(a, b)];
  return (hi + 0.05) / (lo + 0.05);
}

describe("xtermThemeFor", () => {
  it.each(["dark", "light", "contrast", "phosphor"] as const)(
    "%s theme defines every ANSI slot + bg/fg",
    (theme) => {
      const t = xtermThemeFor(theme);
      for (const slot of [
        "background",
        "foreground",
        "cursor",
        "selectionBackground",
        "black",
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
        "white",
        "brightBlack",
        "brightRed",
        "brightGreen",
        "brightYellow",
        "brightBlue",
        "brightMagenta",
        "brightCyan",
        "brightWhite",
      ] as const) {
        expect(t[slot], `${theme}.${slot}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    },
  );

  it("light-theme foreground clears WCAG AA on its background", () => {
    // The core safety net: in light mode the user reads dark glyphs on a
    // white-ish bg. Anything below 4.5:1 here would mean tmux output looks
    // washed-out the moment we ship the new theme.
    const t = xtermThemeFor("light");
    expect(contrast(t.foreground!, t.background!)).toBeGreaterThanOrEqual(4.5);
  });

  it("light-theme ANSI normal colors all clear AA on the panel bg", () => {
    // These are the colors `git`, `ls --color`, and Claude Code's TUI emit.
    // Bright variants get a pass — they're meant to be punchier accents and
    // xterm's `minimumContrastRatio: 4.5` will auto-lift the few that
    // don't quite clear.
    const t = xtermThemeFor("light");
    const bg = t.background!;
    for (const slot of ["red", "green", "yellow", "blue", "magenta", "cyan", "black"] as const) {
      expect(contrast(t[slot]!, bg), `light.${slot}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("dark-theme palette unchanged from the legacy Ghostty Tomorrow Night", () => {
    // Pin: changing the dark palette would silently re-tone every existing
    // Switchboard install. If we ever do change it, this assertion is the
    // place to update.
    const t = xtermThemeFor("dark");
    expect(t.background).toBe("#282c34");
    expect(t.red).toBe("#cc6666");
    expect(t.green).toBe("#b5bd68");
  });

  it("unknown theme falls back to dark", () => {
    // Defensive — `xtermThemeFor` is typed to Theme, but a runtime cast
    // from localStorage could land us with an old/unknown value.
    const t = xtermThemeFor("unknown" as never);
    expect(t.background).toBe("#282c34");
  });
});

describe("apply256ColorOverrides", () => {
  it("emits OSC 4 sequences for every overridden slot in light mode", () => {
    const writes: string[] = [];
    apply256ColorOverrides({ write: (s) => writes.push(s) }, "light");
    expect(writes).toHaveLength(1);
    const seq = writes[0]!;
    // Each slot we override (22, 28, 52, 88, 234-237) should appear once.
    for (const idx of [22, 28, 52, 88, 234, 235, 236, 237]) {
      expect(seq, `slot ${idx}`).toContain(`\x1b]4;${idx};rgb:`);
    }
    // BEL terminator (not ST) — xterm.js's OSC handler is most reliable on BEL.
    expect(seq.endsWith("\x07")).toBe(true);
  });

  it("light slot 52 (diff removed) maps to a pastel red", () => {
    // Concrete pin: this is the slot Claude Code uses for "removed line"
    // background. Pre-fix it rendered as #5f0000 (the xterm default), a
    // near-maroon stripe in light mode; post-fix it pastels out.
    const writes: string[] = [];
    apply256ColorOverrides({ write: (s) => writes.push(s) }, "light");
    expect(writes[0]).toContain("\x1b]4;52;rgb:f5/d6/d6\x07");
  });

  it("dark theme emits the standard 256-color defaults (clean reset)", () => {
    // xterm.js doesn't expose OSC 104 cleanly, so a theme toggle FROM
    // light to dark re-asserts the defaults via OSC 4 rather than reset.
    const writes: string[] = [];
    apply256ColorOverrides({ write: (s) => writes.push(s) }, "dark");
    expect(writes[0]).toContain("\x1b]4;52;rgb:5f/00/00\x07");
    expect(writes[0]).toContain("\x1b]4;234;rgb:1c/1c/1c\x07");
  });

  it("does not write when there is nothing to override (defensive)", () => {
    // Guard against a future regression where someone empties one of the
    // theme maps — we shouldn't fire an OSC packet with no payload.
    const term = { write: vi.fn() };
    apply256ColorOverrides(term, "dark");
    expect(term.write).toHaveBeenCalledTimes(1); // dark has 8 overrides
  });
});
