import { describe, expect, it } from "vitest";

import { xtermThemeFor } from "./xtermThemes";

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
