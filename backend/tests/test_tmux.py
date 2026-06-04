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
    # Paste contains `;` so the safe-text fast path bails out and deliver_text
    # runs — keeps the sleep+keys behavior under test independent of the
    # routing decision (THI-124).
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    cmds = []
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: cmds.append(a)))
    monkeypatch.setattr(tmux, "deliver_text", lambda *a, **k: True)
    slept = []
    monkeypatch.setattr(tmux.time, "sleep", lambda s: slept.append(s))
    assert tmux.send_keys("dev", 1, paste="a;b", keys=["Enter"]) is True
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
    # Use a paste that forces the deliver_text path (contains `;`).
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    monkeypatch.setattr(tmux, "deliver_text", lambda *a, **k: False)
    assert tmux.send_keys("dev", 1, paste="a;b") is False


# THI-124: typing-latency fast path. Single chars (and any text free of `;` /
# newlines) go through one libtmux `send-keys -l` call instead of two
# subprocess forks via `deliver_text` — ~20-40ms saved per keystroke.
def test_send_keys_safe_paste_uses_send_keys_l_fast_path(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    cmds = []
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: cmds.append(a)))

    def _explode(*a, **k):
        raise AssertionError("deliver_text must NOT be called on the fast path")

    monkeypatch.setattr(tmux, "deliver_text", _explode)
    assert tmux.send_keys("dev", 1, paste="a") is True
    assert cmds == [("send-keys", "-t", "dev:1", "-l", "a")]


def test_send_keys_safe_paste_with_multi_chars_uses_fast_path(monkeypatch) -> None:
    # No length cap; only forbidden chars (`;` / `\n` / `\r`) gate the fast
    # path. A pasted word with no specials must still take it.
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    cmds = []
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: cmds.append(a)))

    def _explode(*a, **k):
        raise AssertionError("deliver_text must NOT be called on the fast path")

    monkeypatch.setattr(tmux, "deliver_text", _explode)
    assert tmux.send_keys("dev", 1, paste="hello world") is True
    assert cmds == [("send-keys", "-t", "dev:1", "-l", "hello world")]


def test_send_keys_paste_with_semicolon_falls_back_to_deliver_text(monkeypatch) -> None:
    # `;` is a tmux command separator — `send-keys -l ";"` silently drops it.
    # The fallback is the THI-116 correctness path.
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    seen = []
    monkeypatch.setattr(
        tmux,
        "deliver_text",
        lambda s, i, text, *, bracketed: seen.append((s, i, text, bracketed)) or True,
    )
    assert tmux.send_keys("dev", 1, paste="ls; pwd") is True
    assert seen == [("dev", 1, "ls; pwd", False)]


def test_send_keys_paste_with_newline_falls_back_to_deliver_text(monkeypatch) -> None:
    # Embedded newlines are stripped by `send-keys -l`; fall back to
    # deliver_text so multi-line input survives.
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    seen = []
    monkeypatch.setattr(
        tmux,
        "deliver_text",
        lambda s, i, text, *, bracketed: seen.append((s, i, text, bracketed)) or True,
    )
    assert tmux.send_keys("dev", 1, paste="line1\nline2") is True
    assert seen == [("dev", 1, "line1\nline2", False)]


def test_send_keys_empty_paste_takes_fast_path(monkeypatch) -> None:
    # Empty paste has no forbidden chars → fast path. The resulting
    # `send-keys -l ""` is a tmux no-op; we just pin the routing decision
    # so a future caller can rely on this not silently forking subprocesses.
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    cmds = []
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: cmds.append(a)))

    def _explode(*a, **k):
        raise AssertionError("deliver_text must NOT be called on the fast path")

    monkeypatch.setattr(tmux, "deliver_text", _explode)
    assert tmux.send_keys("dev", 1, paste="") is True
    assert cmds == [("send-keys", "-t", "dev:1", "-l", "")]


