"""libtmux wrapper for Switchboard.

Each request to /api/state calls collect_state(), which freshly queries libtmux.
No caching in MVP. For agent panes, capture-pane is fed to claude_parser.

`# ty: ignore` on the srv.cmd(...) / server.cmd(...) calls suppresses a false
positive: libtmux's Server.cmd stub has a union signature ty reads as accepting
at most 2 positional args, despite its `*args: Any`.
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import uuid
from concurrent.futures import Future

import libtmux

from switchboard.schemas import Client, Kind, Session, StateResponse, Status, Window
from switchboard.services import claude_parser

log = logging.getLogger(__name__)

# Single-flight slot for /api/state collection (THI-142). When a scan is in
# flight, concurrent callers wait on this Future instead of each spawning
# their own batch of tmux subprocesses — bounds peak FD usage to one scan's
# worth and prevents the OSError [Errno 24] cascade under modal-open polling.
_inflight_lock = threading.Lock()
_inflight: Future[StateResponse] | None = None

# THI-181: per-pane capture cache, sized for the modal-open polling cadence
# (MODAL_OPEN_POLL_MS = 500 ms on the frontend). With TTL roughly equal to
# the polling cadence, two consecutive polls separated by ~500 ms have a
# coin-flip chance of sharing a cache entry — halving capture-pane subprocess
# load while a modal is open without staling the 8-line preview meaningfully.
# Keyed by pane_id (tmux's stable %N identity) so window renames and session
# restarts don't poison the cache. Bounded only by distinct panes ever seen
# in this process — small enough not to need explicit eviction.
_CAPTURE_CACHE_TTL_S = 0.5
_capture_cache_lock = threading.Lock()
_capture_cache: dict[str, tuple[float, list[str]]] = {}


def reset_capture_cache() -> None:
    """Clear the THI-181 per-pane capture cache. Exposed for tests that need
    isolation from prior runs; production code does not call this."""
    with _capture_cache_lock:
        _capture_cache.clear()


def _raw_capture(pane) -> list[str]:
    """Run pane.capture_pane() and normalize to list[str]. No caching, no
    exception leak — failures become an empty capture so collect_state
    still emits the window with whatever non-capture metadata it has."""
    try:
        capture = pane.capture_pane()
    except Exception:  # noqa: BLE001
        return []
    if isinstance(capture, str):
        capture = capture.splitlines()
    return capture


def _capture_pane_cached(pane) -> list[str]:
    """Cache-wrapped pane.capture_pane() for collect_state (THI-181).

    See `_CAPTURE_CACHE_TTL_S` for the lifetime and rationale. Cache miss
    fires a fresh capture-pane; hits within TTL skip the subprocess entirely.
    Panes without a stable pane_id bypass the cache.
    """
    pane_id = pane.pane_id or ""
    if not pane_id:
        return _raw_capture(pane)
    now = time.monotonic()
    with _capture_cache_lock:
        entry = _capture_cache.get(pane_id)
        if entry is not None and now - entry[0] < _CAPTURE_CACHE_TTL_S:
            return entry[1]
    capture = _raw_capture(pane)
    with _capture_cache_lock:
        _capture_cache[pane_id] = (now, capture)
    return capture


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
        # Hide internal scrape sessions from the dashboard (THI-110 commit 3).
        # `sb-usage-<uuid8>` sessions are created/killed by claude_usage's
        # /usage scrape every ~5 min. The scrape lifecycle is tiny but
        # racy with /api/state polls: if `s.windows` is queried after the
        # scrape's `tmux kill-session`, libtmux raises LibTmuxException.
        # Filtering here also keeps these sessions out of the kanban UI,
        # which is the right answer regardless of the race.
        if name.startswith("sb-usage-"):
            continue
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

        # Defense-in-depth: even after the `sb-usage-` filter, ANY session
        # can vanish between `srv.sessions` and `s.windows` (the user runs
        # `tmux kill-session` from a shell). Per-session libtmux failures
        # used to crash the whole /api/state call with a 500; now they
        # demote to a skipped session card and the dashboard keeps polling.
        try:
            session_windows = list(s.windows)
        except Exception:  # noqa: BLE001 — libtmux can raise its own errors here
            log.warning("collect_state: failed to list windows for session %r", name)
            continue

        for w in session_windows:
            pane = w.active_pane
            if pane is None:
                continue
            # THI-181: routed through a short-TTL per-pane cache so back-to-back
            # /api/state polls under modal-open cadence don't fan out into one
            # capture-pane subprocess per window per tick.
            capture = _capture_pane_cached(pane)

            cmd = pane.pane_current_command or ""
            cwd = pane.pane_current_path or ""
            kind = _infer_kind(cmd, w.window_name or "")

            if kind == "agent":
                status, pending, agent = claude_parser.parse_pane(capture, cwd)
            else:
                status = _simple_status(cmd, capture)
                pending = False
                agent = None

            # Surface the cwd's git branch on every pane, not just agent ones,
            # so shell tiles get a branch chip too. For agent panes, parse_pane
            # has already populated `agent.branch` via the same `_git_branch`
            # helper — the call below hits the 2 s cache (THI-126), so the
            # subprocess cost is the same as before.
            branch = claude_parser._git_branch(cwd) if cwd else None
            # PR / CI rollup is keyed by (cwd, branch) and 60 s-cached, so the
            # same lookup serves every pane on that branch — agent or shell.
            # Shell tiles on a branch with an open PR get the same CI-tinted
            # chip the kanban agent card shows. `pr_url` lights up the chip
            # as a link (THI-146 PR 2).
            pr, ci, pr_url = claude_parser._gh_pr(cwd, branch) if branch else (None, None, None)
            # Repo URL is computed independently of PR existence so the in-pane
            # `PR #N` linkifier still has a base URL on branches with no open
            # PR. Pure local git, cached 5 min.
            repo_url = claude_parser._git_repo_url(cwd) if cwd else None
            # THI-243: repo toplevel + display label, used by the grouping-mode
            # toggle to bucket panes in the discovery view. Cached 60 s — long
            # enough to absorb noise, short enough that a freshly-opened pane
            # in a new repo appears quickly.
            repo_key = claude_parser._git_repo_root(cwd) if cwd else None
            repo_label = os.path.basename(repo_key.rstrip("/")) if repo_key else None

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
                    branch=branch,
                    pr=pr,
                    pr_url=pr_url,
                    ci=ci,
                    repo_url=repo_url,
                    repo_key=repo_key,
                    repo_label=repo_label,
                    agent=agent,
                    preview=capture[-8:] if capture else [],
                )
            )

    return StateResponse(sessions=sessions, windows=windows, server_running=True)


def collect_state_singleflight() -> StateResponse:
    """Single-flight wrapper around `collect_state` (THI-142).

    Bounds concurrent tmux-subprocess spawning so repeated /api/state polling
    under the modal-open cadence can't exhaust file descriptors.

    Behaviour:
    - First caller becomes the leader, runs `collect_state`, and resolves
      a shared `Future` with the result (or exception).
    - Concurrent followers block on `Future.result()` and receive the
      leader's outcome — identical state object, or identical exception.
    - After the leader finishes, the in-flight slot clears so the next
      caller starts a fresh scan; there is no caching across scans.
    """
    global _inflight
    with _inflight_lock:
        existing = _inflight
        if existing is None:
            future: Future[StateResponse] = Future()
            _inflight = future
    if existing is not None:
        # Follower path. `.result()` blocks until the leader resolves the
        # future; if the leader raised, the same exception propagates.
        return existing.result()
    # Leader path. Set the result (or exception) on the future BEFORE
    # clearing the in-flight slot — a follower that's already past the
    # lock and into `.result()` would otherwise miss the resolution and
    # block forever.
    try:
        state = collect_state()
        future.set_result(state)
        return state
    except BaseException as exc:
        future.set_exception(exc)
        raise
    finally:
        with _inflight_lock:
            _inflight = None


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


def pane_cwd(session: str, index: int) -> str | None:
    """Return the active pane's cwd for `session:index`, or None when the
    pane can't be found. Used by POST /api/open to scope file-path opens to
    a pane-local directory (THI-146 PR 3)."""
    pane = get_pane(session, index)
    if pane is None:
        return None
    return pane.pane_current_path or None


def pane_kind(session: str, index: int) -> Kind | None:
    """Infer the Kind of a window's active pane; None when it can't be found.

    Mirrors get_pane's lookup but returns the inferred Kind. Used to gate
    agent-only paths: /api/paste-image (a plain shell can't use the @path
    syntax) and pane_stream's prompt parsing (a shell can echo "[Y/n]").
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
        out = pane.cmd("capture-pane", "-p", "-e", "-S", f"-{lines}")
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


