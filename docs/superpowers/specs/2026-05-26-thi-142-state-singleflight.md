# THI-142 — `/api/state` single-flight + lower modal-open cadence

**Linear:** [THI-142](https://linear.app/thibault-dody/issue/THI-142/bug-apistate-file-descriptor-exhaustion-under-modal-open-polling)
**Date:** 2026-05-26
**Status:** Draft

## Summary

Two complementary fixes that together stop `/api/state` from exhausting the
backend's file-descriptor budget under modal-open polling:

1. **Coalesce concurrent `/api/state` callers onto a single in-flight
   `collect_state` execution** (single-flight pattern). Followers wait for
   and share the leader's result instead of each spawning their own batch
   of `tmux` subprocesses.
2. **Lower `MODAL_OPEN_POLL_MS` from 100 → 500.** Same change THI-138's PR
   #48 makes; included here so this PR is self-sufficient even if THI-138
   lands later.

## Background

`App.tsx` flips the poll cadence to `MODAL_OPEN_POLL_MS = 100 ms` whenever
the URL has `?open=…`. With ~16 panes each `/api/state` handler spawns ~3
`tmux` subprocesses per pane (`list-panes`, `capture-pane`, branch lookup)
via `libtmux`. Each `subprocess.Popen` opens an `os.pipe()` for stderr —
that's the FD consumed.

Handlers typically take longer than 100 ms with that many panes, so they
stack server-side even though the frontend's `AbortController` cancels
each previous HTTP request. Aborting the HTTP side does **not** stop the
in-flight Python thread running `collect_state` — the thread keeps
fork-execing tmux subprocesses to completion, just to discard the result.

Stacking × ~48 pipes/handler hits macOS's default `ulimit -n` (256–1024)
within ~15 s. Once tripped, every subsequent `/api/state` 500s with
`OSError: [Errno 24] Too many open files` until the backend is restarted.

## Non-goals

* **Cancelling the underlying tmux subprocess work** when an HTTP request
  is aborted. `subprocess.Popen` cleanup mid-flight is fiddly and tangles
  with libtmux internals. Single-flight + slower cadence side-steps it.
* **Caching `/api/state` with a TTL.** Considered and rejected: stale
  reads in the modal-open path (where users watch live spinners and
  status pills) feel wrong. Single-flight gives concurrent callers the
  same fresh result without staleness.
* **Surfacing a "backend overloaded" toast on 500 streaks.** Useful
  follow-up, but with this fix in place the 500 path should be unreachable
  in normal operation. Leaving it for a separate UX ticket.

## Architecture

### Single-flight pattern

`services/tmux.py` gains a `collect_state_singleflight()` that wraps the
existing `collect_state()` with concurrency control. The router calls the
wrapper instead of `collect_state` directly. `collect_state` itself is
unchanged — keeps the existing tests passing untouched.

```python
import threading
from concurrent.futures import Future

_inflight_lock = threading.Lock()
_inflight: Future[StateResponse] | None = None


def collect_state_singleflight() -> StateResponse:
    """Single-flight wrapper around collect_state (THI-142).

    Concurrent callers share one in-flight scan instead of each spawning
    their own batch of tmux subprocesses. Bounds peak FD usage to one
    collect_state worth (~3 subprocesses × N panes) regardless of how
    many /api/state requests pile up under modal-open polling.
    """
    global _inflight
    with _inflight_lock:
        existing = _inflight
        if existing is None:
            future: Future[StateResponse] = Future()
            _inflight = future
    if existing is not None:
        # Follower path. .result() blocks until the leader resolves the
        # future; if the leader raises, the same exception propagates.
        return existing.result()
    # Leader path. The `try/except/finally` order matters: set the
    # exception on the future BEFORE clearing _inflight, so followers
    # waiting on .result() see the failure rather than racing past it
    # into a stale None and becoming a new leader.
    try:
        state = collect_state()
        future.set_result(state)
        return state
    except BaseException as exc:
        future.set_exception(exc)
        raise
    finally:
        with _inflight_lock:
            _inflight = None
```

The router:

```python
# routers/state.py
@router.get("/state")
async def get_state() -> StateResponse:
    return await asyncio.to_thread(tmux.collect_state_singleflight)
```

### Why this is the right shape

* **FD bound.** Only one `collect_state` runs at a time, so subprocess
  pipes are bounded by one scan worth (~48 with 16 panes). Far below
  `ulimit -n`.
* **No staleness.** Followers get the same result as the leader for that
  collection, not a cached older one. Polling intervals up to the leader's
  completion time still feel "live."
* **Cancellation works at the API edge.** A cancelled HTTP request
  unblocks its `asyncio.to_thread` await with `CancelledError`. The
  Python thread it spawned is still in the pool but spends most of its
  time blocked on `_inflight_lock` or `future.result()`, not running
  subprocesses. Worst-case it eventually becomes the leader and burns
  one scan to nobody — same as one wasted poll cycle. No FD pileup.
* **Failure propagation.** If `collect_state` raises (e.g. tmux server
  exits mid-scan), followers see the same exception, not a phantom
  success.

### Modal-open cadence

`App.tsx` constant change:

```ts
- const MODAL_OPEN_POLL_MS = 100;
+ const MODAL_OPEN_POLL_MS = 500;
```

500 ms = 2 Hz, plenty fast for header chips / status pills / pending flag
to read as live. Combined with single-flight, peak FD usage is bounded
even if a future change re-introduces faster polling.

This is the same constant THI-138 changes; landing it in both branches
is intentional — neither PR blocks on the other, and a merge conflict is
trivially resolvable (identical change).

## Files touched

| File | Change |
|---|---|
| `backend/src/switchboard/services/tmux.py` | Add `collect_state_singleflight` + module-level `_inflight_lock` / `_inflight` slot |
| `backend/src/switchboard/routers/state.py` | Call `collect_state_singleflight` instead of `collect_state` |
| `backend/tests/test_state_singleflight.py` | **New** — coalescing, sequential calls, exception propagation |
| `frontend/src/App.tsx` | `MODAL_OPEN_POLL_MS`: 100 → 500 |

## Testing

### Automated

`backend/tests/test_state_singleflight.py` covers:

* **Coalescing.** Two threads call `collect_state_singleflight` while a
  patched `collect_state` blocks on a `threading.Event`. Both return the
  same `StateResponse` instance and the underlying `collect_state` is
  called once.
* **Sequential calls don't share.** Call twice in series with the patched
  `collect_state` counting invocations; expect count == 2.
* **Exception propagates to followers.** Leader's patched `collect_state`
  raises `RuntimeError`. Both leader and follower see the same exception.
* **State after exception.** After a failed call, the in-flight slot is
  cleared and the next call collects fresh.

### Manual regression (from the THI-142 ticket, carried over from THI-137)

- [ ] On a ≥10-pane tmux setup, open `http://localhost:5173/?open=%25SOMETHING`. Within ~15 s of polling, backend log should NOT contain `OSError [Errno 24]`. `/api/state` should keep returning 200.
- [ ] Deep-link refresh with a real pane id: `?open=%25N`. Expected: kanban stays visible **and** the TerminalModal opens for `%N` once `/api/state` resolves. (This was the original THI-137 repro path that THI-142 was hiding.)
- [ ] Deep-link refresh with a bogus pane id: kanban stays visible; no modal opens.
- [ ] Open + close modal in a loop ~20×. No accumulating 500s in the backend log, no `OSError`. THI-137's CSS stays applied throughout.
- [ ] Stress: `lsof -p $(pgrep -f uvicorn) | wc -l` stays bounded (typically <100) across 5 minutes of modal-open polling.

## Open questions / future work

* **"Backend overloaded" toast.** If `/api/state` returns 500 multiple
  ticks in a row, surface a transient toast instead of silently rendering
  an empty body. Separate UX ticket.
* **Cancel propagation into the thread.** If we ever want truly bounded
  thread-pool usage, plumb an `asyncio.Event` from the request handler
  into the singleflight wrapper so cancelled-and-still-pending followers
  can drop out without becoming leaders. Not needed for current load.
* **Cache TTL hybrid.** A short TTL (~200 ms) on top of single-flight
  would let cheap successive polls hit a fresh cached value without
  re-blocking. Defer until profiling shows it matters.
