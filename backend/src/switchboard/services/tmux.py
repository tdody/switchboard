"""libtmux wrapper for Switchboard.

Each request to /api/state calls collect_state(), which freshly queries libtmux.
No caching in MVP. For agent panes, capture-pane is fed to claude_parser.

`# ty: ignore` on the srv.cmd(...) / server.cmd(...) calls suppresses a false
positive: libtmux's Server.cmd stub has a union signature ty reads as accepting
at most 2 positional args, despite its `*args: Any`.
"""

from __future__ import annotations

import subprocess
import time
import uuid

import libtmux

from switchboard.schemas import Client, Kind, Session, StateResponse, Status, Window
from switchboard.services import claude_parser


def get_server() -> libtmux.Server | None:
    srv = libtmux.Server()
    return srv if srv.is_alive() else None


def _to_int(value: str | int | None, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _truthy(value: str | int | None) -> bool:
    if value is None:
        return False
    if isinstance(value, int):
        return value != 0
    return value not in ("", "0")


_AGENT_CMDS = {"claude", "claude-code"}
_EDITOR_CMDS = {"nvim", "vim", "vi", "nano", "emacs", "hx", "helix", "code"}
_SERVER_HINTS = (
    "dev",
    "serve",
    "server",
    "vite",
    "next",
    "uvicorn",
    "gunicorn",
    "fastapi",
    "django",
    "rails",
    "npm",
)
_LOGS_CMDS = {"tail", "less", "journalctl", "kubectl", "k9s", "htop", "btop", "top"}


def _infer_kind(cmd: str, window_name: str) -> Kind:
    # tmux reports the binary name in #{pane_current_command}; on some platforms
    # it carries a `.exe` suffix (observed: `claude.exe` for Claude Code on
    # macOS). Strip it so the lookups match regardless.
    cmd_l = (cmd or "").lower().removesuffix(".exe")
    name_l = (window_name or "").lower()
    if cmd_l in _AGENT_CMDS or name_l.startswith("claude/") or name_l.startswith("claude-"):
        return "agent"
    if cmd_l in _EDITOR_CMDS:
        return "editor"
    if cmd_l in _LOGS_CMDS:
        return "logs"
    if any(h in cmd_l or h in name_l for h in _SERVER_HINTS):
        return "server"
    return "shell"


def _list_clients(server: libtmux.Server, session_name: str) -> list[Client]:
    out = server.cmd(
        "list-clients",
        "-t",
        session_name,  # ty: ignore
        "-F",
        "#{client_tty}|#{client_termname}|#{client_activity}",
    )
    clients: list[Client] = []
    for line in out.stdout or []:
        if not line:
            continue
        parts = line.split("|", 2)
        if len(parts) < 3:
            continue
        tty, term, since = parts
        clients.append(Client(tty=tty, term=term, since=_to_int(since) * 1000))
    return clients


def _simple_status(cmd: str, capture: list[str]) -> Status:
    cmd_l = (cmd or "").lower()
    # A long-running foreground process (not the shell prompt itself) is "running".
    shell_like = cmd_l in ("zsh", "bash", "fish", "sh", "dash", "")
    return "idle" if shell_like else "running"


def collect_state() -> StateResponse:
    srv = get_server()
    if srv is None:
        return StateResponse(sessions=[], windows=[], server_running=False)

    sessions: list[Session] = []
    windows: list[Window] = []

    for s in srv.sessions:
        name = s.session_name or ""
        clients = _list_clients(srv, name)
        sessions.append(
            Session(
                id=name,
                name=name,
                attached=_truthy(s.session_attached) or bool(clients),
                created=_to_int(s.session_created) * 1000,
                clients=clients,
            )
        )

        for w in s.windows:
            pane = w.active_pane
            if pane is None:
                continue
            try:
                capture = pane.capture_pane()
            except Exception:  # noqa: BLE001
                capture = []
            if isinstance(capture, str):
                capture = capture.splitlines()

            cmd = pane.pane_current_command or ""
            cwd = pane.pane_current_path or ""
            kind = _infer_kind(cmd, w.window_name or "")

            if kind == "agent":
                status, pending, agent = claude_parser.parse_pane(capture, cwd)
            else:
                status = _simple_status(cmd, capture)
                pending = False
                agent = None

            idx = _to_int(w.window_index)
            windows.append(
                Window(
                    id=f"{name}:{idx}",
                    pane_id=pane.pane_id or "",
                    session=name,
                    index=idx,
                    name=w.window_name or "",
                    kind=kind,
                    status=status,
                    last_activity=_to_int(getattr(w, "window_activity", None)) * 1000,
                    cmd=cmd,
                    cwd=cwd,
                    pending_input=pending,
                    agent=agent,
                    preview=capture[-8:] if capture else [],
                )
            )

    return StateResponse(sessions=sessions, windows=windows, server_running=True)


# --- pane lookup + actions ---------------------------------------------------


def get_pane(session: str, index: int):
    srv = get_server()
    if srv is None:
        return None
    try:
        sess = srv.sessions.get(session_name=session)
    except Exception:  # noqa: BLE001
        return None
    if sess is None:
        return None
    win = next((w for w in sess.windows if _to_int(w.window_index) == index), None)
    return win.active_pane if win is not None else None


def pane_kind(session: str, index: int) -> Kind | None:
    """Infer the Kind of a window's active pane; None when it can't be found.

    Mirrors get_pane's lookup but returns the inferred Kind. Used to gate
    /api/paste-image to agent panes (a plain shell can't use the @path syntax).
    """
    srv = get_server()
    if srv is None:
        return None
    try:
        sess = srv.sessions.get(session_name=session)
    except Exception:  # noqa: BLE001
        return None
    if sess is None:
        return None
    win = next((w for w in sess.windows if _to_int(w.window_index) == index), None)
    if win is None or win.active_pane is None:
        return None
    return _infer_kind(win.active_pane.pane_current_command or "", win.window_name or "")


def capture_pane(session: str, index: int, lines: int = 200) -> list[str] | None:
    """Capture recent scrollback *with* ANSI escapes (`-e`).

    Used by `GET /api/pane` and by pane_stream for the WebSocket's initial
    paint — both need color so the terminal modal isn't monochrome until new
    output streams in. `collect_state` keeps a plain (escape-free) capture for
    the parser + card preview.
    """
    pane = get_pane(session, index)
    if pane is None:
        return None
    try:
        # libtmux's Pane.capture_pane() can't pass -e; call tmux directly.
        out = pane.cmd("capture-pane", "-p", "-e", "-S", f"-{lines}")  # ty: ignore
        return list(out.stdout or [])
    except Exception:  # noqa: BLE001
        return None


def deliver_text(session: str, index: int, text: str, *, bracketed: bool) -> bool:
    """Deliver literal text to a pane via tmux load-buffer + paste-buffer.

    The text enters tmux on stdin (`load-buffer ... -`), so tmux's command
    parser never sees it as an argv element. This is what fixes `send-keys -l`
    silently dropping a standalone `;` (tmux treats a bare `;` arg as a command
    separator) and stripping embedded newlines.

    `bracketed` adds `-p`, wrapping the paste in bracketed-paste markers so a
    multi-line block's newlines don't each submit — the caller sends an explicit
    Enter afterward.
    """
    target = f"{session}:{index}"
    buf = f"sb-in-{uuid.uuid4().hex[:8]}"
    paste_args = ["tmux", "paste-buffer", "-d"]
    if bracketed:
        paste_args.append("-p")
    paste_args += ["-b", buf, "-t", target]
    try:
        load = subprocess.run(
            ["tmux", "load-buffer", "-b", buf, "-"],
            input=text,
            text=True,
            capture_output=True,
            timeout=5,
        )
        if load.returncode != 0:
            return False
        paste = subprocess.run(paste_args, capture_output=True, text=True, timeout=5)
        return paste.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def send_keys(
    session: str,
    index: int,
    *,
    keys: list[str] | None = None,
    paste: str | None = None,
    bracketed: bool = False,
) -> bool:
    pane = get_pane(session, index)
    if pane is None:
        return False
    target = f"{session}:{index}"
    srv = get_server()
    if srv is None:
        return False
    try:
        if paste is not None:
            # Literal text goes through deliver_text (load-buffer/paste-buffer)
            # rather than `send-keys -l`, which silently drops a standalone `;`.
            if not deliver_text(session, index, paste, bracketed=bracketed):
                return False
            if keys:
                # Grace so a TUI applies the pasted block before Enter lands.
                time.sleep(0.10)
        if keys:
            for key in keys:
                srv.cmd("send-keys", "-t", target, key)  # ty: ignore
        return True
    except Exception:  # noqa: BLE001
        return False


def send_signal(session: str, index: int, signal: str) -> bool:
    """Send a non-literal key like C-c, Enter, Up, etc."""
    srv = get_server()
    if srv is None:
        return False
    try:
        srv.cmd("send-keys", "-t", f"{session}:{index}", signal)  # ty: ignore
        return True
    except Exception:  # noqa: BLE001
        return False


def rename_window(session: str, index: int, name: str) -> bool:
    srv = get_server()
    if srv is None:
        return False
    target = f"{session}:{index}"
    try:
        result = srv.cmd("rename-window", "-t", target, name)  # ty: ignore
        return not (result.stderr and any(result.stderr))
    except Exception:  # noqa: BLE001
        return False


def focus(session: str, index: int) -> bool | None:
    """select-window for the target, then switch every attached client of that session."""
    srv = get_server()
    if srv is None:
        return None
    target = f"{session}:{index}"
    try:
        sess = srv.sessions.get(session_name=session)
    except Exception:  # noqa: BLE001
        return None
    if sess is None:
        return None
    try:
        srv.cmd("select-window", "-t", target)  # ty: ignore
    except Exception:  # noqa: BLE001
        return False

    out = srv.cmd("list-clients", "-t", session, "-F", "#{client_tty}")  # ty: ignore
    ttys = [t for t in (out.stdout or []) if t]
    if not ttys:
        return False
    for tty in ttys:
        try:
            srv.cmd("switch-client", "-c", tty, "-t", session)  # ty: ignore
        except Exception:  # noqa: BLE001
            continue
    return True


def _cmd_ok(srv: libtmux.Server, *args: str) -> bool:
    """Run a tmux command; True when it produced no stderr."""
    try:
        # No type-ignore needed here (unlike the literal-arg srv.cmd sites):
        # ty can't analyze the `*args` unpack, so it raises no false positive.
        result = srv.cmd(*args)
        return not (result.stderr and any(result.stderr))
    except Exception:  # noqa: BLE001
        return False


def kill_window(session: str, index: int) -> bool:
    """kill-window for `session:index`. False when the window doesn't exist.

    Note: killing the last window of a session destroys the session too — and
    the last session stops the tmux server. The next /api/state poll reflects
    that; nothing here needs to special-case it.
    """
    srv = get_server()
    if srv is None:
        return False
    return _cmd_ok(srv, "kill-window", "-t", f"{session}:{index}")


def kill_session(session: str) -> bool:
    """kill-session for `session`. False when the session doesn't exist."""
    srv = get_server()
    if srv is None:
        return False
    return _cmd_ok(srv, "kill-session", "-t", session)


def new_window(session: str, name: str) -> int | None:
    """new-window in `session`; return the new window index, or None on failure.

    `-P -F #{window_index}` makes tmux print the created window's index so the
    caller can build its `session:index` id without a follow-up state query.
    """
    srv = get_server()
    if srv is None:
        return None
    try:
        result = srv.cmd("new-window", "-t", session, "-n", name, "-P", "-F", "#{window_index}")  # ty: ignore
        if result.stderr and any(result.stderr):
            return None
        out = [line for line in (result.stdout or []) if line.strip()]
        return int(out[0]) if out else None
    except Exception:  # noqa: BLE001
        return None


def detach_client(tty: str) -> bool:
    """detach-client for a specific client tty. False when no such client.

    ttys are unique across the tmux server, so the target is the tty alone —
    the ticket's `session` param is redundant and the route omits it.
    """
    srv = get_server()
    if srv is None:
        return False
    return _cmd_ok(srv, "detach-client", "-t", tty)
