"""Route tests for the /ws/pane websocket — the resize control protocol and
the snapshot/restore lifecycle around it.

The pane streamer is stubbed out (it requires a live tmux pane + a FIFO),
leaving the receive loop's control-message dispatch under test.
"""

from __future__ import annotations

import contextlib
from typing import ClassVar

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app
from switchboard.services import pane_stream, tmux

BASE_URL = "http://127.0.0.1:8765"
# TestClient.websocket_connect ignores base_url and always sets Host: testserver,
# which the loopback host allowlist rejects. Force the right Host.
# Origin is required on WS upgrades (THI-159, sec:H1) — must match a configured
# cors_origins entry. http://localhost:5173 is the default.
_HOST = {"host": "127.0.0.1:8765", "origin": "http://localhost:5173"}


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
    monkeypatch.setattr(tmux, "get_window_size", lambda s, i: ("latest", 80, 24))
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
    monkeypatch.setattr(tmux, "get_window_size", lambda s, i: ("latest", 80, 24))
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


def test_ws_no_restore_when_resize_never_arrives(monkeypatch, ws_client: TestClient) -> None:
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


def test_ws_resize_with_bogus_dims_is_ignored(monkeypatch, ws_client: TestClient) -> None:
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


def test_ws_non_resize_json_falls_through_to_send_keys(monkeypatch, ws_client: TestClient) -> None:
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


def test_ws_plain_text_is_pasted_as_keys(monkeypatch, ws_client: TestClient) -> None:
    pastes: list[str] = []

    def _send_keys(session, index, *, keys=None, paste=None, bracketed=False):
        pastes.append(paste)
        return True

    monkeypatch.setattr(tmux, "send_keys", _send_keys)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text("abc")

    assert pastes == ["abc"]


def test_ws_recv_loop_offloads_tmux_calls_to_thread(
    monkeypatch, ws_client: TestClient
) -> None:
    """THI-184: the recv loop must route blocking libtmux subprocess calls
    off the asyncio event-loop thread so they don't freeze it during
    keystroke / signal / resize handling.

    Rather than trying to intercept `asyncio.to_thread` (which is brittle
    across the TestClient's anyio portal boundary), we make the mocked
    tmux functions record the thread they ran on. If the recv loop ran
    them inline on the event-loop thread, every call would land on that
    same thread; with `to_thread` they land on worker threads from the
    default executor. We capture the event-loop thread from the recv
    loop's perspective by recording the thread of `tmux.get_pane`
    (called from the async `pane_socket` handler, but BEFORE any
    threading offload).
    """
    import threading

    handler_thread_box: list[threading.Thread] = []
    tmux_call_threads: dict[str, threading.Thread] = {}

    original_get_pane = tmux.get_pane

    def get_pane_capturing(s: str, i: int) -> object:
        # Runs inline in the async handler → captures the event-loop thread.
        handler_thread_box.append(threading.current_thread())
        return original_get_pane(s, i)

    monkeypatch.setattr(tmux, "get_pane", get_pane_capturing)

    def record(name: str):
        def _inner(*a, **k):
            tmux_call_threads[name] = threading.current_thread()
            if name == "get_window_size":
                return ("latest", 80, 24)
            return True

        return _inner

    monkeypatch.setattr(tmux, "send_keys", record("send_keys"))
    monkeypatch.setattr(tmux, "send_signal", record("send_signal"))
    monkeypatch.setattr(tmux, "get_window_size", record("get_window_size"))
    monkeypatch.setattr(tmux, "resize_window", record("resize_window"))
    monkeypatch.setattr(tmux, "restore_window_size", lambda *a, **k: True)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
        ws.send_text("abc")  # keystroke
        ws.send_text('{"signal":"C-c"}')  # signal
        ws.send_text('{"type":"resize","cols":120,"rows":40}')  # resize

    assert handler_thread_box, "handler never ran"
    loop_thread = handler_thread_box[0]

    # Every recv-loop tmux call must have run on a thread other than the
    # event-loop thread — i.e. asyncio.to_thread offloaded it.
    for name in ("send_keys", "send_signal", "get_window_size", "resize_window"):
        assert name in tmux_call_threads, f"{name} was never called: {tmux_call_threads}"
        assert tmux_call_threads[name] is not loop_thread, (
            f"{name} ran inline on the event-loop thread ({loop_thread.name}), "
            f"not offloaded via asyncio.to_thread"
        )


