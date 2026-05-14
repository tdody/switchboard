"""Tests for the PaneStreamer prompt-poll integration (THI-104).

`_emit_prompt_if_changed` is the unit worth testing: it parses a capture for a
prompt and sends a {type:"prompt"} control frame only when the prompt changed.
The FIFO/pipe-pane plumbing around it is exercised manually, not here.
"""

import asyncio
import json
from pathlib import Path

from switchboard.services.pane_stream import PaneStreamer

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> list[str]:
    return (FIXTURES / name).read_text().splitlines()


class _FakeWS:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(text)


def test_emit_prompt_if_changed_sends_on_change_then_dedups() -> None:
    async def _run() -> None:
        ws = _FakeWS()
        streamer = PaneStreamer(session="s", index=0, ws=ws)
        menu = _load("claude_menu.txt")

        # First sight of a prompt → one control frame.
        last = await streamer._emit_prompt_if_changed(menu, None)
        assert last is not None
        assert len(ws.sent) == 1
        msg = json.loads(ws.sent[0])
        assert msg["type"] == "prompt"
        assert msg["prompt"]["kind"] == "menu"
        assert [c["selected"] for c in msg["prompt"]["choices"]] == [True, False, False]

        # Unchanged capture → no new frame.
        last = await streamer._emit_prompt_if_changed(menu, last)
        assert len(ws.sent) == 1

        # Cursor moved → a new frame.
        last = await streamer._emit_prompt_if_changed(_load("claude_menu_cursor2.txt"), last)
        assert len(ws.sent) == 2

        # Prompt cleared → a {prompt: null} frame, last_sent back to None.
        last = await streamer._emit_prompt_if_changed(_load("claude_idle.txt"), last)
        assert last is None
        assert len(ws.sent) == 3
        assert json.loads(ws.sent[2])["prompt"] is None

    asyncio.run(_run())
