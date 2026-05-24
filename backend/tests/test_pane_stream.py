"""Tests for the PaneStreamer prompt-poll integration (THI-104).

`_emit_prompt_if_changed` is the unit worth testing: it parses a capture for a
prompt and sends a {type:"prompt"} control frame only when the prompt changed.
The FIFO/pipe-pane plumbing around it is exercised manually, not here.
"""

import asyncio
import atexit
import json
import os
from pathlib import Path

from switchboard.services import pane_stream
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

        # Still cleared → no duplicate clear frame.
        last = await streamer._emit_prompt_if_changed(_load("claude_idle.txt"), last)
        assert len(ws.sent) == 3

    asyncio.run(_run())


def test_emit_prompt_if_changed_handles_empty_snapshot() -> None:
    """Empty lines (no snapshot yet) must not emit a control frame."""

    async def _run() -> None:
        ws = _FakeWS()
        streamer = PaneStreamer(session="s", index=0, ws=ws)
        last = await streamer._emit_prompt_if_changed([], None)
        assert last is None
        assert ws.sent == []

    asyncio.run(_run())


def test_emit_prompt_if_changed_send_failure_does_not_advance() -> None:
    async def _run() -> None:
        class _FailWS:
            async def send_text(self, text: str) -> None:
                raise ConnectionError("ws closed")

        streamer = PaneStreamer(session="s", index=0, ws=_FailWS())
        menu = _load("claude_menu.txt")
        # Send fails (suppressed) → last_sent must stay None so the next poll retries.
        result = await streamer._emit_prompt_if_changed(menu, None)
        assert result is None

    asyncio.run(_run())


# --- FIFO orphan cleanup (THI-85) -------------------------------------------


def test_cleanup_orphaned_fifos_removes_matching_files_only(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(pane_stream, "_FIFO_DIR", str(tmp_path))
    pid = os.getpid()
    # Three orphaned switchboard FIFOs from a crashed prior run of THIS pid...
    orphans = [tmp_path / f"sb-pane-{pid}-aaa{i}.fifo" for i in range(3)]
    for p in orphans:
        os.mkfifo(p, mode=0o600)
    # ...and two unrelated files that must survive the sweep.
    keep = [tmp_path / "unrelated.txt", tmp_path / "sb-other-prefix.fifo"]
    for p in keep:
        p.write_text("")

    removed = pane_stream.cleanup_orphaned_fifos()

    assert removed == 3
    assert all(not p.exists() for p in orphans)
    assert all(p.exists() for p in keep)


def test_cleanup_orphaned_fifos_ignores_other_pids(monkeypatch, tmp_path) -> None:
    """Regression guard for the multi-worker bug (THI-85 review): a worker
    must never sweep a sibling uvicorn worker's live FIFOs. We mock up a
    "sibling" FIFO carrying a different PID and assert the sweep leaves it
    alone while still removing this PID's own orphan."""
    monkeypatch.setattr(pane_stream, "_FIFO_DIR", str(tmp_path))
    pid = os.getpid()
    mine = tmp_path / f"sb-pane-{pid}-mine.fifo"
    os.mkfifo(mine, mode=0o600)
    # A different PID — pick one that's exceedingly unlikely to collide.
    sibling_pid = 99999 if pid != 99999 else 99998
    sibling = tmp_path / f"sb-pane-{sibling_pid}-foo.fifo"
    os.mkfifo(sibling, mode=0o600)

    removed = pane_stream.cleanup_orphaned_fifos()

    assert removed == 1
    assert not mine.exists()
    assert sibling.exists()  # sibling worker's live FIFO untouched


def test_cleanup_orphaned_fifos_skips_symlinks(monkeypatch, tmp_path) -> None:
    """Defense-in-depth: even if a symlink lands in tmp under our prefix, we
    must not follow it and unlink the target."""
    monkeypatch.setattr(pane_stream, "_FIFO_DIR", str(tmp_path))
    pid = os.getpid()
    target = tmp_path / "important_target"
    target.write_text("keep me")
    link = tmp_path / f"sb-pane-{pid}-symlink.fifo"
    os.symlink(target, link)

    removed = pane_stream.cleanup_orphaned_fifos()

    assert removed == 0
    assert target.exists()
    assert link.is_symlink()


def test_cleanup_orphaned_fifos_swallows_oserror_per_entry(monkeypatch, tmp_path) -> None:
    # If a file is unlinked by another process between glob and our unlink, the
    # OSError must not abort the rest of the sweep.
    monkeypatch.setattr(pane_stream, "_FIFO_DIR", str(tmp_path))
    pid = os.getpid()
    real = tmp_path / f"sb-pane-{pid}-real.fifo"
    os.mkfifo(real, mode=0o600)
    ghost = tmp_path / f"sb-pane-{pid}-ghost.fifo"

    original_glob = pane_stream.glob.glob
    monkeypatch.setattr(
        pane_stream.glob,
        "glob",
        lambda pattern: [str(ghost), *original_glob(pattern)],
    )
    # `ghost` doesn't exist → unlink raises FileNotFoundError → swallowed.
    removed = pane_stream.cleanup_orphaned_fifos()

    assert removed == 1  # only the real one
    assert not real.exists()


def test_install_fifo_cleanup_hook_is_idempotent(monkeypatch) -> None:
    # Reset module-level flag for the test, then ensure two install calls
    # register exactly one atexit handler.
    monkeypatch.setattr(pane_stream, "_atexit_hooked", False)
    seen: list[object] = []
    monkeypatch.setattr(atexit, "register", lambda fn: seen.append(fn))
    pane_stream.install_fifo_cleanup_hook()
    pane_stream.install_fifo_cleanup_hook()
    assert seen == [pane_stream.cleanup_orphaned_fifos]
    assert pane_stream._atexit_hooked is True