class _RecordingStreamer:
    """Streamer that records its lifecycle so tests can verify which
    connection actually wins the pane. Sends a sync marker over the WS as
    its first action so a test can drain it and be certain the streamer
    has progressed past construction before checking state."""

    instances: ClassVar[list[_RecordingStreamer]] = []

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
            except Exception:  # noqa: BLE001
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


def test_ws_second_connection_evicts_the_first(monkeypatch, ws_client: TestClient) -> None:
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


def test_ws_eviction_does_not_apply_across_panes(monkeypatch, ws_client: TestClient) -> None:
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


class _ImmediateExitStreamer:
    """Streamer that returns from `run()` immediately. Simulates the
    real-world case where tmux killed the pane and pipe-pane EOF'd before
    the client disconnected — the handler must close the WS with 4410."""

    instances: ClassVar[list[_ImmediateExitStreamer]] = []

    def __init__(self, *, ws=None, **_kwargs) -> None:
        self.ws = ws
        _ImmediateExitStreamer.instances.append(self)

    async def run(self) -> None:
        # Wait briefly so the recv task can drain anything the client has
        # queued (TestClient.send_text uses call_soon_threadsafe; the
        # delivery to recv requires at least one event-loop tick — Darwin's
        # selector loop is generous about this, Linux's is not). 50ms is
        # short enough to not slow the suite and long enough to be reliable
        # across loop policies. In production the streamer dies after
        # seconds/minutes of activity, so this artificial pause models real
        # behavior more honestly than a single asyncio.sleep(0).
        import asyncio

        await asyncio.sleep(0.05)
        return  # streamer "completes"


def test_ws_closes_with_4410_when_streamer_ends_first(monkeypatch, ws_client: TestClient) -> None:
    """When the streamer task completes while the client is still connected,
    the handler must close the WS with code 4410 so the frontend's reconnect
    controller can transition to `gone` rather than cycling through backoff."""
    _ImmediateExitStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _ImmediateExitStreamer)
    # Pin "server alive at probe time" — without this, CI hosts that have no
    # live tmux server return None from get_server and the handler emits 4408
    # (THI-94's server-gone branch) instead. This test specifically pins the
    # pane-gone-but-server-alive code path.
    monkeypatch.setattr(tmux, "get_server", lambda: object())

    with pytest.raises(Exception) as exc_info:
        with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
            # Block on receive; the server-side close should land here.
            ws.receive_text()
    # starlette's TestClient surfaces server-side close as WebSocketDisconnect
    # with the code attached. Tolerate either the typed exception or the
    # close-code attribute being present on whatever bubbles up.
    err = exc_info.value
    code = getattr(err, "code", None)
    assert code == 4410, f"expected close code 4410, got {code!r} ({err!r})"


def test_ws_closes_with_4408_when_tmux_server_gone(monkeypatch, ws_client: TestClient) -> None:
    """When the streamer task completes and `tmux.get_server()` reports the
    server is gone, the handler must close with the distinct 4408 code so the
    frontend can tell `tmux died` apart from `pane killed` (THI-94)."""
    _ImmediateExitStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _ImmediateExitStreamer)
    # Server is alive at connect (the get_pane gate passes via ws_client's
    # fixture monkeypatch), then "dies" mid-stream — get_server returns None
    # by the time the handler probes for the close reason.
    monkeypatch.setattr(tmux, "get_server", lambda: None)

    with pytest.raises(Exception) as exc_info:
        with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
            ws.receive_text()
    err = exc_info.value
    code = getattr(err, "code", None)
    assert code == 4408, f"expected close code 4408, got {code!r} ({err!r})"


def test_ws_no_4410_when_client_disconnects_first(monkeypatch, ws_client: TestClient) -> None:
    """If the client closes first (normal modal-close), the handler must NOT
    emit a 4410 — the streamer is cancelled cleanly and the WS shuts down
    via the WebSocketDisconnect path."""
    _RecordingStreamer.instances.clear()
    monkeypatch.setattr(pane_stream, "PaneStreamer", _RecordingStreamer)

    with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
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
        with ws_client.websocket_connect("/ws/pane?session=dev&index=2", headers=_HOST) as ws:
            ws.send_text('{"type":"resize","cols":120,"rows":40}')
            # Allow the streamer-completion close to land.
            with contextlib.suppress(Exception):
                ws.receive_text()

    assert restore_calls == [("dev", 2, "latest", 80, 24)]
