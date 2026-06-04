/**
 * Truecolor-background escape rewriter for theme parity (THI-150).
 *
 * xterm.js's `ITheme` covers ANSI 16. OSC 4 (in xtermThemes.ts)
 * extends coverage to specific 256-color slots. Neither reaches
 * truecolor escapes (`\e[48;2;R;G;Bm`), which encode absolute RGB
 * values directly. Modern Claude Code builds paint diff backgrounds
 * and "user prompt" inverse blocks with truecolor — those land as
 * dark stripes when the surrounding Switchboard theme is light.
 *
 * Strategy: intercept the WebSocket byte stream before it reaches
 * `term.write()`, scan for `\e[48;2;R;G;Bm` patterns, and rewrite
 * the RGB triple to a light-theme-appropriate tint when the bg is
 * a dark fill (low total luminance + the channel-balance signature
 * of red/green/grey). Foreground (`38;2;…`) and other truecolor
 * uses pass through unchanged — we only touch backgrounds, and only
 * when the source RGB is dark enough to be a "fill".
 *
 * Stateful: a half-arrived escape sequence at chunk boundary is
 * buffered and prepended to the next chunk so the regex always sees
 * the complete sequence. Each modal instance owns one rewriter.
 *
 * Limitation: already-rendered cells in the xterm scrollback keep
 * the original colors (xterm doesn't expose a "re-render with new
 * theme" API for truecolor cells). New data after the theme flip
 * gets the rewrite; old content scrolls out naturally.
 */

import type { Theme } from "./settings";

/**
 * The threshold below which we consider a truecolor bg "dark fill"
 * worth rewriting. Average channel < 60 catches every Claude Code /
 * delta / lazygit diff bg + Claude's user-prompt inverse blocks
 * observed in practice; above ~60 the color is usually a saturated
 * mid-tone the user actually wants (warning highlight, focus halo,
 * etc.) so we don't touch it.
 */
const DARK_FILL_LUM_THRESHOLD = 60;

/**
 * Pastel rewrites the rewriter emits for the three dark-fill shapes
 * Claude Code (and similar TUIs) use:
 *
 *   - "diff added"   — green-dominant dark   → pastel green tint
 *   - "diff removed" — red-dominant dark     → pastel red tint
 *   - "inverse block" — channel-balanced dark → cream/off-white
 *
 * Light-theme pastels match the 256-color overrides in xtermThemes.ts
 * so 256-color and truecolor diff bgs look the same. Contrast theme
 * keeps the original (we want hard distinction there).
 */
const LIGHT_PASTEL = {
  red: "\x1b[48;2;245;214;214m", // #f5d6d6
  green: "\x1b[48;2;205;230;205m", // #cde6cd
  cream: "\x1b[48;2;240;238;232m", // #f0eee8
} as const;

function remapDarkBg(r: number, g: number, b: number): string | null {
  const avg = (r + g + b) / 3;
  if (avg >= DARK_FILL_LUM_THRESHOLD) return null;

  // Dark grey: max - min < 25 catches channel-balanced colors. Hits
  // Claude's user-prompt inverse blocks (~(30, 30, 36)), xterm 256-color
  // slots 234-237 if a tool re-emits them as truecolor, and similar.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 25) return LIGHT_PASTEL.cream;
  // Channel dominance threshold: the dominant channel must lead the
  // others by ≥20. Catches Claude diff-removed (~(58, 14, 16)) and
  // diff-added (~(14, 58, 30)) plus the xterm slot 52/22 RGB triples.
  if (r > g + 20 && r > b + 20) return LIGHT_PASTEL.red;
  if (g > r + 20 && g > b + 20) return LIGHT_PASTEL.green;
  return null;
}

/**
 * Rewrites truecolor BG escapes in a stream of bytes for the active
 * theme. Buffers a half-arrived escape at the chunk tail so the next
 * call sees the full sequence.
 *
 * No-op (returns input unchanged) for dark and phosphor themes —
 * those keep the source palette intact.
 */
