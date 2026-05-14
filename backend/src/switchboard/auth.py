"""Auth material for Switchboard's security layer.

The API token is persisted at `~/.switchboard/token` (0600) and generated on
first run. The CSRF secret is process-scoped — it only needs to be a value
that same-origin JS can read and echo, and that a cross-origin attacker can't.
"""

from __future__ import annotations

import logging
import secrets
import stat

from switchboard.config import settings

log = logging.getLogger(__name__)


def _generate() -> str:
    return secrets.token_urlsafe(32)


def load_or_create_token() -> str:
    """Read the persisted API token, creating it (0600) on first run.

    If the token file can't be written (read-only home, etc.), falls back to
    an ephemeral in-memory token rather than failing to boot.
    """
    path = settings.token_file
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
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token)
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError as e:
        log.warning("could not persist token file %s: %s — using ephemeral token", path, e)
    return token


def regenerate_token() -> str:
    """Overwrite the token file with a fresh value and return it."""
    token = _generate()
    path = settings.token_file
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token)
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    return token


def mask(token: str) -> str:
    """A display-safe fragment of the token (first 4 + last 4)."""
    if len(token) <= 12:
        return "•" * len(token)
    return f"{token[:4]}…{token[-4:]}"


class AuthState:
    """Process-wide auth material, initialized at app startup via `init()`."""

    def __init__(self) -> None:
        self.token: str = ""
        self.csrf_secret: str = ""

    def init(self) -> None:
        self.token = load_or_create_token()
        # Only generate the CSRF secret once per process.
        if not self.csrf_secret:
            self.csrf_secret = secrets.token_urlsafe(16)

    def rotate_token(self) -> str:
        self.token = regenerate_token()
        return self.token


auth_state = AuthState()
