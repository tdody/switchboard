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

// --- Adaptive back-off when the backend is slow ---------------------------
// A safety net for when /api/state responses degrade (e.g. the host is under
// memory pressure and tmux subprocess spawns stall). Polling at the normal
// modal-open cadence (500 ms) against a backend that takes seconds to answer
// just stacks requests it can't keep up with — which is exactly what starves
// the keystroke round-trip. When degraded, the cadence is floored here so the
// backend gets room to recover. With batched collect_state the normal latency
// is ~30 ms, so this never trips in the common case.
export const DEGRADED_POLL_MS = 5000;
// EWMA smoothing for response latency — reacts within ~3 samples, damps noise.
const LATENCY_ALPHA = 0.4;
// Hysteresis band: enter "degraded" only when clearly slow, stay until clearly
// recovered. Avoids flapping the cadence around a single threshold.
const DEGRADED_ENTER_MS = 800;
const DEGRADED_EXIT_MS = 400;
// Consecutive superseded polls (aborted before completing because the next
// tick fired first) that flag the backend as outpaced. This is the signal the
// EWMA can't see on its own: when latency exceeds the interval, fetches never
// complete to be measured, so the supersede count is what escalates.
const DEGRADED_SUPERSEDE_COUNT = 2;

/** Exponentially-weighted moving average of poll response latency (ms).
 *  `null` seeds with the first sample. Pure — the caller threads the prior
 *  value back in. */
export function updateLatencyEwma(prev: number | null, sampleMs: number): number {
  return prev === null ? sampleMs : LATENCY_ALPHA * sampleMs + (1 - LATENCY_ALPHA) * prev;
}

/** Hysteresis decision for the "backend is degraded" flag. Enters when the
 *  smoothed latency is clearly high OR consecutive polls keep getting
 *  superseded (we're polling faster than the backend can answer); exits only
 *  when latency is clearly low AND polls are completing again. `ewmaMs === null`
 *  (no sample yet) leaves the current state unchanged. Pure. */
export function nextDegraded(
  current: boolean,
  ewmaMs: number | null,
  supersedes: number,
): boolean {
  if (current) {
    const recovered = supersedes === 0 && ewmaMs !== null && ewmaMs < DEGRADED_EXIT_MS;
    return !recovered;
  }
  if (supersedes >= DEGRADED_SUPERSEDE_COUNT) return true;
  return ewmaMs !== null && ewmaMs > DEGRADED_ENTER_MS;
}

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
 *
 * When `degraded` is true (the backend is responding slowly — see
 * `nextDegraded`), the cadence is floored at `DEGRADED_POLL_MS`, overriding
 * the modal/active/input tiers, so a struggling backend isn't piled with
 * requests it can't answer. Never *lowers* an already-slower interval.
 */
export function pickPollInterval(
  hasOpenModal: boolean,
  windows: Window[],
  configured: number,
  modalOpenMs: number,
  inputActive: boolean = false,
  degraded: boolean = false,
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

  const withInput = inputActive ? Math.max(base, INPUT_ACTIVE_MIN_MS) : base;
  return degraded ? Math.max(withInput, DEGRADED_POLL_MS) : withInput;
}
