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
 * Known limitation — 256-color / true-color escapes pass through
 * unchanged. xterm.js's `ITheme` only exposes slots 0–15. TUIs that
 * emit `\e[48;5;Nm` (256-color bg) or `\e[48;2;R;G;Bm` (24-bit bg)
 * bypass this palette entirely; the renderer paints whatever absolute
 * color the escape sequence requested. In practice that means:
 *
 *   - Claude Code's diff backgrounds (dark red / dark green) and
 *     "user prompt" inverse blocks render with their hard-coded
 *     dark RGBs even when the surrounding Switchboard theme is light.
 *   - `git diff --color=always | less -R` likewise — git uses
 *     256-color for diff highlights on modern terminals.
 *   - `bat`, `delta`, `lazygit`, etc. — same story.
 *
 * The minimumContrastRatio safety net does NOT lift these (it only
 * rebalances ANSI 16 fg/bg pairs). Resolving this would require
 * intercepting the renderer's color resolution path, which is xterm
 * internal API and version-fragile. Not in scope here; tracked in
 * THI-153 follow-ups.
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
