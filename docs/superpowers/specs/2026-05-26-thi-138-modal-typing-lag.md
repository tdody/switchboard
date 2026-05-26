# THI-138 — Lag when typing in open modals

**Linear:** [THI-138](https://linear.app/thibault-dody/issue/THI-138/bug-lag-when-typing-in-open-modals)
**Date:** 2026-05-26
**Status:** Draft

## Symptom

Typing into the CommandPalette input, the Settings modal text inputs, or
the rename / send-keys overlays feels laggy when a terminal modal is open
(or even on a busy dashboard). xterm itself stays responsive — the lag is
in surrounding React UI, not the PTY.

## Root cause

`App.tsx:55` sets `MODAL_OPEN_POLL_MS = 100`. With a terminal modal open
the dashboard polls `/api/state` 10× per second, each response replacing
the `windows` array. The reactive chain runs:

```
/api/state → setData(state) → App re-renders
  → Kanban → all WindowCards (memoized, cheap comparison cost still adds up)
  → Subhead → Header / UsagePill (small but allocations)
  → open modal's header (StatusPill, branch / PR chip, spinner)
```

At 10 Hz that's enough main-thread work to stall keystroke handling by a
visible frame or two. Compounded by:

* The `setState`s from polling are *urgent* in React's scheduling — they
  compete with input events instead of yielding.
* React inputs go through synthetic-event capture; if a render is already
  mid-commit when a key lands, the input's `onChange` is delayed.

## Fix (three small wins, each independently helpful)

### 1. Bump `MODAL_OPEN_POLL_MS` from 100 to 500

The 100 ms cadence was added by THI-105 so modal-open chip changes feel
"within one xterm frame." 2 Hz still reads as live for spinner / status
changes (humans don't notice sub-200 ms updates on a single chip). Returns
5× of the render budget for free.

### 2. Wrap polling `setState` in `React.startTransition`

`usePolling`'s `setData` / `setError` / `setConsecutiveErrors` calls
become **transitions** — non-urgent state updates that React can
interrupt for typing. Code change is ~5 lines in `api/usePolling.ts`,
no behavior change visible to callers.

### 3. Back off cadence when an input is focused + recent keystroke

New `useInputActive()` hook returns a boolean — true while a text input
or textarea is the active element AND a keydown happened within the last
800 ms. `pickPollInterval` gains an `inputActive` parameter; when true,
the returned interval is clamped to `>= 1500 ms` even on the modal-open
tier. Decays back to the normal tier 800 ms after the last keystroke.

The 800 ms idle threshold is short enough that the chips re-snap to live
cadence immediately when the user stops typing, long enough that
mid-word pauses don't churn the cadence flag.

## Non-goals

* **Re-architect the modal render tree.** Memoizing more aggressively or
  decoupling the modal from `/api/state` is a much bigger refactor for
  marginal additional gain once the above three land.
* **Drop polling entirely in favour of a WS state stream.** Worth doing
  someday but out of scope.
* **Throttle xterm output.** xterm is not the bottleneck.

## Files touched

| File | Change |
|---|---|
| `frontend/src/App.tsx` | Lower `MODAL_OPEN_POLL_MS` to 500; pass `inputActive` to `pickPollInterval` |
| `frontend/src/api/usePolling.ts` | Wrap `setState`s in `startTransition` |
| `frontend/src/lib/pollTier.ts` | New `inputActive` param + min-cadence clamp |
| `frontend/src/lib/pollTier.test.ts` | Add cases for `inputActive` |
| `frontend/src/lib/useInputActive.ts` | **New** — keydown listener + 800 ms idle decay |
| `frontend/src/lib/useInputActive.test.ts` | **New** — verifies flip-true on keydown + decay |

No backend change.

## Testing

**Unit:**

* `pickPollInterval(true, [], cfg, 500, false)` → 500.
* `pickPollInterval(true, [], cfg, 500, true)` → max(500, 1500) = 1500.
* `pickPollInterval(false, [activeWindow], cfg, 500, true)` → max(1000, 1500) = 1500.
* `useInputActive` returns false initially; flips true after a synthetic
  keydown into an `<input>`; flips back to false after 800 ms.

**Manual:**

* Open the dashboard, open a terminal modal, type a long sentence into
  the Send Keys overlay — no per-character lag.
* Same with Settings → AI → Anthropic key field.
* Same with the CommandPalette search field.
* Confirm chip changes still propagate within ~1 s when a pane status
  flips (no input focused) — i.e. the input-active backoff doesn't apply
  when no one is typing.

## Open questions / future work

* **800 ms decay tuning.** Empirical; could go shorter (500 ms) for
  snappier post-typing chip updates. Revisit if the timer feels too long
  in practice.
* **Per-modal opt-outs.** If a future modal needs live 100 ms updates
  while typing (unlikely), `pickPollInterval` is the right place to add
  an opt-out.
