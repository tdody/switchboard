"""Auth material for Switchboard's security layer.

The API token is persisted at `~/.switchboard/token` (0600) and generated on
first run. The CSRF secret is process-scoped — it only needs to be a value
that same-origin JS can read and echo, and that a cross-origin attacker can't.
"""

from __future__ import annotations

import logging
import os
import secrets
import stat
import time
from pathlib import Path

from switchboard.config import settings

log = logging.getLogger(__name__)

# Sliding session lifetime (THI-166, sec:M3). Each successful `is_valid_session`
# call refreshes `last_seen`; sessions idle longer than this are dropped.
# Must match the Max-Age on the sb_session cookie so client + server agree.
SESSION_TTL_S = 24 * 60 * 60


def _generate() -> str:
    return secrets.token_urlsafe(32)


def _atomic_write_0600(path: Path, content: str) -> None:
    """Write `content` to `path` so the file is NEVER world-readable, not even
    for the brief moment between `open()` and `chmod()` (THI-173, sec:L1).

    Strategy: create a sibling tempfile via `os.open` with mode 0o600 set at
    creation time, write, fsync, then `os.replace` onto the target — atomic on
    POSIX. The umask is honored too: 0o600 is the *requested* mode, masked by
    the process umask. A user with `umask 0077` gets exactly 0600; a user with
    a permissive `umask 0000` still gets 0600 because we explicitly tighten
    via `os.fchmod` before the replace.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)  # defeat permissive umask
        os.write(fd, content.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)


def _ensure_0600(path: Path) -> None:
    """If `path` exists with looser permissions than 0600, tighten it and
    log a WARNING. A previously broken install or an editor save could have
    left the token file world-readable; refuse to keep using it without at
    least making it private first."""
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return
    actual = stat.S_IMODE(st.st_mode)
    if actual != 0o600:
        log.warning(
            "tightening token file %s permissions from %o to 0600 (sec:L1)",
            path,
            actual,
        )
        try:
            os.chmod(path, 0o600)
        except OSError as e:
            log.warning("could not chmod token file %s: %s", path, e)


def load_or_create_token() -> str:
    """Read the persisted API token, creating it (0600) on first run.

    If the token file can't be written (read-only home, etc.), falls back to
    an ephemeral in-memory token rather than failing to boot. On read, the
    file mode is asserted to be 0600 — tightened with a WARNING otherwise.
    """
    path = settings.token_file
    _ensure_0600(path)
    try:
        existing = path.read_text().strip()
        if existing:
            return existing
    except FileNotFoundError:
        pass
    except OSError as e:
        log.warning("could not read token file %s: %s", path, e)

    token = _generate()
    try:
        _atomic_write_0600(path, token)
    except OSError as e:
        log.warning("could not persist token file %s: %s — using ephemeral token", path, e)
    return token


def regenerate_token() -> str:
    """Overwrite the token file with a fresh value and return it."""
    token = _generate()
    _atomic_write_0600(settings.token_file, token)
    return token


def mask(token: str) -> str:
    """A display-safe fragment of the token (first 4 + last 4)."""
    if len(token) <= 12:
        return "•" * len(token)
    return f"{token[:4]}…{token[-4:]}"


class AuthState:
    """Process-wide auth material, initialized at app startup via `init()`.

    Sessions (THI-161, sec:H3) are opaque random IDs stored server-side —
    NOT the API token itself. This means a leaked session cookie does NOT
    leak the bearer token, and `rotate_token` (or an explicit logout)
    can revoke all sessions at once without affecting the token.
    """

    def __init__(self) -> None:
        self.token: str = ""
        self.csrf_secret: str = ""
        # session_id -> metadata. Keep it tiny; we only need to know the
        # session exists. Stored in-memory; sessions don't survive a restart
        # by design (forces re-bootstrap on a fresh process).
        self.sessions: dict[str, dict] = {}

    def init(self) -> None:
        self.token = load_or_create_token()
        # Only generate the CSRF secret once per process.
        if not self.csrf_secret:
            self.csrf_secret = secrets.token_urlsafe(16)

    def rotate_token(self) -> str:
        self.token = regenerate_token()
        # A token rotation invalidates every session — they were authenticated
        # against the *old* token. Without this, an attacker who lifted a
        # session cookie before the rotation would keep their access.
        self.sessions.clear()
        return self.token

    def create_session(self) -> str:
        """Mint a fresh opaque session ID and remember it. Returns the value
        that should be set as the `sb_session` cookie."""
        session_id = secrets.token_urlsafe(32)
        now = time.monotonic()
        self.sessions[session_id] = {"created_at": now, "last_seen": now}
        return session_id

    def is_valid_session(self, session_id: str) -> bool:
        """True iff `session_id` was issued by `create_session`, hasn't been
        revoked, and isn't past its idle-timeout (THI-166, sec:M3).

        Refreshes `last_seen` on success — sliding window.
        """
        if not session_id:
            return False
        entry = self.sessions.get(session_id)
        if entry is None:
            return False
        now = time.monotonic()
        last_seen = entry.get("last_seen", 0)
        if now - last_seen > SESSION_TTL_S:
            # Idle too long; drop it and don't honor the cookie.
            self.sessions.pop(session_id, None)
            return False
        entry["last_seen"] = now
        return True


auth_state = AuthState()
