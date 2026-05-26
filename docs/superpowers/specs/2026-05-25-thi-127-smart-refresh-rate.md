# THI-127 — Smart refresh rate

**Linear:** [THI-127](https://linear.app/thibault-dody/issue/THI-127/smart-refresh-rate)
**Date:** 2026-05-25
**Status:** Draft

## Summary

Replace the single `/api/state` poll cadence (currently `settings.pollIntervalMs`,
default 3000 ms) with an **activity-aware** tier that ticks faster when at least
one visible window has `status ∈ {running, waiting}` and slower when every
window is `idle`/`done`/`error`. Modal-open and document-hidden behavior are
unchanged.

The change is additive: `usePolling`'s public signature stays the same; the
tier decision happens at the `App.tsx` call site and feeds a single `ms` into
the hook just as today.

## Background

`usePolling` (`frontend/src/api/usePolling.ts:19`) already covers two of the
three things a "smart" cadence wants:

* **Hidden tab** — `tick()` returns early on `document.visibilityState === "hidden"`
  (`usePolling.ts:36`), and `visibilitychange → visible` immediately re-fires
  (`usePolling.ts:60`). No further action needed.
* **In-flight cancellation** — `AbortController` per tick (`usePolling.ts:32-39`).
  Tier-switches that change `ms` already abort the in-flight fetch cleanly via
  the existing effect cleanup at `usePolling.ts:63-68`.

What's missing is the third lever: **activity-aware cadence while visible**.
Today the user picks one number in Settings and the app polls at that rate
whether Claude is mid-stream or every pane has been idle for an hour. The
result is either too lazy during interactive sessions or too greedy when
nothing's happening.

The modal-open fast path (`MODAL_OPEN_POLL_MS = 100`, `App.tsx:46,73`) stays
exactly as is — it serves a different need (metadata coherence with the
streaming pane).

## Non-goals

* **Per-window polling.** Every tier is a single global `/api/state` cadence.
  We are not splitting the poll into per-window subscriptions; that's a much
  bigger architectural change deferred past v0.1.
* **WS-pushed state.** The natural next step is to push `/api/state` deltas
  over a WebSocket, but that requires backend work in `routers/state.py` and
  a coherent client-side merge story. Out of scope.
* **User-visible tier indicator.** No UI affordance to show the user "we're
  polling fast now." Tier is internal.
* **Smarter idleness signals** (CPU drop, no keystrokes for N seconds, etc.).
  We use the `status` field already returned by `/api/state` — nothing else.

## Architecture

### Tier table

| Tier | Cadence | When |
|---|---|---|
| `modal` | `100 ms` | `openId` is truthy (modal open). Existing. |
| `active` | `1000 ms` | Any window in `state.windows` has `status === "running"` or `status === "waiting"`. **New**. |
| `normal` | `settings.pollIntervalMs` (default 3000 ms) | Visible, no active windows, no modal. Existing default. |
| `idle` | `Math.max(8000, settings.pollIntervalMs * 2)` | Visible, every window is `idle` / `done` / `error`. **New**. |
| `hidden` | (skipped) | `document.visibilityState === "hidden"`. Existing in hook. |

Rationale for the `1000 ms` active cadence: fast enough that a Claude
"thinking…" adverb feels live and the spinner chip updates promptly, slow
enough that a single user with five active panes doesn't issue a state
request every 300 ms across the dashboard. The 100 ms modal cadence already
covers the case where the user is *watching* a specific pane.

Rationale for `Math.max(8000, settings.pollIntervalMs * 2)`: if the user
explicitly set a high cadence (e.g. 10 s), respect their intent and slow
further (20 s). The `8 s` floor ensures the default-3000-user still sees a
meaningful slowdown without going so far that a freshly-started pane takes
half a minute to show up.

### Where the tier is computed

Today (`App.tsx:73`):

```ts
const pollIntervalMs = openId ? MODAL_OPEN_POLL_MS : settings.pollIntervalMs;
```

Replace with a single derived selector that reads from the previous tick's
data (`state` is already in scope from the `usePolling` return — see
`App.tsx:74`). This produces a small chicken-and-egg: the **first** tick has
no `state` yet, so it can't classify activity. We resolve it by defaulting to
the `normal` tier until `state` is first hydrated, then switching tiers based
on each subsequent response.

```ts
// new helper near MODAL_OPEN_POLL_MS at top of App.tsx
const ACTIVE_POLL_MS = 1000;

function pickPollInterval(
  hasOpenModal: boolean,
  windows: Window[],
  configured: number,
): number {
  if (hasOpenModal) return MODAL_OPEN_POLL_MS;
  if (windows.length === 0) return configured;        // pre-hydration / empty
  const active = windows.some(
    (w) => w.status === "running" || w.status === "waiting",
  );
  if (active) return ACTIVE_POLL_MS;
  return Math.max(8000, configured * 2);
}

// at the call site (replaces App.tsx:73)
const pollIntervalMs = pickPollInterval(
  Boolean(openId),
  state?.windows ?? [],
  settings.pollIntervalMs,
);
```

`pickPollInterval` is pure — exported and unit-tested in isolation
(`frontend/src/lib/pollTier.test.ts`).

### Hook behavior on tier transition

`usePolling` already does the right thing when `ms` changes: the dependency
array `[ms]` on the effect (`usePolling.ts:69`) tears the old interval down
and re-runs `tick()` immediately at the new cadence. No code change in the
hook.

There is one subtle behavior worth calling out: when the dashboard flips from
`active` → `normal` because the user finishes a build, the next `setInterval`
is scheduled at the new (slower) cadence on the same tick that the response
arrived. That's the correct behavior — no extra delay before the slowdown
takes effect.

### Hysteresis (deliberately not added)

A naive concern: a flapping pane (status oscillates between `running` and
`idle`) could cause the tier to thrash between 1 s and ≥8 s. In practice the
status classifier (`backend/src/switchboard/services/classify.py` — observed
elsewhere) doesn't flap at a meaningful frequency: `running` requires a
foreground process, and `idle` requires the shell prompt to be visible.
Transitions happen on the order of seconds, not subseconds, so the tier
transition is rare enough that no debounce is needed. If real-world data
shows thrash, layer a `useDeferredValue` or 500 ms debounce on top of
`active` later; for v0.1, ship the naive version.

## Files touched

| File | Change |
|---|---|
| `frontend/src/App.tsx` | Add `ACTIVE_POLL_MS` constant and `pickPollInterval` call at line ~73; replace the inline ternary |
| `frontend/src/lib/pollTier.ts` | **New** — exports `ACTIVE_POLL_MS`, `pickPollInterval` as a pure function |
| `frontend/src/lib/pollTier.test.ts` | **New** — unit tests for every branch of `pickPollInterval` |
| `frontend/src/api/usePolling.ts` | No change |

The constant `ACTIVE_POLL_MS` lives in `pollTier.ts` alongside `pickPollInterval`,
not in `App.tsx`, so the tier table stays in one place. `MODAL_OPEN_POLL_MS`
stays in `App.tsx` because the modal-open path is owned by `App.tsx` already.

## Testing

**Unit — `lib/pollTier.test.ts`:**

| Input | Expected |
|---|---|
| `hasOpenModal=true, any windows, configured=anything` | `100` |
| `hasOpenModal=false, windows=[]` | `configured` |
| `hasOpenModal=false, windows=[idle, idle], configured=3000` | `8000` (floor) |
| `hasOpenModal=false, windows=[idle, idle], configured=5000` | `10000` (2× configured) |
| `hasOpenModal=false, windows=[running, idle]` | `1000` |
| `hasOpenModal=false, windows=[waiting]` | `1000` |
| `hasOpenModal=false, windows=[done, error]` | `Math.max(8000, configured*2)` |

**Integration — manual smoke (PR body):**

* Default settings, all panes idle → DevTools Network shows `/api/state`
  every ~8 s.
* `claude` running in any pane → cadence flips to ~1 s within one tick.
* Build completes (all panes back to `idle`/`done`) → cadence flips back to
  ~8 s within one tick.
* Open a modal → cadence flips to 100 ms; close modal → returns to current
  active/idle tier.
* Hide tab (DevTools "throttling: offline" isn't equivalent — actually
  switch tabs) → no requests fire; return to tab → one request fires
  immediately.
* Change `Settings → Refresh interval` to 10 s while idle → cadence becomes
  20 s; while active stays 1 s.

**Regression — `usePolling.test.tsx`:** existing suite must still pass. No
changes to the hook itself, but verify the `[ms]` dep-array behavior under
tier flips by adding one case: re-render the hook with a new `ms`, assert
`setInterval` is cleared and re-armed at the new value.

## Open questions / future work

* **WS state push.** The right long-term fix is server push: when any pane
  transitions, the server emits an event and the client merges deltas
  locally. Polling becomes a fallback / first-paint mechanism. Deferred.
* **Per-window cadence.** A modal-open pane could justify per-window
  metadata; today the global cadence is sufficient. Revisit if any
  card-level animation depends on a fresher feed than the global tier
  provides.
* **Surfacing tier in dev tools.** A debug-only HUD that prints the current
  tier and last-tick latency would help future tuning. Add behind a `?debug`
  query param if the cadence ever needs a second look.