def test_send_keys_paste_with_crlf_falls_back_to_deliver_text(monkeypatch) -> None:
    # `\r\n` (Windows EOL) contains both forbidden chars; either alone
    # triggers the slow path. Explicit pin so the routing stays stable if
    # the predicate is ever rewritten to be cleverer about line endings.
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    seen = []
    monkeypatch.setattr(
        tmux,
        "deliver_text",
        lambda s, i, text, *, bracketed: seen.append((s, i, text, bracketed)) or True,
    )
    assert tmux.send_keys("dev", 1, paste="line1\r\nline2") is True
    assert seen == [("dev", 1, "line1\r\nline2", False)]


def test_send_keys_bracketed_paste_skips_fast_path(monkeypatch) -> None:
    # bracketed=True means a TUI expects the paste markers wrapping the whole
    # block — splitting per-char would defeat the purpose. Always deliver_text.
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    seen = []
    monkeypatch.setattr(
        tmux,
        "deliver_text",
        lambda s, i, text, *, bracketed: seen.append((s, i, text, bracketed)) or True,
    )
    assert tmux.send_keys("dev", 1, paste="a", bracketed=True) is True
    assert seen == [("dev", 1, "a", True)]


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


def test_new_session_invokes_tmux_detached(monkeypatch) -> None:
    # THI-144: bypass get_server's is_alive guard so the button works from
    # the empty state (tmux new-session starts the server on demand). We
    # still want the exact argv to be the detached form.
    srv, calls = _recording_server()
    monkeypatch.setattr(tmux.libtmux, "Server", lambda: srv)
    assert tmux.new_session("feat") is True
    assert calls == [("new-session", "-d", "-s", "feat")]


def test_new_session_returns_false_on_stderr(monkeypatch) -> None:
    def cmd(*args: str, **_kwargs):
        return SimpleNamespace(stdout=[], stderr=["duplicate session: feat"])

    monkeypatch.setattr(tmux.libtmux, "Server", lambda: SimpleNamespace(cmd=cmd))
    assert tmux.new_session("feat") is False


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


# --- collect_state: filter `sb-usage-*` + race-tolerate per-session failures
# (THI-110 commit 3 follow-up). The /usage scrape creates `sb-usage-<uuid8>`
# headless tmux sessions; if /api/state polls between the scrape's
# new-session and kill-session, libtmux raises on `s.windows`. The fix:
# skip these sessions entirely (they're internal, shouldn't render anyway)
# and demote any per-session libtmux exception to a logged skip rather
# than crashing the whole state poll.


def _fake_session(name: str, *, windows_raises: bool = False):
    """Build a minimal stand-in for a libtmux Session that doesn't need a
    live tmux server. `windows_raises=True` simulates the race where the
    session disappeared between srv.sessions and s.windows."""

    class _Win:
        window_index = "0"
        window_name = "shell"
        window_activity = 0
        active_pane = None  # collect_state's `if pane is None: continue` skips

    class _S:
        session_name = name
        session_attached = "0"
        session_created = "0"

        @property
        def windows(self):
            if windows_raises:
                from libtmux import exc

                raise exc.LibTmuxException("session not found")
            return [_Win()]

    return _S()


def _fake_server(sessions):
    """Wraps a sessions list in a libtmux-shaped object. The list_clients
    call inside collect_state hits `srv.cmd`; stub it to return empty."""

    def cmd(*_args, **_kwargs):
        return SimpleNamespace(stdout=[], stderr=[])

    return SimpleNamespace(sessions=sessions, cmd=cmd)


def test_collect_state_skips_sb_usage_sessions(monkeypatch) -> None:
    """`sb-usage-<uuid8>` sessions are internal — must never appear in the
    state response."""
    srv = _fake_server(
        [
            _fake_session("main"),
            _fake_session("sb-usage-deadbeef"),
            _fake_session("agents"),
        ]
    )
    monkeypatch.setattr(tmux, "get_server", lambda: srv)
    state = tmux.collect_state()
    names = [s.name for s in state.sessions]
    assert names == ["main", "agents"]
    # And no windows from those sessions either (defense-in-depth).
    assert all(w.session != "sb-usage-deadbeef" for w in state.windows)


