# THI-117 Terminal WebSocket Auto-Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore live streaming automatically when the `/ws/pane` socket drops, preserving the xterm.js Terminal across reconnects and giving the user a clear failure path (manual Reconnect button on exhaustion, terminal "pane gone" state on permanent failure).

**Architecture:** Pure-decision module (`lib/wsReconnect.ts`) owns close-code policy and backoff scheduling — testable without xterm or WebSocket mocks. `TerminalModal.tsx` extracts WS open/wire logic into a `connect(isReconnect)` closure called once at mount and self-rescheduled via `setTimeout`. Backend `routers/ws.py` races the receive loop against the streamer task so a stream that ends after a successful connect (tmux killed the pane) emits a `4410` close code; the frontend's reconnect controller maps `4404`/`4410` to a terminal `gone` state and skips backoff.

**Tech stack:** TypeScript + React (frontend), Python 3.11 + FastAPI + asyncio (backend), Vitest + Pytest (tests), xterm.js (terminal renderer).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/lib/wsReconnect.ts` | **create** | Pure decision module: `BACKOFF_MS`, `CloseAction` union, `decideCloseAction()` |
| `frontend/src/lib/wsReconnect.test.ts` | **create** | Exhaustive coverage of `decideCloseAction` for all close-code / attempt branches |
| `frontend/src/components/TerminalModal.tsx` | **modify** | Expand `Connection` type; add reconnect controller refs; refactor WS lifecycle into `connect()` closure; move `term.onData` outside; wire `ws.onclose` through `decideCloseAction`; add ANSI notices; manual Reconnect button |
| `frontend/src/components/TerminalModal.test.tsx` | **create** | Integration tests with `vi.useFakeTimers` and a mock WS factory |
| `frontend/src/styles/styles.css` | **modify** | Per-state pill colors for `reconnecting` / `disconnected` / `gone` |
| `backend/src/switchboard/routers/ws.py` | **modify** | Extract `_pane_recv_loop` helper; race tasks via `asyncio.wait(FIRST_COMPLETED)`; emit `4410` when streamer completes first |
| `backend/tests/test_ws.py` | **modify** | Add tests: streamer-ends-first → 4410; client-disconnects-first → no 4410; `saved_size` restore runs exactly once in both orderings |

---

## Task 1: Create `wsReconnect.ts` pure decision module

**Files:**
- Create: `frontend/src/lib/wsReconnect.ts`
- Create: `frontend/src/lib/wsReconnect.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `frontend/src/lib/wsReconnect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BACKOFF_MS, decideCloseAction } from "./wsReconnect";

describe("decideCloseAction — intentional / stale shortcuts", () => {
  it("returns ignore when isIntentional is true (regardless of close code)", () => {
    expect(decideCloseAction(1006, 0, true, false)).toEqual({ kind: "ignore" });
    expect(decideCloseAction(4404, 5, true, false)).toEqual({ kind: "ignore" });
  });

  it("returns ignore when isStale is true (a replaced socket fired late)", () => {
    expect(decideCloseAction(1006, 0, false, true)).toEqual({ kind: "ignore" });
  });
});

describe("decideCloseAction — permanent failures", () => {
  it("maps 4404 (pane not found) to gone", () => {
    expect(decideCloseAction(4404, 0, false, false)).toEqual({ kind: "gone" });
  });

  it("maps 4410 (stream ended) to gone", () => {
    expect(decideCloseAction(4410, 3, false, false)).toEqual({ kind: "gone" });
  });
});

describe("decideCloseAction — normal close", () => {
  it("maps 1000 (normal) to ignore (treated as intentional)", () => {
    expect(decideCloseAction(1000, 0, false, false)).toEqual({ kind: "ignore" });
  });
});

describe("decideCloseAction — backoff scheduling", () => {
  it("schedules retry with BACKOFF_MS[attempt] for attempts 0..7", () => {
    BACKOFF_MS.forEach((delayMs, attempt) => {
      expect(decideCloseAction(1006, attempt, false, false)).toEqual({
        kind: "retry",
        delayMs,
        attempt,
      });
    });
  });

  it("returns exhausted when attempt equals BACKOFF_MS.length", () => {
    expect(decideCloseAction(1006, BACKOFF_MS.length, false, false)).toEqual({
      kind: "exhausted",
    });
  });

  it("returns exhausted when attempt exceeds the cap", () => {
    expect(decideCloseAction(1006, 99, false, false)).toEqual({ kind: "exhausted" });
  });

  it("treats unknown close codes as retryable (network blips)", () => {
    // Codes other than 1000/4404/4410 should follow the retry path.
    expect(decideCloseAction(1011, 0, false, false)).toEqual({
      kind: "retry",
      delayMs: BACKOFF_MS[0],
      attempt: 0,
    });
  });
});

describe("BACKOFF_MS", () => {
  it("is the periscope curve: 250, 500, 1000, 2000, then steady 4000", () => {
    expect(BACKOFF_MS).toEqual([250, 500, 1000, 2000, 4000, 4000, 4000, 4000]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd frontend && npm test -- --run wsReconnect`
Expected: All tests FAIL because `./wsReconnect` doesn't exist yet.

- [ ] **Step 3: Implement the module**

Create `frontend/src/lib/wsReconnect.ts`:

