import ipaddress
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def is_loopback_host(host: str) -> bool:
    """True if `host` resolves to a loopback address (or is literally localhost)."""
    h = (host or "").strip().lower()
    if h in ("", "localhost"):
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8765
    cors_origins: list[str] = ["http://localhost:5173"]
    pane_capture_lines: int = 200
    paste_image_max_bytes: int = 10 * 1024 * 1024  # 10 MiB cap on /api/paste-image

    # Auth is auto-enabled when bound to a non-loopback host. Set explicitly
    # (SWITCHBOARD_AUTH_REQUIRED=true/false) to override.
    auth_required: bool | None = None
    token_file: Path = Path.home() / ".switchboard" / "token"

    # Where Claude Code logs each assistant turn — one JSONL per session under a
    # per-cwd subdirectory. Used by `services/claude_usage` (THI-110) to
    # aggregate rolling-window token usage.
    claude_projects_dir: Path = Path.home() / ".claude" / "projects"

    model_config = SettingsConfigDict(env_prefix="SWITCHBOARD_", env_file=".env")

    @property
    def loopback_mode(self) -> bool:
        return is_loopback_host(self.host)

    @property
    def auth_enabled(self) -> bool:
        if self.auth_required is not None:
            return self.auth_required
        return not self.loopback_mode

    @property
    def allowed_hosts(self) -> set[str]:
        """Host header values accepted in loopback mode (anti DNS-rebinding)."""
        hosts: set[str] = set()
        for name in ("127.0.0.1", "localhost", "[::1]"):
            hosts.add(name)
            hosts.add(f"{name}:{self.port}")
        hosts.add(self.host)
        hosts.add(f"{self.host}:{self.port}")
        return hosts


settings = Settings()
