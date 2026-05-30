/**
 * xterm.js ANSI palettes, one per Switchboard `Theme` (THI-153).
 *
 * xterm carries its own 16-color ANSI palette + background/foreground —
 * not driven by the `--panel` / `--text` CSS tokens that the rest of the
 * dashboard uses. Pre-THI-153 every Switchboard theme rendered the
 * terminal modal with Ghostty's Tomorrow Night palette (dark grey bg,
 * pastel ANSI). The colors were fine on dark, but blue/cyan/yellow on
 * a near-white bg in light theme would have failed WCAG AA the moment
 * we ever flipped the background to match.
 *
 * Each palette ships explicit values for every ANSI slot; xterm's
 * `minimumContrastRatio: 4.5` (set in TerminalModal) acts as a
 * safety net for any palette/bg combination that drifts under the AA
 * bar, but the tuned values keep the auto-lifting from kicking in
 * during normal use (auto-lift makes hues look washed-out).
 *
 * Subscription: `TerminalModal` reads `useSettings().theme` and
 * applies the matching palette on mount; a separate effect updates
 * `term.options.theme` when the theme changes mid-modal so the user
 * can toggle Switchboard's theme without closing the pane.
 *
 * 256-color overrides — TUIs like Claude Code paint diff backgrounds
 * and "user prompt" inverse blocks with 256-color escapes (`\e[48;5;Nm`),
 * which xterm's `ITheme` doesn't cover (it's limited to ANSI 16). We
 * compensate via the standard `OSC 4 ; N ; rgb:RR/GG/BB ST` sequence —
 * xterm.js's OSC handler accepts these at runtime and re-paints already-
 * rendered cells with the new palette. `apply256ColorOverrides` below
 * sends a packet of OSC 4s for the slots that show up as background fill
 * in modern dev TUIs (52/88/22/28 = the dark-red / dark-green diff bgs;
 * 234–237 = the dark-grey "inverted block" range used by Claude Code's
 * user-message blocks). In dark mode we send the standard xterm defaults
 * back so a theme toggle resets cleanly without an OSC 104 (which xterm
 * doesn't expose cleanly through its public API).
 *
 * True-color (`\e[48;2;R;G;Bm`) still passes through unchanged — that's
 * a hard limitation of the xterm 5.x renderer. If a future Claude Code
 * build switches to truecolor for diff bgs, we'd need to intercept the
 * parser's color resolution path. Not in scope here.
 */

import type { ITheme } from "xterm";

import type { Theme } from "./settings";

// ── DARK ────────────────────────────────────────────────────────────────────
// Tomorrow Night (Ghostty default). Reads like the user's own terminal.
const DARK: ITheme = {
  background: "#282c34",
  foreground: "#ffffff",
  cursor: "#ffffff",
  cursorAccent: "#282c34",
  selectionBackground: "#373b41",
  black: "#1d1f21",
  red: "#cc6666",
  green: "#b5bd68",
  yellow: "#f0c674",
  blue: "#81a2be",
  magenta: "#b294bb",
  cyan: "#8abeb7",
  white: "#c5c8c6",
  brightBlack: "#666666",
  brightRed: "#d54e53",
  brightGreen: "#b9ca4a",
  brightYellow: "#e7c547",
  brightBlue: "#7aa6da",
  brightMagenta: "#c397d8",
  brightCyan: "#70c0b1",
  brightWhite: "#eaeaea",
};

// ── LIGHT ───────────────────────────────────────────────────────────────────
// All ANSI hues tuned to clear AA 4.5:1 vs the white panel bg. Saturation
// stays high enough that ls/git colors still read as colored, not just
// "darker gray". Yellow is the hardest case (low intrinsic luminance on
// white) and lands as an olive — at WCAG-AA, true yellow is unreachable.
const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#1a1c1f",
  cursor: "#1a1c1f",
  cursorAccent: "#ffffff",
  selectionBackground: "#d6e3d6",
  black: "#1a1c1f",
  red: "#b3261e",
  green: "#2e6f3e",
  yellow: "#8a6a00",
  blue: "#1a55a0",
  magenta: "#9c2a87",
  cyan: "#0a6e80",
  white: "#5a606b",
  brightBlack: "#5a606b",
  brightRed: "#c63630",
  brightGreen: "#3a8a50",
  brightYellow: "#a08000",
  brightBlue: "#2768b5",
  brightMagenta: "#b13d9c",
  brightCyan: "#1a8595",
  brightWhite: "#1a1c1f",
};

// ── CONTRAST ────────────────────────────────────────────────────────────────
// Pure black bg, fully saturated primaries. Bright variants are pushed to
// max luminance so the two ramps remain visually distinct.
const CONTRAST: ITheme = {
  background: "#000000",
  foreground: "#ffffff",
  cursor: "#ffffff",
  cursorAccent: "#000000",
  selectionBackground: "#ffffff",
  black: "#000000",
  red: "#ff5050",
  green: "#50ff50",
  yellow: "#ffff50",
  blue: "#7090ff",
  magenta: "#ff70ff",
  cyan: "#50ffff",
  white: "#cccccc",
  brightBlack: "#666666",
  brightRed: "#ff8080",
  brightGreen: "#80ff80",
  brightYellow: "#ffff80",
  brightBlue: "#90b0ff",
  brightMagenta: "#ff90ff",
  brightCyan: "#80ffff",
  brightWhite: "#ffffff",
};