def test_collect_state_tolerates_per_session_libtmux_error(monkeypatch) -> None:
    """A session that vanishes between `srv.sessions` and `s.windows`
    (the user runs `tmux kill-session` from a shell) must NOT 500 the
    /api/state endpoint — the racing session is silently dropped and
    the other sessions continue to render."""
    srv = _fake_server(
        [
            _fake_session("main"),
            _fake_session("vanishing", windows_raises=True),
            _fake_session("agents"),
        ]
    )
    monkeypatch.setattr(tmux, "get_server", lambda: srv)
    # Must not raise — the bad session is skipped, others render.
    state = tmux.collect_state()
    # `vanishing` was already appended to `sessions` before the windows
    # query failed (that ordering matches the existing collect_state
    # loop); the windows from `vanishing` are just absent.
    assert "vanishing" in [s.name for s in state.sessions]
    assert all(w.session != "vanishing" for w in state.windows)


# ---------------------------------------------------------------------------
# THI-181: cache pane.capture_pane() under modal-open polling
# ---------------------------------------------------------------------------


def _capturing_session(pane_id: str, capture_value: list[str]):
    """A fake libtmux session whose single window has a pane that records
    every capture_pane() invocation. Used to assert the THI-181 cache."""

    class _Pane:
        def __init__(self) -> None:
            self.pane_id = pane_id
            self.pane_current_command = "zsh"
            self.pane_current_path = ""
            self.capture_calls = 0

        def capture_pane(self):
            self.capture_calls += 1
            return list(capture_value)

    pane = _Pane()

    class _Win:
        window_index = "0"
        window_name = "shell"
        window_activity = 0
        active_pane = pane

    win = _Win()

    class _S:
        session_name = "main"
        session_attached = "0"
        session_created = "0"

        @property
        def windows(self) -> list[object]:
            return [win]

    return _S(), pane


def _stub_git_and_gh(monkeypatch) -> None:
    monkeypatch.setattr(tmux.claude_parser, "_git_branch", lambda cwd: None)
    monkeypatch.setattr(tmux.claude_parser, "_gh_pr", lambda cwd, branch: (None, None, None))
    monkeypatch.setattr(tmux.claude_parser, "_git_repo_url", lambda cwd: None)


def test_collect_state_caches_pane_capture_within_ttl(monkeypatch) -> None:
    """Two collect_state() calls inside the cache window must fire only one
    pane.capture_pane() subprocess (THI-181). MODAL_OPEN_POLL_MS=500ms on the
    frontend, so a cache TTL near that range halves capture-pane load while
    a modal is open without staling preview meaningfully."""
    session, pane = _capturing_session("%17", ["a", "b"])
    srv = _fake_server([session])
    monkeypatch.setattr(tmux, "get_server", lambda: srv)
    _stub_git_and_gh(monkeypatch)
    tmux.reset_capture_cache()  # isolate from prior tests

    tmux.collect_state()
    tmux.collect_state()

    assert pane.capture_calls == 1


def test_collect_state_recaptures_pane_after_ttl_expiry(monkeypatch) -> None:
    """When the cache entry is older than the TTL, the next collect_state()
    must re-run pane.capture_pane(). Otherwise stale captures would persist
    forever after the pane changed."""
    import time as _time

    session, pane = _capturing_session("%17", ["a"])
    srv = _fake_server([session])
    monkeypatch.setattr(tmux, "get_server", lambda: srv)
    _stub_git_and_gh(monkeypatch)
    # Tiny TTL so the test doesn't have to actually sleep half a second.
    monkeypatch.setattr(tmux, "_CAPTURE_CACHE_TTL_S", 0.01)
    tmux.reset_capture_cache()

    tmux.collect_state()
    _time.sleep(0.03)
    tmux.collect_state()

    assert pane.capture_calls == 2
