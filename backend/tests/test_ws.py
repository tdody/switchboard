"""Route tests for the /ws/pane websocket — the resize control protocol and
the snapshot/restore lifecycle around it.

The pane streamer is stubbed out (it requires a live tmux pane + a FIFO),
leaving the receive loop's control-message dispatch under test.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app
from switchboard.services import pane_stream, tmux

BASE_URL = "http://127.0.0.1:8765"
# TestClient.websocket_connect ignores base_url and always sets Host: testserver,
# which the loopback host allowlist rejects. Force the right Host.
_HOST = {"host": "127.0.0.1:8765"}


class _NoopStreamer:
    """Drop-in pane_stream.PaneStreamer that never produces output, so the
    receive loop in pane_socket has nothing to race against during tests."""

    def __init__(self, **_kwargs) -> None:
        pass

    async def run(self) -> None:
        # Block forever; the WS handler cancels this on disconnect.
        import asyncio

        await asyncio.Event().wait()


@pytest.fixture
def ws_client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "token_file", tmp_path / "token")
    monkeypatch.setattr(auth_mod.auth_state, "token", "")
    monkeypatch.setattr(auth_mod.auth_state, "csrf_secret", "")
    # The handler guards on tmux.get_pane returning non-None.
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(pane_stream, "PaneStreamer", _NoopStreamer)
    with TestClient(create_app(), base_url=BASE_URL) as c:
        c.get("/api/state")  # prime cookies + warm any startup hooks
        yield c


def test_ws_resize_calls_tmux_resize_window(monkeypatch, ws_client: TestClient) -> None:
    resize_calls: list[tuple] = []
    monkeypatch.setattr(
        tmux, "get_window_size", lambda s, i: ("latest", 80, 24)
    )
    monkeypatch.setattr(
        tmux,
        "resize_window",
        lambda s, i, c, r: resize_calls.append((s, i, c, r)) or True,
    )
    monkeypatch.setattr(tmux, "restore_window_size", lambda *a, **k: True)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text('{"type":"resize","cols":120,"rows":40}')
        # Closing here pushes the handler to its finally block.
    assert resize_calls == [("dev", 2, 120, 40)]


def test_ws_resize_snapshots_then_restores_on_disconnect(
    monkeypatch, ws_client: TestClient
) -> None:
    restore_calls: list[tuple] = []
    monkeypatch.setattr(
        tmux, "get_window_size", lambda s, i: ("latest", 80, 24)
    )
    monkeypatch.setattr(tmux, "resize_window", lambda *a: True)
    monkeypatch.setattr(
        tmux,
        "restore_window_size",
        lambda s, i, m, c, r: restore_calls.append((s, i, m, c, r)) or True,
    )

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text('{"type":"resize","cols":120,"rows":40}')

    # The restored values are the snapshot, not the most recent resize.
    assert restore_calls == [("dev", 2, "latest", 80, 24)]


def test_ws_no_restore_when_resize_never_arrives(
    monkeypatch, ws_client: TestClient
) -> None:
    # If the client never sent a resize, restoring the window would clobber
    # a size that nothing in this connection ever set.
    restore_calls: list[tuple] = []
    monkeypatch.setattr(
        tmux,
        "restore_window_size",
        lambda *a, **k: restore_calls.append(a) or True,
    )

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text("hello")  # plain keystrokes, not a resize

    assert restore_calls == []


def test_ws_resize_with_bogus_dims_is_ignored(
    monkeypatch, ws_client: TestClient
) -> None:
    resize_calls: list[tuple] = []
    monkeypatch.setattr(tmux, "get_window_size", lambda s, i: ("latest", 80, 24))
    monkeypatch.setattr(
        tmux,
        "resize_window",
        lambda s, i, c, r: resize_calls.append((c, r)) or True,
    )
    monkeypatch.setattr(tmux, "restore_window_size", lambda *a, **k: True)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text('{"type":"resize","cols":0,"rows":40}')
        ws.send_text('{"type":"resize","cols":"abc","rows":40}')
        ws.send_text('{"type":"resize"}')  # missing dims

    assert resize_calls == []


def test_ws_non_resize_json_falls_through_to_send_keys(
    monkeypatch, ws_client: TestClient
) -> None:
    send_calls: list[tuple] = []
    monkeypatch.setattr(
        tmux,
        "send_keys",
        lambda session, index, *, keys=None, paste=None, bracketed=False: (
            send_calls.append((session, index, paste)) or True
        ),
    )

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        # A JSON object that isn't a known control message must be delivered
        # verbatim as a paste — otherwise legitimate keystrokes that happen
        # to start with `{` (e.g. typing JSON into a REPL) get swallowed.
        ws.send_text('{"foo": 1}')

    assert send_calls == [("dev", 2, '{"foo": 1}')]


def test_ws_signal_control_message_routes_to_send_signal(
    monkeypatch, ws_client: TestClient
) -> None:
    signals: list[tuple] = []
    monkeypatch.setattr(
        tmux,
        "send_signal",
        lambda s, i, sig: signals.append((s, i, sig)) or True,
    )

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text('{"signal":"C-c"}')

    assert signals == [("dev", 2, "C-c")]


def test_ws_plain_text_is_pasted_as_keys(
    monkeypatch, ws_client: TestClient
) -> None:
    pastes: list[str] = []

    def _send_keys(session, index, *, keys=None, paste=None, bracketed=False):
        pastes.append(paste)
        return True

    monkeypatch.setattr(tmux, "send_keys", _send_keys)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text("abc")

    assert pastes == ["abc"]


class _RecordingStreamer:
    """Streamer that records its lifecycle so tests can verify which
    connection actually wins the pane. Sends a sync marker over the WS as
    its first action so a test can drain it and be certain the streamer
    has progressed past construction before checking state."""

    instances: list["_RecordingStreamer"] = []

    def __init__(self, *, ws=None, **_kwargs) -> None:
        self.id = len(_RecordingStreamer.instances)
        self.cancelled = False
        self.ws = ws
        _RecordingStreamer.instances.append(self)

    async def run(self) -> None:
        import asyncio

        if self.ws is not None:
            try:
                await self.ws.send_text(f"streamer-ready:{self.id}")
            except Exception:
                pass
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise


def _wait_ready(ws) -> str:
    """Drain non-data control frames + return the streamer-ready marker."""
    msg = ws.receive_text()
    assert msg.startswith("streamer-ready:")
    return msg


def test_ws_second_connection_evicts_the_first(
    monkeypatch, ws_client: TestClient
) -> None:
    # Two overlapping WS to the same pane: tmux only supports one pipe-pane
    # per pane, so without per-target serialization the first connection's
    # cleanup races the second's setup and one of them ends up with a dead
    # stream. The handler MUST cancel and await the prior streamer before
    # starting a new one — that's what "wins the pane" means here.
    _RecordingStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _RecordingStreamer)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws1:
        _wait_ready(ws1)
        with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws2:
            _wait_ready(ws2)
            # First streamer must have been cancelled when the second arrived.
            assert len(_RecordingStreamer.instances) == 2
            assert _RecordingStreamer.instances[0].cancelled is True
            assert _RecordingStreamer.instances[1].cancelled is False


def test_ws_eviction_does_not_apply_across_panes(
    monkeypatch, ws_client: TestClient
) -> None:
    # The serialization is per-target; a connection to a different pane must
    # not disturb an existing one.
    _RecordingStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _RecordingStreamer)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws1:
        _wait_ready(ws1)
        with ws_client.websocket_connect("/ws/pane?session=dev&index=3", headers=_HOST) as ws2:
            _wait_ready(ws2)
            assert len(_RecordingStreamer.instances) == 2
            assert _RecordingStreamer.instances[0].cancelled is False
            assert _RecordingStreamer.instances[1].cancelled is False
