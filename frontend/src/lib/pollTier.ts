import type { Window } from "../types";

// Cadence used while at least one visible pane is `running` or `waiting`.
// Fast enough that "thinking…" adverbs and the spinner chip update promptly,
// slow enough that a five-pane dashboard doesn't issue a state request every
// 300 ms. The 500 ms modal-open cadence (in App.tsx) already covers the case
// where the user is watching a specific pane (THI-127).
export const ACTIVE_POLL_MS = 1000;

// Lower bound applied when the user is typing into a text input. The
// polling cadence is clamped to this even when modal-open or active-tier
// would normally pick a faster rate, so polling-driven re-renders yield
// the main thread to keystroke handling (THI-138). Decays back to the
// normal tier 800 ms after the last keydown — see `useInputActive`.
export const INPUT_ACTIVE_MIN_MS = 1500;

/**
 * Pure tier selector for the /api/state poll cadence. Pre-hydration / empty
 * window list falls through to the user-configured cadence so the first tick
 * fires at the expected rate. See the spec at
 * `docs/superpowers/specs/2026-05-25-thi-127-smart-refresh-rate.md` for the
 * full tier table.
 *
 * When `inputActive` is true (user is mid-burst of typing into a non-xterm
 * text input), the chosen interval is clamped to `INPUT_ACTIVE_MIN_MS` so
 * polling renders don't compete with keystroke handling (THI-138).
 */
export function pickPollInterval(
  hasOpenModal: boolean,
  windows: Window[],
  configured: number,
  modalOpenMs: number,
  inputActive: boolean = false,
): number {
  const base = (() => {
    if (hasOpenModal) return modalOpenMs;
    // No state yet (first tick) or zero panes: respect the user's
    // configured cadence rather than the idle slowdown, so a fresh load
    // doesn't wait 8 s.
    if (windows.length === 0) return configured;
    const active = windows.some(
      (w) => w.status === "running" || w.status === "waiting",
    );
    if (active) return ACTIVE_POLL_MS;
    // Idle tier: 2× configured with an 8 s floor. The floor matters for the
    // default-3000 user; the 2× matters for the user who explicitly set a
    // high cadence (e.g. 10 s → 20 s idle).
    return Math.max(8000, configured * 2);
  })();

  return inputActive ? Math.max(base, INPUT_ACTIVE_MIN_MS) : base;
}