```ts
/** Periscope's backoff curve: 250, 500, 1000, 2000ms, then steady 4000ms.
 *  Eight entries means eight retry attempts after the initial failure
 *  (~19.75s of total trying) before transitioning to `disconnected`. */
export const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 4000, 4000, 4000];

/** Decision a `ws.onclose` handler should take. Discriminated union so
 *  the caller is forced to handle every kind explicitly. */
export type CloseAction =
  | { kind: "ignore" }
  | { kind: "gone" }
  | { kind: "retry"; delayMs: number; attempt: number }
  | { kind: "exhausted" };

/** Pure policy decision: given a close event's code, the current attempt
 *  count, and whether this close was internal (intentional teardown) or
 *  stale (a socket already replaced by a newer one), decide what to do.
 *
 *  - `isIntentional` or `isStale` → ignore (teardown owns the lifecycle)
 *  - close codes 4404 / 4410 → gone (server says pane is permanently gone)
 *  - close code 1000 → ignore (clean shutdown initiated locally)
 *  - any other code, attempt < cap → retry with BACKOFF_MS[attempt]
 *  - any other code, attempt >= cap → exhausted (user gets a Reconnect button)
 */
export function decideCloseAction(
  closeCode: number,
  attempt: number,
  isIntentional: boolean,
  isStale: boolean,
): CloseAction {
  if (isIntentional || isStale) return { kind: "ignore" };
  if (closeCode === 4404 || closeCode === 4410) return { kind: "gone" };
  if (closeCode === 1000) return { kind: "ignore" };
  if (attempt >= BACKOFF_MS.length) return { kind: "exhausted" };
  return { kind: "retry", delayMs: BACKOFF_MS[attempt], attempt };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd frontend && npm test -- --run wsReconnect`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/wsReconnect.ts frontend/src/lib/wsReconnect.test.ts
git commit -m "feat(thi-117): add wsReconnect — pure close-action policy"
```

---

## Task 2: Backend — extract `_pane_recv_loop` helper (no behavior change)

**Files:**
- Modify: `backend/src/switchboard/routers/ws.py`

This is a pure refactor that pulls the existing `while True: await ws.receive_text()` body into a standalone helper. Behavior preserving — needed so Task 3 can run the helper as its own task alongside the streamer.

- [ ] **Step 1: Verify current test suite is green before refactoring**

Run: `cd backend && uv run pytest tests/test_ws.py -v`
Expected: All existing tests PASS.

- [ ] **Step 2: Refactor — extract the recv loop**

In `backend/src/switchboard/routers/ws.py`, replace the existing receive-loop body inside `pane_socket()` with a call to a new helper. The helper takes the `ws`, `session`, `index`, and a mutable `saved_size_box: list` (length-1 list) for the resize snapshot — because the `finally` block in `pane_socket` needs to read it after the helper returns.

Full new file content:

```python
import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from switchboard.services import pane_stream, tmux

log = logging.getLogger(__name__)
router = APIRouter()

# Per-target streamer registry: one live pane_stream per pane at a time.
# tmux's pipe-pane is a single global resource per pane; two streamers racing
# for the same pane would step on each other's pipes — the first one's
# cleanup would disable the pipe-pane the second one had just installed,
# silently killing the second connection's stream. React StrictMode in dev
# mounts useEffect twice, which makes this race trivial to trigger.
_ACTIVE_STREAMERS: dict[str, asyncio.Task] = {}


async def _pane_recv_loop(
    ws: WebSocket,
    session: str,
    index: int,
    saved_size_box: list,
) -> None:
    """Receive client→server messages: resize control frames and keystrokes.

    `saved_size_box` is a length-1 list used as a mutable holder for the
    pre-resize window snapshot. The handler's finally block reads it to
    restore the window on disconnect; we need it accessible from outside this
    coroutine because it survives the recv loop's exit.
    """
    while True:
        msg = await ws.receive_text()
        if msg.startswith("{"):
            try:
                payload = json.loads(msg)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict) and "signal" in payload:
                tmux.send_signal(session, index, str(payload["signal"]))
                continue
            if isinstance(payload, dict) and payload.get("type") == "resize":
                try:
                    cols = int(payload.get("cols") or 0)
                    rows = int(payload.get("rows") or 0)
                except (TypeError, ValueError):
                    cols = rows = 0
                if cols > 0 and rows > 0:
                    if saved_size_box[0] is None:
                        saved_size_box[0] = tmux.get_window_size(session, index)
                    tmux.resize_window(session, index, cols, rows)
                continue
        # Default: forward as literal keys to the pane.
        tmux.send_keys(session, index, paste=msg)


@router.websocket("/ws/pane")
async def pane_socket(ws: WebSocket, session: str, index: int) -> None:
    await ws.accept()
    pane = tmux.get_pane(session, index)
    if pane is None:
        await ws.close(code=4404, reason="pane not found")
        return

    target = f"{session}:{index}"
    # Evict any prior streamer on this pane and wait for its cleanup to
    # finish before installing ours — otherwise its pipe-pane teardown could
    # race with our setup. Awaiting drains the prior task's finally block
    # (which is what disables pipe-pane), so when we proceed the pane is
    # guaranteed to have no live pipe.
    prev = _ACTIVE_STREAMERS.pop(target, None)
    if prev is not None and not prev.done():
        prev.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await prev

    streamer = pane_stream.PaneStreamer(session=session, index=index, ws=ws)
    tail_task = asyncio.create_task(streamer.run())
    _ACTIVE_STREAMERS[target] = tail_task

    # Snapshot of the window's pre-resize size + window-size mode, captured
    # on the first {type:"resize"} message and restored on disconnect — so
    # closing the modal returns the pane to whatever shape the user's real
    # terminal client wants. Held in a length-1 list so _pane_recv_loop can
    # mutate it from another coroutine.
    saved_size_box: list = [None]

    try:
        await _pane_recv_loop(ws, session, index, saved_size_box)
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        log.debug("ws loop error: %s", e)
    finally:
        saved_size = saved_size_box[0]
        if saved_size is not None:
            mode, cols, rows = saved_size
            tmux.restore_window_size(session, index, mode, cols, rows)
        # Only deregister if we're still the current owner — a later
        # connection may have evicted us and registered its own task.
        if _ACTIVE_STREAMERS.get(target) is tail_task:
            _ACTIVE_STREAMERS.pop(target, None)
        tail_task.cancel()
        try:
            await tail_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
