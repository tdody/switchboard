from types import SimpleNamespace

import pytest

from switchboard.services import tmux
from switchboard.services.tmux import _infer_kind


@pytest.mark.parametrize(
    "cmd,window_name,expected",
    [
        # agent — by command
        ("claude", "main", "agent"),
        ("claude-code", "work", "agent"),
        # agent — `.exe` suffix stripped (the THI-80 bug: macOS reports claude.exe)
        ("claude.exe", "main", "agent"),
        ("CLAUDE.EXE", "main", "agent"),
        # agent — by window-name convention, even when the cmd is a runtime
        ("node", "claude/dashboard", "agent"),
        ("python", "claude-migrate", "agent"),
        # editor
        ("nvim", "edit", "editor"),
        ("nvim.exe", "edit", "editor"),
        ("hx", "edit", "editor"),
        # logs
        ("tail", "logs", "logs"),
        ("k9s", "cluster", "logs"),
        # server — by hint substring in cmd or name
        ("npm", "web", "server"),
        ("zsh", "vite-dev", "server"),
        # shell — the fallthrough
        ("zsh", "main", "shell"),
        ("bash", "scratch", "shell"),
        ("", "", "shell"),
    ],
)
def test_infer_kind(cmd: str, window_name: str, expected: str) -> None:
    assert _infer_kind(cmd, window_name) == expected


def test_deliver_text_pipes_text_on_stdin(monkeypatch) -> None:
    calls = []

    def fake_run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(tmux.subprocess, "run", fake_run)
    assert tmux.deliver_text("dev", 1, "a;b\nc", bracketed=False) is True

    load_args, load_kwargs = calls[0]
    assert load_args[:3] == ["tmux", "load-buffer", "-b"]
    assert load_args[4] == "-"  # text comes from stdin, never as an argv element
    assert load_kwargs["input"] == "a;b\nc"  # the `;` and newline survive intact

    paste_args, _ = calls[1]
    assert paste_args[:4] == ["tmux", "paste-buffer", "-d", "-b"]
    assert paste_args[4] == load_args[3]  # same buffer name
    assert paste_args[5:] == ["-t", "dev:1"]
    assert "-p" not in paste_args  # not bracketed