def _is_send_keys_l_safe(text: str) -> bool:
    """True iff `tmux send-keys -l text` is the right delivery path.

    Two fall-back triggers — both about end-user semantics, not tmux parser
    quirks (`send-keys -l` actually delivers `;` / `\\n` / `\\r` verbatim on
    tmux 3.6+):

    - `;` — conservative reject: a trailing `;` is still eaten by tmux's
      command parser as a command separator. Easier to reject any `;` than
      probe for position; the slow path is correct in either case.
    - `\\n` / `\\r` — an embedded LF/CR delivered as a literal keystroke is
      interpreted as Enter by most shells/TUIs, which would submit a
      multi-line paste line-by-line. Route to load-buffer/paste-buffer so
      the bytes land atomically and any bracketed-paste wrapping (THI-116)
      can preserve multi-line intent.

    The fast path saves ~20-40ms per keystroke vs. deliver_text's two
    subprocess.run forks — the win that makes typing in the modal feel
    responsive (THI-124).
    """
    return ";" not in text and "\n" not in text and "\r" not in text


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
            # Fast path for per-keystroke typing: a safe single libtmux command
            # is ~50x cheaper than the two subprocess forks in deliver_text and
            # cuts ~20-40ms of latency per keystroke (THI-124). bracketed=True
            # forces the slow path because the paste markers must wrap the
            # whole block, not be split per char.
            if not bracketed and _is_send_keys_l_safe(paste):
                srv.cmd("send-keys", "-t", target, "-l", paste)  # ty: ignore
            else:
                # THI-116 correctness path: load-buffer/paste-buffer survives
                # bare `;` and embedded newlines that `send-keys -l` drops.
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