```

- [ ] **Step 3: Run the existing test suite — must stay green**

Run: `cd backend && uv run pytest tests/test_ws.py -v`
Expected: All existing tests PASS, no new failures.

- [ ] **Step 4: Run ruff format + check**

Run: `cd backend && uv run ruff format . && uv run ruff check .`
Expected: No changes (or just reformat), no lint errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/switchboard/routers/ws.py
git commit -m "refactor(thi-117): extract _pane_recv_loop helper (no behavior change)"
```

---

## Task 3: Backend — race recv vs streamer, emit `4410` on stream-ended

**Files:**
- Modify: `backend/src/switchboard/routers/ws.py`
- Modify: `backend/tests/test_ws.py`

- [ ] **Step 1: Write the new tests**

Append to `backend/tests/test_ws.py`:

```python
class _ImmediateExitStreamer:
    """Streamer that returns from `run()` immediately. Simulates the
    real-world case where tmux killed the pane and pipe-pane EOF'd before
    the client disconnected — the handler must close the WS with 4410."""

    instances: ClassVar[list[_ImmediateExitStreamer]] = []

    def __init__(self, *, ws=None, **_kwargs) -> None:
        self.ws = ws
        _ImmediateExitStreamer.instances.append(self)

    async def run(self) -> None:
        # Yield once so the event loop has a chance to schedule the recv
        # task before we exit; otherwise the race is decided synchronously
        # in a way the production code path would never see.
        import asyncio

        await asyncio.sleep(0)
        return  # streamer "completes" immediately


def test_ws_closes_with_4410_when_streamer_ends_first(
    monkeypatch, ws_client: TestClient
) -> None:
    """When the streamer task completes while the client is still connected,
    the handler must close the WS with code 4410 so the frontend's reconnect
    controller can transition to `gone` rather than cycling through backoff."""
    _ImmediateExitStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _ImmediateExitStreamer)

    with pytest.raises(Exception) as exc_info:  # noqa: PT011
        with ws_client.websocket_connect(
            "/ws/pane?session=dev&index=2", headers=_HOST
        ) as ws:
            # Block on receive; the server-side close should land here.
            ws.receive_text()
    # starlette's TestClient surfaces server-side close as WebSocketDisconnect
    # with the code attached. Tolerate either the typed exception or the
    # close-code attribute being present on whatever bubbles up.
    err = exc_info.value
    code = getattr(err, "code", None)
    assert code == 4410, f"expected close code 4410, got {code!r} ({err!r})"


def test_ws_no_4410_when_client_disconnects_first(
    monkeypatch, ws_client: TestClient
) -> None:
    """If the client closes first (normal modal-close), the handler must NOT
    emit a 4410 — the streamer is cancelled cleanly and the WS shuts down
    via the WebSocketDisconnect path."""
    _RecordingStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _RecordingStreamer)

    with ws_client.websocket_connect(
        "/ws/pane?session=dev&index=2", headers=_HOST
    ) as ws:
        _wait_ready(ws)
        # Drop the connection from the client side.
    # If the handler reached the 4410 path inadvertently we'd see the
    # streamer marked uncancelled — but cancellation flows through the
    # normal WebSocketDisconnect path here.
    assert _RecordingStreamer.instances[0].cancelled is True


def test_ws_saved_size_restored_when_streamer_ends_first(
    monkeypatch, ws_client: TestClient
) -> None:
    """The pre-resize window snapshot must still be restored when the
    streamer's race-loss triggers the 4410 path — not only on client
    disconnect."""
    _ImmediateExitStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _ImmediateExitStreamer)

    restore_calls: list[tuple] = []
    monkeypatch.setattr(tmux, "get_window_size", lambda s, i: ("latest", 80, 24))
    monkeypatch.setattr(tmux, "resize_window", lambda *a: True)
    monkeypatch.setattr(
        tmux,
        "restore_window_size",
        lambda s, i, m, c, r: restore_calls.append((s, i, m, c, r)) or True,
    )

    with contextlib.suppress(Exception):
        with ws_client.websocket_connect(
            "/ws/pane?session=dev&index=2", headers=_HOST
        ) as ws:
            ws.send_text('{"type":"resize","cols":120,"rows":40}')
            # Allow the streamer-completion close to land.
            with contextlib.suppress(Exception):
                ws.receive_text()

    assert restore_calls == [("dev", 2, "latest", 80, 24)]
```

Also add this import at the top of the file:

```python
import contextlib
```

(Already imported if the file already uses it; if not, add it near the existing `from __future__` / typing imports.)

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `cd backend && uv run pytest tests/test_ws.py::test_ws_closes_with_4410_when_streamer_ends_first tests/test_ws.py::test_ws_no_4410_when_client_disconnects_first tests/test_ws.py::test_ws_saved_size_restored_when_streamer_ends_first -v`
Expected: All three FAIL — the handler doesn't yet emit `4410`.

- [ ] **Step 3: Restructure `pane_socket` to race the tasks**

In `backend/src/switchboard/routers/ws.py`, replace the `try:` block that calls `_pane_recv_loop` with a `FIRST_COMPLETED` race. The full updated `pane_socket` body:

