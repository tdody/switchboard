import { useEffect, useState } from "react";

/**
 * Returns `true` while the user is actively typing into a text input or
 * textarea. Drives the input-active backoff in `pickPollInterval` so the
 * /api/state cadence yields to keystrokes (THI-138).
 *
 * "Actively typing" = a keydown landed on a text input within the last
 * `decayMs`. The decay timer resets on every keydown, so a steady stream
 * of typing keeps the flag pinned high; a 800 ms pause flips it back
 * to false and the normal polling cadence resumes.
 *
 * Listens at the document level so the hook works regardless of which
 * input the user is focused on (palette / settings / send-keys / rename
 * — all benefit). xterm's textarea is intentionally excluded: it sets
 * `data-xterm-helper-textarea` (or sits inside `.xterm-helper-textarea`)
 * and pane input doesn't go through React anyway.
 */
export function useInputActive(decayMs = 800): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const isTypingTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      // Skip xterm's hidden helper textarea — pane typing doesn't compete
      // with the React render path, and tagging it active would back off
      // the cadence every time the user touches the terminal.
      if (t.closest(".xterm-helper-textarea, .xterm")) return false;
      const tag = t.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "INPUT") {
        const type = (t as HTMLInputElement).type;
        // The textual <input> types — `text`, `search`, `email`, `url`,
        // `password`, `tel`, plus the default (no `type` attr).
        return (
          type === "" ||
          type === "text" ||
          type === "search" ||
          type === "email" ||
          type === "url" ||
          type === "password" ||
          type === "tel"
        );
      }
      // contentEditable elements (none in the app today, but cheap to
      // future-proof — rich text editors would benefit identically).
      return t.isContentEditable;
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (!isTypingTarget(e.target)) return;
      setActive(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(false), decayMs);
    };

    document.addEventListener("keydown", onKeydown, { capture: true });
    return () => {
      document.removeEventListener("keydown", onKeydown, { capture: true });
      window.clearTimeout(timer);
    };
  }, [decayMs]);

  return active;
}
