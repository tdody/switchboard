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
        lambda args, **kw: calls.append(args)
        or SimpleNamespace(returncode=0, stdout=b"", stderr=b""),
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