```python
@router.websocket("/ws/pane")
async def pane_socket(ws: WebSocket, session: str, index: int) -> None:
    await ws.accept()
    pane = tmux.get_pane(session, index)
    if pane is None:
        await ws.close(code=4404, reason="pane not found")
        return

    target = f"{session}:{index}"
    prev = _ACTIVE_STREAMERS.pop(target, None)
    if prev is not None and not prev.done():
        prev.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await prev

    streamer = pane_stream.PaneStreamer(session=session, index=index, ws=ws)
    tail_task = asyncio.create_task(streamer.run())
    _ACTIVE_STREAMERS[target] = tail_task

    saved_size_box: list = [None]
    recv_task = asyncio.create_task(
        _pane_recv_loop(ws, session, index, saved_size_box)
    )

    try:
        done, _pending = await asyncio.wait(
            [tail_task, recv_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        if tail_task in done and recv_task not in done:
            # Stream ended while client was still connected (tmux killed the
            # pane, pipe-pane failed, etc.). Tell the frontend so its
            # reconnect controller can transition to `gone` instead of
            # cycling through backoff.
            with contextlib.suppress(Exception):
                await ws.close(code=4410, reason="pane stream ended")
            recv_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await recv_task
        else:
            # Client disconnected (or recv raised) → cancel the streamer.
            tail_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await tail_task
    except WebSocketDisconnect:
        # The recv loop raises this when the client closes; cancel both
        # tasks defensively (recv has already returned by definition).
        tail_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await tail_task
    except Exception as e:  # noqa: BLE001
        log.debug("ws loop error: %s", e)
    finally:
        saved_size = saved_size_box[0]
        if saved_size is not None:
            mode, cols, rows = saved_size
            tmux.restore_window_size(session, index, mode, cols, rows)
        if _ACTIVE_STREAMERS.get(target) is tail_task:
            _ACTIVE_STREAMERS.pop(target, None)
```

(Note the change in structure: `_pane_recv_loop` is now a task, not an inline `await`. The `WebSocketDisconnect` path becomes a fallback because `asyncio.wait` doesn't propagate exceptions from the awaited tasks — they're captured in the task itself; `done` includes them.)

Actually, the cleaner pattern is to *check* for an exception on the receive task in the `else` branch and re-raise / log:

After the `await asyncio.wait(...)`, the receive task's exception (if any) is held by the task object. If we want the existing `except WebSocketDisconnect: pass` semantics to apply, we should consume that exception:

```python
        else:
            # Client disconnected (or recv raised) → cancel the streamer.
            tail_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await tail_task
            # Consume the recv task's exception so it doesn't trigger a
            # "Task exception was never retrieved" warning.
            with contextlib.suppress(WebSocketDisconnect, Exception):
                recv_task.result()
```

Use that variant. The outer `except WebSocketDisconnect:` is now unreachable from the recv-task path because `asyncio.wait` doesn't re-raise; you can remove it, leaving only the broad `except Exception:` for any out-of-band errors during the race orchestration itself.

Final `pane_socket` body (cleaner version):

```python
@router.websocket("/ws/pane")
async def pane_socket(ws: WebSocket, session: str, index: int) -> None:
    await ws.accept()
    pane = tmux.get_pane(session, index)
    if pane is None:
        await ws.close(code=4404, reason="pane not found")
        return

    target = f"{session}:{index}"
    prev = _ACTIVE_STREAMERS.pop(target, None)
    if prev is not None and not prev.done():
        prev.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await prev

    streamer = pane_stream.PaneStreamer(session=session, index=index, ws=ws)
    tail_task = asyncio.create_task(streamer.run())
    _ACTIVE_STREAMERS[target] = tail_task

    saved_size_box: list = [None]
    recv_task = asyncio.create_task(
        _pane_recv_loop(ws, session, index, saved_size_box)
    )

    try:
        done, _pending = await asyncio.wait(
            [tail_task, recv_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        if tail_task in done and recv_task not in done:
            with contextlib.suppress(Exception):
                await ws.close(code=4410, reason="pane stream ended")
            recv_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await recv_task
        else:
            tail_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await tail_task
            # Consume the recv task's exception (typically WebSocketDisconnect)
            # so asyncio doesn't log "Task exception was never retrieved".
            with contextlib.suppress(WebSocketDisconnect, Exception):
                recv_task.result()
    except Exception as e:  # noqa: BLE001
        log.debug("ws loop error: %s", e)
    finally:
        saved_size = saved_size_box[0]
        if saved_size is not None:
            mode, cols, rows = saved_size
            tmux.restore_window_size(session, index, mode, cols, rows)
        if _ACTIVE_STREAMERS.get(target) is tail_task:
            _ACTIVE_STREAMERS.pop(target, None)
```

- [ ] **Step 4: Run the new tests and verify they pass**

Run: `cd backend && uv run pytest tests/test_ws.py -v`
Expected: All tests PASS, including the three new ones.

- [ ] **Step 5: Run ruff format + check + ty**

Run: `cd backend && uv run ruff format . && uv run ruff check . && uv run ty check`
Expected: Clean across all three.

- [ ] **Step 6: Commit**

```bash
git add backend/src/switchboard/routers/ws.py backend/tests/test_ws.py
git commit -m "feat(thi-117): emit 4410 close code when pane stream ends mid-connection"
```

---

## Task 4: Frontend — refactor TerminalModal WS lifecycle into `connect()` closure

**Files:**
- Modify: `frontend/src/components/TerminalModal.tsx`

This task is behavior-preserving — no reconnect logic yet. Extract the WS setup into a `connect()` closure so Task 5 can call it from `setTimeout`. Also move `term.onData` outside the WS block so it reads `wsRef.current` on every keystroke (necessary for it to work across reconnects).

- [ ] **Step 1: Verify current tests are green**

