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
    prev = _ACTIVE_STREAMERS.pop(target, None)
    if prev is not None and not prev.done():
        prev.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await prev

    streamer = pane_stream.PaneStreamer(session=session, index=index, ws=ws)
    tail_task = asyncio.create_task(streamer.run())
    _ACTIVE_STREAMERS[target] = tail_task

    saved_size_box: list[tuple[str, int, int] | None] = [None]
    recv_task = asyncio.create_task(_pane_recv_loop(ws, session, index, saved_size_box))

    try:
        done, _pending = await asyncio.wait(
            [tail_task, recv_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        if tail_task in done and recv_task not in done:
            # Stream ended while client was still connected (tmux killed the
            # pane, pipe-pane failed, etc.). Yield once to let recv_task
            # process any messages that arrived in the same event-loop batch
            # as the stream's completion (e.g. a resize frame queued just
            # before pipe-pane EOF) — those are needed for window-size
            # restore in the finally block.
            await asyncio.sleep(0)
            # Tell the frontend so its reconnect controller can transition
            # to `gone` instead of cycling through backoff.
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