def get_window_size(session: str, index: int) -> tuple[str, int, int] | None:
    """Read the window's current window-size mode + dimensions.

    Returns (mode, cols, rows) so a caller can restore the window after a
    temporary resize. None when the lookup fails (window gone, tmux down).
    """
    srv = get_server()
    if srv is None:
        return None
    target = f"{session}:{index}"
    dims_fmt = "#{window_width} #{window_height}"
    try:
        mode_out = srv.cmd("show-option", "-t", target, "-w", "-v", "window-size")  # ty: ignore
        dims_out = srv.cmd("display-message", "-t", target, "-p", dims_fmt)  # ty: ignore
        mode = (mode_out.stdout or [""])[0].strip() or "latest"
        dims = (dims_out.stdout or [""])[0].strip().split()
        if len(dims) != 2:
            return None
        return mode, int(dims[0]), int(dims[1])
    except (ValueError, Exception):  # noqa: BLE001
        return None


def resize_window(session: str, index: int, cols: int, rows: int) -> bool:
    """Resize the window containing pane `session:index` to (cols, rows).

    tmux ignores `resize-window` unless `window-size` is `manual`, so we
    switch the option first. Callers that want the original size/mode back
    should snapshot via `get_window_size` beforehand and pass the result to
    `restore_window_size`.
    """
    srv = get_server()
    if srv is None:
        return False
    target = f"{session}:{index}"
    try:
        srv.cmd("setw", "-t", target, "window-size", "manual")  # ty: ignore
        srv.cmd("resize-window", "-t", target, "-x", str(cols), "-y", str(rows))  # ty: ignore
        return True
    except Exception:  # noqa: BLE001
        return False