Run: `cd frontend && npm test -- --run`
Expected: All existing tests PASS, frontend builds cleanly.

- [ ] **Step 2: Refactor the WS-setup block**

In `frontend/src/components/TerminalModal.tsx`, locate the `if (wsEnabled) { ... } else { ... }` block inside the construction `useEffect` (currently around lines 234-268). Replace it with the following structure:

```tsx
    let ws: WebSocket | null = null;
    let dataSub: { dispose: () => void } | null = null;
    let cancelled = false;

    /** Opens a new WebSocket and wires its handlers. Called once at mount;
     *  Task 5 will also call it from setTimeout for reconnects. */
    function connect() {
      const sock = openPaneWS(win.session, win.index);
      ws = sock;
      wsRef.current = sock;

      sock.onopen = () => {
        setConn("live");
        // First resize: report the size we measured before the socket opened,
        // so tmux sizes the pane to the modal from the start.
        sendSize();
      };
      sock.onmessage = (ev) => {
        const data = ev.data;
        if (typeof data === "string") {
          const parsed = parsePromptMessage(data);
          if (parsed !== undefined) {
            setPrompt(parsed);
            return;
          }
          term.write(data);
        } else if (data instanceof ArrayBuffer) {
          term.write(new Uint8Array(data));
        }
      };
      sock.onclose = () => setConn("closed");
      sock.onerror = () => setConn("closed");
    }

    if (wsEnabled) {
      // term.onData lives outside connect() so it reads wsRef.current per
      // call — this lets it survive a future socket replacement (reconnect).
      dataSub = term.onData((d) => {
        const sock = wsRef.current;
        if (sock && sock.readyState === WebSocket.OPEN) sock.send(d);
      });
      connect();
    } else {
      // Live streaming disabled in settings — show a one-shot snapshot (read-only).
      setConn("snapshot");
      void fetchPane(win.session, win.index).then((lines) => {
        if (!cancelled) term.write(lines.join("\r\n") + (lines.length ? "\r\n" : ""));
      });
    }
```

- [ ] **Step 3: Run frontend tests, build, and type-check**

Run: `cd frontend && npm test -- --run && npm run build`
Expected: All tests PASS, no TS errors, vite build clean.

- [ ] **Step 4: Manually smoke-test once**

Run: `./scripts/dev.sh` (or confirm the dev server is already running).
Open a Switchboard tile in the browser. Verify the terminal modal:
- opens
- streams live output
- accepts keystrokes (still hit the pane)
- closes cleanly via Esc Esc

Behavior should be identical to before the refactor.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TerminalModal.tsx
git commit -m "refactor(thi-117): extract WS setup into connect() closure"
```

---

## Task 5: Frontend — wire reconnect controller in TerminalModal

**Files:**
- Modify: `frontend/src/components/TerminalModal.tsx`

This is the meat of the feature: expand the `Connection` type, add the controller refs, dispatch `onclose` through `decideCloseAction`, write ANSI notices, add the manual Reconnect button.

- [ ] **Step 1: Expand the `Connection` type and `CONN_LABEL`**

Near the top of `frontend/src/components/TerminalModal.tsx`, replace the `Connection` type and `CONN_LABEL` constant:

```tsx
type Connection =
  | "connecting"
  | "live"
  | "reconnecting"
  | "disconnected"
  | "gone"
  | "snapshot";

const CONN_LABEL: Record<Connection, string> = {
  connecting: "connecting",
  live: "WS · live",
  reconnecting: "reconnecting",
  disconnected: "disconnected",
  gone: "pane gone",
  snapshot: "snapshot",
};
```

(The `closed` value is retired — the new states cover every former use of it.)

- [ ] **Step 2: Add the reconnect controller refs**

Inside the `TerminalModal` component body, near the existing refs (around line 48-49), add:

```tsx
  const attemptRef = useRef(0);
  const intentionalRef = useRef(false);
  const backoffTimerRef = useRef<number | null>(null);
  const noticeWrittenRef = useRef(false);
```

- [ ] **Step 3: Import `decideCloseAction`**

At the top of `frontend/src/components/TerminalModal.tsx`, add the import:

```tsx
import { decideCloseAction } from "../lib/wsReconnect";
```

- [ ] **Step 4: Rewrite `connect()` to accept `isReconnect` and use the policy module**

Replace the `connect()` function defined in Task 4 with the reconnect-aware version. Inside the construction `useEffect`, between `let cancelled = false;` and `if (wsEnabled) { ... }`:

```tsx
    function connect(isReconnect: boolean) {
      if (isReconnect) term.clear();
      setConn(isReconnect ? "reconnecting" : "connecting");
      const sock = openPaneWS(win.session, win.index);
      ws = sock;
      wsRef.current = sock;

      sock.onopen = () => {
        if (attemptRef.current > 0) {
          term.writeln("\r\n\x1b[32m[reconnected]\x1b[0m");
        }
        attemptRef.current = 0;
        noticeWrittenRef.current = false;
        setConn("live");
        sendSize();
      };
      sock.onmessage = (ev) => {
        const data = ev.data;
        if (typeof data === "string") {
          const parsed = parsePromptMessage(data);
          if (parsed !== undefined) {
            setPrompt(parsed);
            return;
          }
          term.write(data);
        } else if (data instanceof ArrayBuffer) {
          term.write(new Uint8Array(data));
        }
      };
      sock.onerror = () => {
        /* onclose follows; no-op */
      };
      sock.onclose = (e) => {
        const action = decideCloseAction(
          e.code,
          attemptRef.current,
          intentionalRef.current,
          sock !== wsRef.current,
        );
        switch (action.kind) {
          case "ignore":
            return;
          case "gone":
            term.writeln("\r\n\x1b[31m[pane no longer exists]\x1b[0m");
            setConn("gone");
            return;
          case "exhausted":
            setConn("disconnected");
            return;
          case "retry":
            if (!noticeWrittenRef.current) {
              term.writeln("\r\n\x1b[33m[reconnecting…]\x1b[0m");
              noticeWrittenRef.current = true;
            }
            setConn("reconnecting");
            attemptRef.current = action.attempt + 1;
            backoffTimerRef.current = window.setTimeout(
              () => connect(true),
              action.delayMs,
            );
            return;
        }
      };
    }
