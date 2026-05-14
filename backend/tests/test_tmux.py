import pytest

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
