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
    saved_size_box: list[tuple[str, int, int] | None],
) -> None:
    """Receive client→server messages: resize control frames and keystrokes.

    `saved_size_box` is a length-1 list used as a mutable holder for the
    pre-resize window snapshot. The handler's finally block reads it to
    restore the window on disconnect; we need it accessible from outside this
    coroutine because it survives the recv loop's exit.

    Raises `WebSocketDisconnect` when the client closes; all other exceptions
    propagate unchanged. The caller is responsible for cleanup.
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
    saved_size_box: list[tuple[str, int, int] | None] = [None]

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
