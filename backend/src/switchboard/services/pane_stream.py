"""Pane → WebSocket tail-poll streamer.

MVP approach: every ~200 ms, capture-pane and — if the visible buffer changed
since the last poll — clear xterm and re-paint the visible 24-line buffer.
tmux already gives us a rendered snapshot; this side-steps the FIFO lifecycle
of `tmux pipe-pane`. The Phase-2 ticket replaces this with `pipe-pane -O` for
sub-50 ms latency and true byte streaming.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from switchboard.services import tmux

if TYPE_CHECKING:
    from fastapi import WebSocket

log = logging.getLogger(__name__)

_POLL_INTERVAL = 0.2
_VIEWPORT_LINES = 500
_CLEAR_AND_HOME = "\x1b[2J\x1b[H"


class PaneStreamer:
    def __init__(self, *, session: str, index: int, ws: WebSocket) -> None:
        self.session = session
        self.index = index
        self.ws = ws
        self._last: list[str] | None = None

    async def run(self) -> None:
        self._last = tmux.capture_pane(self.session, self.index, lines=_VIEWPORT_LINES) or []
        while True:
            await asyncio.sleep(_POLL_INTERVAL)
            current = tmux.capture_pane(self.session, self.index, lines=_VIEWPORT_LINES)
            if current is None:
                try:
                    await self.ws.send_text("\r\n[pane gone]\r\n")
                except Exception:  # noqa: BLE001
                    pass
                return
            if current == self._last:
                continue
            payload = _CLEAR_AND_HOME + "\r\n".join(current) + "\r\n"
            try:
                await self.ws.send_text(payload)
            except Exception as e:  # noqa: BLE001
                log.debug("ws send failed: %s", e)
                return
            self._last = current
