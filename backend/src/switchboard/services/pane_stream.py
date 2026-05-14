"""Pane → WebSocket streamer via `tmux pipe-pane`.

`tmux pipe-pane -O -t TARGET 'cat > /tmp/sb-<uuid>.fifo'` redirects the pane's
raw output to a FIFO that we read asynchronously and forward over the
WebSocket. tmux strips terminal escape sequences for the rendered buffer but
preserves the input/output stream verbatim — so xterm receives real ANSI and
renders it natively. Sub-50 ms latency in practice.

To stop streaming we call `tmux pipe-pane -t TARGET` (no command argument
toggles the pipe off), close the FIFO read side, and unlink the FIFO.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import tempfile
import uuid
from typing import TYPE_CHECKING

from switchboard.services import tmux

if TYPE_CHECKING:
    from fastapi import WebSocket

log = logging.getLogger(__name__)


class PaneStreamer:
    def __init__(self, *, session: str, index: int, ws: WebSocket) -> None:
        self.session = session
        self.index = index
        self.ws = ws

    async def run(self) -> None:
        # 1. Initial snapshot via capture-pane (pipe-pane only streams NEW output).
        snapshot = tmux.capture_pane(self.session, self.index, lines=500) or []
        if snapshot:
            try:
                await self.ws.send_text("\r\n".join(snapshot) + "\r\n")
            except Exception:  # noqa: BLE001
                return

        # 2. Set up FIFO + pipe-pane.
        fifo_path = os.path.join(tempfile.gettempdir(), f"sb-pane-{uuid.uuid4().hex}.fifo")
        target = f"{self.session}:{self.index}"
        srv = tmux.get_server()
        if srv is None:
            return

        try:
            os.mkfifo(fifo_path, mode=0o600)
        except OSError as e:
            log.warning("mkfifo failed: %s — falling back to capture-pane tail", e)
            await self._tail_poll_fallback()
            return

        fd = -1
        pipe_active = False
        try:
            # Open the read end non-blocking so we don't deadlock waiting for a writer.
            fd = os.open(fifo_path, os.O_RDONLY | os.O_NONBLOCK)

            # Start tmux writing into the FIFO. The shell command runs detached
            # from us; tmux manages its lifecycle.
            shell_cmd = f"cat > {fifo_path}"
            srv.cmd("pipe-pane", "-O", "-t", target, shell_cmd)
            pipe_active = True

            loop = asyncio.get_event_loop()
            reader = asyncio.StreamReader(limit=2**20)
            # connect_read_pipe takes ownership of the fd via the file object.
            file_obj = os.fdopen(fd, "rb", buffering=0)
            fd = -1  # ownership transferred
            await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), file_obj)

            while True:
                chunk = await reader.read(8192)
                if not chunk:
                    # FIFO writer closed (pane gone or pipe-pane stopped) — exit.
                    return
                try:
                    await self.ws.send_bytes(chunk)
                except Exception as e:  # noqa: BLE001
                    log.debug("ws send_bytes failed: %s", e)
                    return
        except Exception as e:  # noqa: BLE001
            log.warning("pipe-pane stream error: %s", e)
        finally:
            # Stop tmux writing.
            if pipe_active:
                with contextlib.suppress(Exception):
                    srv.cmd("pipe-pane", "-t", target)
            # Close fd if we still own it.
            if fd >= 0:
                with contextlib.suppress(OSError):
                    os.close(fd)
            with contextlib.suppress(OSError):
                os.unlink(fifo_path)

    async def _tail_poll_fallback(self) -> None:
        """Fallback for hosts where mkfifo is unsupported (e.g. some sandboxes)."""
        last: list[str] | None = None
        while True:
            await asyncio.sleep(0.2)
            current = tmux.capture_pane(self.session, self.index, lines=500)
            if current is None:
                return
            if current == last:
                continue
            try:
                await self.ws.send_text("\x1b[2J\x1b[H" + "\r\n".join(current) + "\r\n")
            except Exception:  # noqa: BLE001
                return
            last = current