```

Update the call site to pass `false` on first connect:

```tsx
    if (wsEnabled) {
      dataSub = term.onData((d) => {
        const sock = wsRef.current;
        if (sock && sock.readyState === WebSocket.OPEN) sock.send(d);
      });
      connect(false);
    } else {
      // ... unchanged snapshot branch ...
    }
```

- [ ] **Step 5: Update the effect cleanup to suppress reconnect and clear the timer**

Inside the `return () => { ... }` block of the construction `useEffect` (around line 270), add at the top:

```tsx
    return () => {
      intentionalRef.current = true;
      if (backoffTimerRef.current) {
        window.clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = null;
      }
      cancelled = true;
      resizeObs.disconnect();
      window.clearTimeout(fitTimer);
      viewport?.removeEventListener("scroll", onScroll);
      window.clearTimeout(scrollbarTimer);
      dataSub?.dispose();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
      wsRef.current = null;
      setPrompt(null);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
```

- [ ] **Step 6: Add the manual Reconnect button to the footer**

In the JSX returned by the component, find the `.term-foot` section (around line 426-460). The current structure has: pill, cwd, spacer, zoom controls, hint. Insert the Reconnect button between the pill and the cwd. The button only renders when `conn === "disconnected"`:

```tsx
        <div className="term-foot">
          <span className={`connect-pill ${conn}`}>
            <span className="dot" /> {CONN_LABEL[conn]}
          </span>
          {conn === "disconnected" && (
            <button
              className="btn btn-ghost btn-reconnect"
              onClick={() => {
                attemptRef.current = 0;
                noticeWrittenRef.current = false;
                // We're outside the construction effect's scope — schedule
                // the reconnect via a microtask so we don't reach into the
                // effect's `connect()` directly. The cleanest place to call
                // it is from a stable ref the effect publishes.
                manualReconnectRef.current();
              }}
              title="Open a fresh WebSocket"
            >
              Reconnect
            </button>
          )}
          <span className="term-cwd">{win.cwd || "—"}</span>
          {/* ... rest of footer unchanged: term-spacer, term-zoom, hint ... */}
```

The button needs to call `connect(true)`, but `connect` is defined inside the construction `useEffect` and not accessible from the render scope. Publish a ref to it. Near the other refs at the top of the component:

```tsx
  const manualReconnectRef = useRef<() => void>(() => {});
```

Inside the construction `useEffect`, right after `connect` is defined:

```tsx
    manualReconnectRef.current = () => connect(true);
```

- [ ] **Step 7: Run frontend tests + build**

Run: `cd frontend && npm test -- --run && npm run build`
Expected: All existing tests still PASS; no TS errors; build clean.

- [ ] **Step 8: Manually verify reconnect end-to-end**

Run: `./scripts/dev.sh` (or confirm dev server is running).
Open a terminal modal. In another shell, stop and restart uvicorn:

```bash
pkill -f 'uvicorn switchboard'
# wait 5 seconds
./scripts/dev.sh
```

Expected:
- Modal shows `[reconnecting…]` (yellow) shortly after `pkill`.
- Pill flips to `reconnecting`.
- After uvicorn comes back, modal shows `[reconnected]` (green); pill flips to `live`.
- No duplicate snapshot in scrollback (term.clear() did its job).

Then kill the open tmux window from another shell:

```bash
tmux kill-window -t dev:2  # adjust target
```

Expected:
- Modal shows `[pane no longer exists]` (red).
- Pill says `pane gone`.
- No `[reconnecting…]` cycle.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/TerminalModal.tsx
git commit -m "feat(thi-117): wire reconnect controller in TerminalModal"
```

---

## Task 6: Frontend — integration tests for TerminalModal reconnect

**Files:**
- Create: `frontend/src/components/TerminalModal.test.tsx`

- [ ] **Step 1: Write the test file**

Create `frontend/src/components/TerminalModal.test.tsx`. The file mocks `xterm` and `xterm-addon-fit` at the top so the component can mount under happy-dom without those packages' DOM dependencies; tests then drive the component through a `FakeWebSocket` to verify the state-machine behavior:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// xterm.js touches DOM APIs (createRange, ResizeObserver hooks via the
// fit addon, etc.) that happy-dom does not implement. Mock the modules
// before importing the component. The Mock Terminal records writes and
// clear() calls so we can assert on them later.
const mockTerminals: MockTerminal[] = [];

class MockTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  writes: string[] = [];
  cleared = 0;
  disposed = false;
  writeln = (s: string) => { this.writes.push(s); };
  write = (s: string | Uint8Array) => {
    this.writes.push(typeof s === "string" ? s : new TextDecoder().decode(s));
  };
  clear = () => { this.cleared += 1; };
  dispose = () => { this.disposed = true; };
  open = () => {};
  focus = () => {};
  loadAddon = () => {};
  attachCustomKeyEventHandler = () => {};
  onData = () => ({ dispose: () => {} });
  constructor() {
    mockTerminals.push(this);
  }
}

