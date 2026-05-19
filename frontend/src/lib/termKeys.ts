/** Window (ms) within which a second Esc closes the modal instead of being
 *  forwarded to the pane. */
const DOUBLE_ESC_MS = 400;

/**
 * Decide what an Esc keypress should do. `"close"` when it falls within
 * DOUBLE_ESC_MS of the previous Esc (a deliberate double-press); otherwise
 * `"send"` — forward a literal Esc to the pane. A `lastEsc` of 0 (no prior
 * press) always yields `"send"`.
 */
export function escAction(now: number, lastEsc: number): "send" | "close" {
  return now - lastEsc <= DOUBLE_ESC_MS ? "close" : "send";
}

/**
 * Map a Cmd-combo to the control bytes to forward to the pane, or `null` when
 * the event is not a handled combo. Accepts a structural subset of
 * KeyboardEvent so it is trivially unit-testable.
 */
export function comboBytes(e: { metaKey: boolean; key: string }): string | null {
  if (!e.metaKey) return null;
  switch (e.key) {
    case "Backspace":
      return "\x15"; // Ctrl-U — kill line backward
    case "Delete":
      return "\x0b"; // Ctrl-K — kill line forward
    case "ArrowLeft":
      return "\x01"; // Ctrl-A — line start
    case "ArrowRight":
      return "\x05"; // Ctrl-E — line end
    default:
      return null;
  }
}

/**
 * Map an Enter keypress to the bytes to forward to the pane, or `null` when
 * the event should fall through to xterm's default. We only own the bare
 * Shift+Enter case — it becomes ESC + CR, the Option/Alt+Enter convention
 * that Claude Code (Ink) interprets as an in-prompt newline; plain CR would
 * submit. xterm.js emits CR for both Enter and Shift+Enter by default, so
 * without this translation Shift+Enter would commit the prompt.
 */
export function newlineBytes(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): string | null {
  if (e.key !== "Enter") return null;
  if (!e.shiftKey) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return "\x1b\r";
}