def test_deliver_text_bracketed_adds_dash_p(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(
        tmux.subprocess,
        "run",
        lambda args, **kw: (
            calls.append(args) or SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
        ),
    )
    assert tmux.deliver_text("dev", 1, "x", bracketed=True) is True
    assert calls[1][:4] == ["tmux", "paste-buffer", "-d", "-p"]


def test_deliver_text_false_when_paste_buffer_fails(monkeypatch) -> None:
    def fake_run(args, **kw):
        rc = 0 if "load-buffer" in args else 1
        return SimpleNamespace(returncode=rc, stdout=b"", stderr=b"")

    monkeypatch.setattr(tmux.subprocess, "run", fake_run)
    assert tmux.deliver_text("dev", 1, "x", bracketed=False) is False


def test_deliver_text_false_on_oserror(monkeypatch) -> None:
    def fake_run(*args, **kwargs):
        raise OSError("tmux not found")

    monkeypatch.setattr(tmux.subprocess, "run", fake_run)
    assert tmux.deliver_text("dev", 1, "x", bracketed=False) is False


def test_send_keys_paste_routes_through_deliver_text(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    seen = []
    monkeypatch.setattr(
        tmux,
        "deliver_text",
        lambda s, i, text, *, bracketed: seen.append((s, i, text, bracketed)) or True,
    )
    assert tmux.send_keys("dev", 1, paste="a;b", bracketed=True) is True
    assert seen == [("dev", 1, "a;b", True)]


def test_send_keys_sleeps_between_paste_and_keys(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    cmds = []
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: cmds.append(a)))
    monkeypatch.setattr(tmux, "deliver_text", lambda *a, **k: True)
    slept = []
    monkeypatch.setattr(tmux.time, "sleep", lambda s: slept.append(s))
    assert tmux.send_keys("dev", 1, paste="x", keys=["Enter"]) is True
    assert slept == [0.10]
    assert cmds == [("send-keys", "-t", "dev:1", "Enter")]


def test_send_keys_keys_only_skips_deliver_and_sleep(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    slept = []
    monkeypatch.setattr(tmux.time, "sleep", lambda s: slept.append(s))

    def _explode(*a, **k):
        raise AssertionError("deliver_text should not be called for keys-only")

    monkeypatch.setattr(tmux, "deliver_text", _explode)
    assert tmux.send_keys("dev", 1, keys=["C-c"]) is True
    assert slept == []


def test_send_keys_false_when_deliver_text_fails(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    monkeypatch.setattr(tmux, "deliver_text", lambda *a, **k: False)
    assert tmux.send_keys("dev", 1, paste="x") is False


def _fake_server_with_pane(cmd: str, window_name: str, index: str = "1"):
    pane = SimpleNamespace(pane_current_command=cmd)
    win = SimpleNamespace(window_index=index, window_name=window_name, active_pane=pane)
    sess = SimpleNamespace(windows=[win])
    return SimpleNamespace(sessions=SimpleNamespace(get=lambda session_name: sess))


def test_pane_kind_returns_agent_for_claude_pane(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: _fake_server_with_pane("claude", "main"))
    assert tmux.pane_kind("dev", 1) == "agent"


def test_pane_kind_returns_shell_for_plain_pane(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: _fake_server_with_pane("zsh", "main"))
    assert tmux.pane_kind("dev", 1) == "shell"


def test_pane_kind_none_when_window_missing(monkeypatch) -> None:
    empty = SimpleNamespace(
        sessions=SimpleNamespace(get=lambda session_name: SimpleNamespace(windows=[]))
    )
    monkeypatch.setattr(tmux, "get_server", lambda: empty)
    assert tmux.pane_kind("dev", 1) is None


def test_pane_kind_none_when_no_server(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: None)
    assert tmux.pane_kind("dev", 1) is None


def _recording_server(stdouts: dict[str, list[str]] | None = None):
    """Stub Server with a `cmd` that records calls and replays stdout by command."""
    calls: list[tuple[str, ...]] = []
    stdouts = stdouts or {}

    def cmd(*args: str, **_kwargs):
        calls.append(args)
        return SimpleNamespace(stdout=stdouts.get(args[0], []), stderr=[])

    return SimpleNamespace(cmd=cmd), calls


def test_resize_window_flips_to_manual_then_resizes(monkeypatch) -> None:
    srv, calls = _recording_server()
    monkeypatch.setattr(tmux, "get_server", lambda: srv)

    assert tmux.resize_window("dev", 2, 100, 30) is True
    assert calls == [
        ("setw", "-t", "dev:2", "window-size", "manual"),
        ("resize-window", "-t", "dev:2", "-x", "100", "-y", "30"),
    ]


def test_resize_window_false_without_server(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: None)
    assert tmux.resize_window("dev", 2, 100, 30) is False


def test_restore_window_size_resizes_then_restores_mode(monkeypatch) -> None:
    srv, calls = _recording_server()
    monkeypatch.setattr(tmux, "get_server", lambda: srv)

    assert tmux.restore_window_size("dev", 2, "latest", 120, 40) is True
    # The mode flip comes after the dimensions — otherwise the window-size
    # option re-takes control before our resize lands.
    assert calls == [
        ("resize-window", "-t", "dev:2", "-x", "120", "-y", "40"),
        ("setw", "-t", "dev:2", "window-size", "latest"),
    ]


def test_get_window_size_parses_mode_and_dims(monkeypatch) -> None:
    srv, _ = _recording_server(
        {
            "show-option": ["manual"],
            "display-message": ["120 36"],
        }
    )
    monkeypatch.setattr(tmux, "get_server", lambda: srv)

    assert tmux.get_window_size("dev", 2) == ("manual", 120, 36)


def test_get_window_size_defaults_blank_mode_to_latest(monkeypatch) -> None:
    # `show-option -v window-size` returns "" when the option isn't set on
    # the window; that means tmux falls back to the global default, which
    # for current tmux is "latest" — call it explicitly when restoring.
    srv, _ = _recording_server({"show-option": [""], "display-message": ["80 24"]})
    monkeypatch.setattr(tmux, "get_server", lambda: srv)

    assert tmux.get_window_size("dev", 2) == ("latest", 80, 24)


def test_get_window_size_none_when_dims_unparseable(monkeypatch) -> None:
    srv, _ = _recording_server({"show-option": ["latest"], "display-message": ["garbage"]})
    monkeypatch.setattr(tmux, "get_server", lambda: srv)

    assert tmux.get_window_size("dev", 2) is None


def test_get_window_size_none_without_server(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: None)
    assert tmux.get_window_size("dev", 2) is None


def test_new_window_targets_session_with_trailing_colon(monkeypatch) -> None:
    # Regression for THI-119: bare `-t 83` is parsed as window-index 83 of the
    # current session, not as session "83". Force the session slot by appending
    # a colon so tmux picks the next free window-index in the named session.
    srv, calls = _recording_server({"new-window": ["1"]})
    monkeypatch.setattr(tmux, "get_server", lambda: srv)

    assert tmux.new_window("83", "logs") == 1
    assert calls == [
        ("new-window", "-t", "83:", "-n", "logs", "-P", "-F", "#{window_index}"),
    ]


def test_new_window_returns_none_on_stderr(monkeypatch) -> None:
    def cmd(*args: str, **_kwargs):
        return SimpleNamespace(stdout=[], stderr=["create window failed: index in use"])

    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=cmd))
    assert tmux.new_window("dev", "logs") is None


def test_new_window_none_without_server(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: None)
    assert tmux.new_window("dev", "logs") is None


def test_rename_session_invokes_tmux_with_old_and_new(monkeypatch) -> None:
    srv, calls = _recording_server()
    monkeypatch.setattr(tmux, "get_server", lambda: srv)
    assert tmux.rename_session("dev", "feat") is True
    assert calls == [("rename-session", "-t", "dev", "feat")]


def test_rename_session_returns_false_on_stderr(monkeypatch) -> None:
    def cmd(*args: str, **_kwargs):
        return SimpleNamespace(stdout=[], stderr=["duplicate session: feat"])

    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=cmd))
    assert tmux.rename_session("dev", "feat") is False


def test_rename_session_false_without_server(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: None)
    assert tmux.rename_session("dev", "feat") is False