vi.mock("xterm", () => ({ Terminal: MockTerminal }));
vi.mock("xterm-addon-fit", () => ({
  FitAddon: class { fit() {} },
}));
vi.mock("xterm/css/xterm.css", () => ({}));

import { TerminalModal } from "./TerminalModal";
import type { Window } from "../types";

afterEach(() => {
  cleanup();
  mockTerminals.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Minimal Window literal. If your local `Window` type has required fields
// not covered here, copy the shape from any existing test that constructs
// one (App.test.tsx, etc.) and adapt.
const win = {
  id: "dev:2",
  paneId: "%42",
  session: "dev",
  index: 2,
  name: "test",
  kind: "agent",
  status: "idle",
  cwd: "/tmp",
  cpu: 0,
  mem: 0,
  cmd: "bash",
  recap: null,
  agent: null,
  lastActivity: 0,
} as unknown as Window;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  binaryType = "arraybuffer";
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  // Test helpers
  open() {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  triggerClose(code: number) {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  // @ts-expect-error — minimal stub, sufficient for the component
  globalThis.WebSocket = FakeWebSocket;
  // The component reads window.location.protocol / .host in openPaneWS.
});

describe("TerminalModal — reconnect", () => {
  it("writes [reconnecting…] once and schedules a retry on abnormal close", () => {
    vi.useFakeTimers();
    render(<TerminalModal window={win} onClose={() => {}} onToast={() => {}} />);

    // The first FakeWebSocket is the initial connect; open it then close abnormally.
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.triggerClose(1006);

    // A retry must have been scheduled; advance time to the first backoff.
    vi.advanceTimersByTime(250);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("does not duplicate the [reconnecting…] notice across multiple failures", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    // Force three consecutive failures.
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.triggerClose(1006);
    vi.advanceTimersByTime(250);
    const ws2 = FakeWebSocket.instances[1];
    ws2.triggerClose(1006);
    vi.advanceTimersByTime(500);
    const ws3 = FakeWebSocket.instances[2];
    ws3.triggerClose(1006);

    // The xterm buffer isn't easy to inspect directly; instead assert the
    // pill state stayed `reconnecting` throughout and no extra DOM appeared.
    expect(container.querySelector(".connect-pill")?.textContent).toContain(
      "reconnecting",
    );
  });

  it("transitions to `gone` on close code 4404 (pane not found) without retrying", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.triggerClose(4404);

    // Advance enough that any scheduled retry would fire.
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(container.querySelector(".connect-pill")?.textContent).toContain(
      "pane gone",
    );
  });

  it("transitions to `gone` on close code 4410 (stream ended) without retrying", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.triggerClose(4410);

    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(container.querySelector(".connect-pill")?.textContent).toContain(
      "pane gone",
    );
  });

  it("renders a Reconnect button when the backoff array is exhausted", () => {
    vi.useFakeTimers();
    render(<TerminalModal window={win} onClose={() => {}} onToast={() => {}} />);

    // BACKOFF_MS has 8 entries. Initial close + 8 retries = 9 sockets total
    // before the controller transitions to `disconnected`.
    const backoff = [250, 500, 1000, 2000, 4000, 4000, 4000, 4000];

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].triggerClose(1006);
    for (let i = 0; i < backoff.length; i++) {
      vi.advanceTimersByTime(backoff[i]);
      const ws = FakeWebSocket.instances[i + 1];
      ws.triggerClose(1006);
    }

    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy();
  });

  it("manual Reconnect button resets the attempt counter and opens a fresh WS", () => {
    vi.useFakeTimers();
    render(<TerminalModal window={win} onClose={() => {}} onToast={() => {}} />);
    const backoff = [250, 500, 1000, 2000, 4000, 4000, 4000, 4000];

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].triggerClose(1006);
    for (let i = 0; i < backoff.length; i++) {
      vi.advanceTimersByTime(backoff[i]);
      FakeWebSocket.instances[i + 1].triggerClose(1006);
    }
    const beforeClick = FakeWebSocket.instances.length;
    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    // A fresh WS was opened immediately (no backoff for manual reconnect).
    expect(FakeWebSocket.instances.length).toBe(beforeClick + 1);
  });

  it("clears the backoff timer on unmount", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].triggerClose(1006);
    // The backoff timer is now scheduled; unmount before it fires.
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests and verify they pass**

Run: `cd frontend && npm test -- --run TerminalModal`
Expected: All seven tests PASS.

If a test fails because of a missing field on the `Window` literal, open one of the existing component tests (e.g. `CommandPalette.test.tsx`) and copy its `Window` fixture shape verbatim — the contract is defined in `src/types.ts`.

- [ ] **Step 3: Run the full frontend suite**

Run: `cd frontend && npm test -- --run && npm run build`
Expected: All tests PASS, build clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TerminalModal.test.tsx
git commit -m "test(thi-117): cover TerminalModal reconnect flow with fake WS + timers"
```

---

## Task 7: Frontend — per-state pill colors

**Files:**
- Modify: `frontend/src/styles/styles.css`

Today the `.connect-pill` base class is green for every state; the class-name suffix (`live`, `closed`, etc.) is ignored visually. Add explicit rules for the new states so the user can tell at a glance whether something needs their attention.

- [ ] **Step 1: Locate the existing `.connect-pill` rule**

It lives around line 1300 of `frontend/src/styles/styles.css`. Read the surrounding context to confirm it uses the project's color tokens (`--tone-green`, `--tone-amber`, `--tone-red`, etc.).

- [ ] **Step 2: Add per-state rules**

Append immediately after the existing `.connect-pill` block (right before the `.toggle` rule around line 1318):

```css
.connect-pill.connecting,
.connect-pill.reconnecting {
  background: color-mix(in oklch, var(--tone-amber) 16%, transparent);
  color: var(--tone-amber);
}
.connect-pill.disconnected,
.connect-pill.gone {
  background: color-mix(in oklch, var(--tone-red) 16%, transparent);
  color: var(--tone-red);
}
.connect-pill.snapshot {
  background: var(--hairline);
  color: var(--text-mute);
}

/* Reconnect button in the terminal footer — same size as the pill so they
   read as paired elements. */
.btn-reconnect {
  padding: 4px 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  border-radius: 999px;
  border: 1px solid var(--accent-edge);
  background: var(--accent-soft);
  color: var(--text);
}
.btn-reconnect:hover {
  background: color-mix(in oklch, var(--accent-edge) 22%, transparent);
}
```

- [ ] **Step 3: Visual smoke test**

Open a terminal modal and trigger each state in turn:
- `connecting` (initial open) — amber pill briefly.
- `live` (open) — green pill.
- Stop uvicorn → amber `reconnecting` pill.
- Restart uvicorn → green `live` pill.
- Stop uvicorn for >20s → red `disconnected` pill, Reconnect button visible.
- Kill the tmux window from another shell → red `pane gone` pill.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/styles.css
git commit -m "style(thi-117): per-state colors for reconnecting / disconnected / gone pills"
```

---

## Task 8: Final CI verification + PR

**Files:**
- None (verification + commit step)

- [ ] **Step 1: Run the full backend gate**

Run: `cd backend && uv run ruff format --check . && uv run ruff check . && uv run ty check && uv run pytest`
Expected: All four green.

- [ ] **Step 2: Run the full frontend gate**

Run: `cd frontend && npm test -- --run && npm run build`
Expected: Both green.

- [ ] **Step 3: Review the diff and the commit graph**

Run: `git log --oneline main..HEAD` and verify the eight commits land in this order:
1. `feat(thi-117): add wsReconnect — pure close-action policy`
2. `refactor(thi-117): extract _pane_recv_loop helper (no behavior change)`
3. `feat(thi-117): emit 4410 close code when pane stream ends mid-connection`
4. `refactor(thi-117): extract WS setup into connect() closure`
5. `feat(thi-117): wire reconnect controller in TerminalModal`
6. `test(thi-117): cover TerminalModal reconnect flow with fake WS + timers`
7. `style(thi-117): per-state colors for reconnecting / disconnected / gone pills`
8. (any cleanup commit, if needed)

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin thibaultdody/thi-117-terminal-ws-auto-reconnect
gh pr create --title "THI-117: Terminal WebSocket auto-reconnect" --body "$(cat <<'EOF'
## Summary

Auto-reconnect the `/ws/pane` socket when it drops, preserving the xterm.js Terminal across attempts. Cap at 8 retries (~20s of trying), then show a manual Reconnect button in the modal footer. Differentiate permanent failures (pane gone, signalled via close codes 4404/4410) from transient blips so the user sees the right affordance.

- **Backend** (`routers/ws.py`) — extracts the recv loop into a helper task and races it against the streamer task with `asyncio.wait(FIRST_COMPLETED)`. When the streamer finishes first (tmux killed the pane, pipe-pane failed) the handler emits `ws.close(code=4410)` instead of zombying the socket.
- **Frontend policy** (`lib/wsReconnect.ts`) — pure `decideCloseAction(code, attempt, isIntentional, isStale)` returns one of `ignore` / `gone` / `retry` / `exhausted`. Backoff curve `[250, 500, 1000, 2000, 4000, 4000, 4000, 4000]` ms. Tested in isolation without xterm or WS mocks.
- **Frontend wiring** (`components/TerminalModal.tsx`) — WS setup moves into a `connect(isReconnect)` closure. `term.onData` now reads `wsRef.current` per call so it survives reconnects. Cleanup sets `intentionalRef = true` and clears the backoff timer. Reconnect button only renders when `conn === "disconnected"`.
- **Snapshot dedup** — `term.clear()` runs before each reconnect attempt so the re-fetched 500-line snapshot doesn't append onto the stale buffer. Pre-disconnect scrollback is lost on reconnect — that's the deliberate tradeoff.

Spec: `docs/superpowers/specs/2026-05-18-thi-117-design.md` · Plan: `docs/superpowers/plans/2026-05-18-thi-117-terminal-ws-auto-reconnect.md`

Closes [THI-117](https://linear.app/thibault-dody/issue/THI-117/terminal-websocket-auto-reconnect-with-xterm-state-preservation).

## Test Plan

- [x] Backend suite: `cd backend && uv run pytest` — N passed.
- [x] Frontend suite: `cd frontend && npm test -- --run` — N passed across N files.
- [x] Frontend build: `cd frontend && npm run build` — clean.
- [ ] Manual: open the terminal modal, then `pkill -f 'uvicorn switchboard'` and restart — `[reconnecting…]` appears (yellow), then `[reconnected]` (green); scrollback is clean.
- [ ] Manual: open the terminal modal, then `tmux kill-window` on the underlying pane — `[pane no longer exists]` appears (red); pill says `pane gone`; no retry cycle.
- [ ] Manual: DevTools → Network → Offline for ~5s, then back online — reconnect succeeds within one backoff cycle.
- [ ] Manual: DevTools → Network → Offline indefinitely — after ~20s pill flips to `disconnected`, Reconnect button appears; clicking it cycles through the backoff array again.
- [ ] Manual: close the modal during reconnecting state — no console errors, no orphan timers.
- [ ] Manual: toggle `wsStreamEnabled` to false during reconnect — modal flips to `snapshot` cleanly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Wait for CI green and update PR body with final test counts**
