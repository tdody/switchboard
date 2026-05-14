import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from switchboard.services import pane_stream, tmux

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/pane")
async def pane_socket(ws: WebSocket, session: str, index: int) -> None:
    await ws.accept()
    pane = tmux.get_pane(session, index)
    if pane is None:
        await ws.close(code=4404, reason="pane not found")
        return

    streamer = pane_stream.PaneStreamer(session=session, index=index, ws=ws)
    tail_task = asyncio.create_task(streamer.run())

    try:
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
            # Default: forward as literal keys to the pane.
            tmux.send_keys(session, index, paste=msg)
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        log.debug("ws loop error: %s", e)
    finally:
        tail_task.cancel()
        try:
            await tail_task
        except (asyncio.CancelledError, Exception):
            pass
