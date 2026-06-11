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


# ---------------------------------------------------------------------------
# Screen/tmux title-set stripping (`ESC k … ESC \`)
# ---------------------------------------------------------------------------


def test_strip_screen_titles_removes_complete_sequence() -> None:
    # The exact pattern observed via pipe-pane after `ls\r` under oh-my-zsh
    # with `TERM=screen-*` — the title-set escape sits between the CRLF and
    # the first output line and would otherwise render as printable text.
    clean, pending = pane_stream._strip_screen_titles(b"\r\n\x1bkls\x1b\\total 272\r\n", b"")
    assert clean == b"\r\ntotal 272\r\n"
    assert pending == b""


def test_strip_screen_titles_passes_non_title_bytes_through() -> None:
    payload = b"plain text\r\n\x1b[31mred\x1b[0m\r\n"
    clean, pending = pane_stream._strip_screen_titles(payload, b"")
    assert clean == payload
    assert pending == b""


def test_strip_screen_titles_holds_partial_across_chunks() -> None:
    # The FIFO read could split anywhere inside `ESC k … ESC \`. Holding
    # the partial as pending and rejoining on the next chunk is what makes
    # the filter robust against 8KB-boundary splits.
    clean1, pending = pane_stream._strip_screen_titles(b"prefix\x1bkpart", b"")
    assert clean1 == b"prefix"
    assert pending == b"\x1bkpart"

    clean2, pending = pane_stream._strip_screen_titles(b"ial\x1b\\suffix", pending)
    assert clean2 == b"suffix"
    assert pending == b""


def test_strip_screen_titles_holds_lone_trailing_esc() -> None:
    # A chunk ending with bare ESC might be the start of `ESC k` — hold it
    # so the next chunk's `k` doesn't render as printable text.
    clean, pending = pane_stream._strip_screen_titles(b"abc\x1b", b"")
    assert clean == b"abc"
    assert pending == b"\x1b"

    # Followup chunk: turns out to be `ESC [` (CSI), not a title — release.
    clean2, pending = pane_stream._strip_screen_titles(b"[31mhi", pending)
    assert clean2 == b"\x1b[31mhi"
    assert pending == b""


def test_strip_screen_titles_strips_multiple_in_one_chunk() -> None:
    # Two title sets back to back (rare in practice, but easy to support):
    clean, pending = pane_stream._strip_screen_titles(b"\x1bkecho\x1b\\\x1bkls\x1b\\ok", b"")
    assert clean == b"ok"
    assert pending == b""


def test_run_snapshot_requests_joined_wrapped_lines(monkeypatch) -> None:
    """THI-253: the WS initial snapshot must capture with join_wrapped=True so
    soft-wrapped paths reach xterm as single logical lines. get_server() is
    stubbed to None so run() exits right after the snapshot send."""

    async def _run() -> None:
        recorded: list[dict] = []

        def fake_capture(session: str, index: int, **kwargs):
            recorded.append(kwargs)
            return ["snapshot line"]

        monkeypatch.setattr(pane_stream.tmux, "capture_pane", fake_capture)
        monkeypatch.setattr(pane_stream.tmux, "get_server", lambda: None)
        ws = _FakeWS()
        streamer = PaneStreamer(session="s", index=0, ws=ws)
        await streamer.run()
        assert recorded[0].get("join_wrapped") is True
        assert ws.sent == ["snapshot line\r\n"]

    asyncio.run(_run())