// ── PHOSPHOR ────────────────────────────────────────────────────────────────
// CRT green-on-green. The bg matches Switchboard's --panel; the ANSI ramp
// keeps real hues (so error/warning colors still register) but shifts
// every neutral toward the phosphor green so the overall feel stays
// consistent with the rest of the dashboard.
const PHOSPHOR: ITheme = {
  background: "#0a1d14",
  foreground: "#b5ffdc",
  cursor: "#5fffaf",
  cursorAccent: "#0a1d14",
  selectionBackground: "#1c4030",
  black: "#0a1d14",
  red: "#ff8080",
  green: "#80ffaf",
  yellow: "#f0d590",
  blue: "#80c0ff",
  magenta: "#d090d0",
  cyan: "#80f0d0",
  white: "#6cc59b",
  brightBlack: "#4a9070",
  brightRed: "#ffa0a0",
  brightGreen: "#a0ffc0",
  brightYellow: "#ffe5b0",
  brightBlue: "#a0d0ff",
  brightMagenta: "#e0a0e0",
  brightCyan: "#a0f5e0",
  brightWhite: "#b5ffdc",
};

const PALETTES: Record<Theme, ITheme> = {
  dark: DARK,
  light: LIGHT,
  contrast: CONTRAST,
  phosphor: PHOSPHOR,
};

export function xtermThemeFor(theme: Theme): ITheme {
  return PALETTES[theme] ?? PALETTES.dark;
}

// ── 256-color overrides (THI-150 follow-up) ──────────────────────────────────

/**
 * The 256-color slots we override per theme.
 *
 * Picked because they're the ones modern dev TUIs (Claude Code,
 * delta/diff renderers, lazygit) paint as block backgrounds:
 *
 *   - 22, 28          dark green / brighter green   → "added" diff bg
 *   - 52, 88          dark red / brighter red       → "removed" diff bg
 *   - 234, 235, 236, 237   #1c1c1c…#3a3a3a grayscale → "inverse block" bg
 *                                                     (user-prompt blocks
 *                                                     in Claude Code's TUI)
 *
 * Dark mode uses the standard xterm 256-color defaults so a theme
 * toggle reverts cleanly. (xterm.js doesn't expose OSC 104 cleanly so
 * we re-write the defaults rather than reset.)
 */
type IndexedOverrides = Record<number, string>;

const DARK_256: IndexedOverrides = {
  22: "#005f00",
  28: "#008700",
  52: "#5f0000",
  88: "#870000",
  234: "#1c1c1c",
  235: "#262626",
  236: "#303030",
  237: "#3a3a3a",
};

const LIGHT_256: IndexedOverrides = {
  // Diff highlight greens — pastel tints that read as "added" without
  // dominating a light page. Background of these slots holds the bg fill;
  // foreground text on top stays legible via minimumContrastRatio: 4.5.
  22: "#cde6cd",
  28: "#bcdcbc",
  // Diff highlight reds — pastel tints that read as "removed".
  52: "#f5d6d6",
  88: "#f0c5c5",
  // Dark-grey "inverse block" slots — Claude Code uses these for
  // user-message blocks. Mapped to light tints so the blocks read as
  // panels-on-light rather than dark stripes.
  234: "#f0eee8",
  235: "#ebe9df",
  236: "#e3e0d2",
  237: "#dcd8c8",
};

const CONTRAST_256: IndexedOverrides = {
  // Pure b/w theme — keep diff/block bgs as solid dark blocks for
  // maximum legibility against the white text.
  22: "#003000",
  28: "#005000",
  52: "#400000",
  88: "#600000",
  234: "#101010",
  235: "#181818",
  236: "#222222",
  237: "#2a2a2a",
};

const PHOSPHOR_256: IndexedOverrides = {
  // Green CRT theme — every block bg shifts toward green-tinted darks.
  22: "#003a14",
  28: "#005a20",
  52: "#3a0a0a",
  88: "#5a1010",
  234: "#0a2018",
  235: "#0e261c",
  236: "#142e22",
  237: "#1a3628",
};

const OVERRIDES_256: Record<Theme, IndexedOverrides> = {
  dark: DARK_256,
  light: LIGHT_256,
  contrast: CONTRAST_256,
  phosphor: PHOSPHOR_256,
};

/**
 * Write a packet of `OSC 4` sequences to the terminal that override
 * specific 256-color palette slots for the given theme.
 *
 * Apply on terminal construction AND on theme change; xterm.js re-paints
 * already-rendered cells with the new palette on the next frame.
 */
export function apply256ColorOverrides(
  // Narrowed structurally to avoid a hard `Terminal` import; the caller
  // already has one.
  term: { write(data: string): void },
  theme: Theme,
): void {
  const overrides = OVERRIDES_256[theme] ?? DARK_256;
  let seq = "";
  for (const [index, hex] of Object.entries(overrides)) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) continue;
    // ESC ] 4 ; N ; rgb:RR/GG/BB BEL — the BEL (`\x07`) terminator is
    // the form xterm.js parses most reliably across versions.
    seq += `\x1b]4;${index};rgb:${m[1]}/${m[2]}/${m[3]}\x07`;
  }
  if (seq) term.write(seq);
}