export class XtermStreamRewriter {
  private theme: Theme;
  private pendingTail = "";

  constructor(theme: Theme) {
    this.theme = theme;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    // Clear buffered tail when theme changes — partial escape that
    // arrived under the previous theme would be mis-rewritten if we
    // applied the new theme's rewrites to its leading bytes.
    this.pendingTail = "";
  }

  /**
   * Rewrite a Uint8Array chunk. Returns a new Uint8Array (or the
   * original if no rewrites apply).
   *
   * Decoding strategy: treat each byte as a Latin-1 codepoint so the
   * regex sees ASCII escape sequences cleanly without UTF-8 boundary
   * issues. Non-ASCII bytes pass through unchanged because their
   * codepoints (≥128) never match the regex and re-encode to the
   * same byte via `charCodeAt(i) & 0xff`.
   */
  rewriteBytes(input: Uint8Array): Uint8Array {
    if (this.theme === "dark" || this.theme === "phosphor") {
      return input;
    }
    let text = this.pendingTail;
    for (let i = 0; i < input.length; i++) text += String.fromCharCode(input[i]!);
    const processed = this.processAndBuffer(text);
    if (processed === text && this.pendingTail === "") {
      // No rewrite happened and nothing buffered — fast path.
      return input;
    }
    const out = new Uint8Array(processed.length);
    for (let i = 0; i < processed.length; i++) out[i] = processed.charCodeAt(i) & 0xff;
    return out;
  }

  /** String variant for the rare string-typed WebSocket path. */
  rewriteString(input: string): string {
    if (this.theme === "dark" || this.theme === "phosphor") return input;
    return this.processAndBuffer(this.pendingTail + input);
  }

  /**
   * Pull off the trailing partial escape sequence (if any), rewrite
   * the rest, and remember the tail for the next call.
   */
  private processAndBuffer(combined: string): string {
    let processable = combined;
    this.pendingTail = "";

    // Find any incomplete trailing escape. CSI escapes end on a
    // letter; OSC sequences end on BEL (`\x07`) or ST (`ESC \\`).
    const lastEsc = combined.lastIndexOf("\x1b");
    if (lastEsc >= 0) {
      const tail = combined.slice(lastEsc);
      const lastChar = tail.charCodeAt(tail.length - 1);
      const isCsiTerminator =
        (lastChar >= 0x40 && lastChar <= 0x7e) && // @ … ~
        lastChar !== 0x5b && // [
        lastChar !== 0x5d; // ]
      const isOscTerminator = tail.endsWith("\x07") || tail.endsWith("\x1b\\");
      if (!isCsiTerminator && !isOscTerminator) {
        // Don't buffer if the tail is suspiciously long — likely a
        // stray ESC byte that won't be completed, or our parser is
        // out of sync. Cut the loss at 64 chars.
        if (tail.length < 64) {
          this.pendingTail = tail;
          processable = combined.slice(0, lastEsc);
        }
      }
    }

    // THI-191: fast-path — if the processable slice has no truecolor bg
    // marker at all, skip the regex.replace entirely. The regex engine
    // still walks the whole string on a no-match call (allocating internal
    // match state along the way); `String.prototype.includes` is a tight
    // memchr-style scan with no allocation. The vast majority of WS chunks
    // (keystroke echoes, plain command output, etc.) carry no truecolor
    // bg escape, so this shortcuts the common case.
    if (!processable.includes("\x1b[48;2;")) {
      return processable;
    }
    return processable.replace(
      /\x1b\[48;2;(\d{1,3});(\d{1,3});(\d{1,3})m/g,
      (match, r, g, b) => {
        const ri = +r;
        const gi = +g;
        const bi = +b;
        if (ri > 255 || gi > 255 || bi > 255) return match;
        return remapDarkBg(ri, gi, bi) ?? match;
      },
    );
  }
}