def restore_window_size(session: str, index: int, mode: str, cols: int, rows: int) -> bool:
    """Restore a window to a previously-snapshotted size + window-size mode.

    Restoring the mode is what re-lets the largest attached client drive the
    geometry (the normal "latest"/"largest" behavior). Without this, the
    window stays at whatever Switchboard set even after the modal closes.
    """
    srv = get_server()
    if srv is None:
        return False
    target = f"{session}:{index}"
    try:
        srv.cmd("resize-window", "-t", target, "-x", str(cols), "-y", str(rows))  # ty: ignore
        srv.cmd("setw", "-t", target, "window-size", mode)  # ty: ignore
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


def rename_session(old: str, new: str) -> bool:
    """rename-session `old` -> `new`. False on tmux error (missing source or
    duplicate target name).

    `-t` here is a target-session, not target-window, so a bare numeric name
    is safely resolved as a session — no need for the trailing-colon dance
    that new_window uses (THI-119).
    """
    srv = get_server()
    if srv is None:
        return False
    return _cmd_ok(srv, "rename-session", "-t", old, new)


def new_window(session: str, name: str, *, cwd: str | None = None) -> int | None:
    """new-window in `session`; return the new window index, or None on failure.

    `-P -F #{window_index}` makes tmux print the created window's index so the
    caller can build its `session:index` id without a follow-up state query.
    `cwd` (THI-99) passes `-c` so the new window starts in a specific
    directory — used by the templates instantiate path.
    """
    srv = get_server()
    if srv is None:
        return None
    try:
        # Trailing colon forces tmux to parse the target as `session:` (no
        # window-index), not as a bare `target-window`. Without it, a numeric
        # session name like "83" is taken as window-index 83 of the current
        # session — landing the new window in the wrong session (THI-119).
        target = f"{session}:"
        args: list[str] = ["new-window", "-t", target, "-n", name]
        if cwd:
            args.extend(["-c", cwd])
        args.extend(["-P", "-F", "#{window_index}"])
        result = srv.cmd(*args)
        if result.stderr and any(result.stderr):
            return None
        out = [line for line in (result.stdout or []) if line.strip()]
        return int(out[0]) if out else None
    except Exception:  # noqa: BLE001
        return None


def new_session(name: str, *, window_name: str | None = None, cwd: str | None = None) -> bool:
    """new-session -d -s `name`. False on tmux error (duplicate name, etc).

    Intentionally bypasses `get_server()` — `tmux new-session` starts a tmux
    server on demand, so the "New Session" button in the header (THI-144)
    works from the empty state too.

    `window_name` and `cwd` (THI-99) pass `-n` and `-c` so the session's
    first window can be named and rooted in one tmux call — used by the
    templates instantiate path.
    """
    srv = libtmux.Server()
    args: list[str] = ["new-session", "-d", "-s", name]
    if window_name:
        args.extend(["-n", window_name])
    if cwd:
        args.extend(["-c", cwd])
    return _cmd_ok(srv, *args)


def detach_client(tty: str) -> bool:
    """detach-client for a specific client tty. False when no such client.

    ttys are unique across the tmux server, so the target is the tty alone —
    the ticket's `session` param is redundant and the route omits it.
    """
    srv = get_server()
    if srv is None:
        return False
    return _cmd_ok(srv, "detach-client", "-t", tty)
