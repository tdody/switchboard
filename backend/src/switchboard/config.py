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

    # Auto-rename modal (THI-67). The Anthropic SDK is lazy-imported so the
    # server still boots without a key — `/api/auto-rename/*` returns 503 and
    # the frontend hides the ✨ button until a key is set.
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-haiku-4-5"
    # How many lines of pane scrollback to feed the model per window. Trades
    # token cost for context quality; 80 mirrors periscope's default.
    anthropic_capture_lines: int = 80

    # Where Claude Code logs each assistant turn — one JSONL per session under a
    # per-cwd subdirectory. Used by `services/claude_usage` (THI-110) to
    # aggregate rolling-window token usage.
    claude_projects_dir: Path = Path.home() / ".claude" / "projects"

    # When True, the /api/usage endpoint also spawns `claude /usage` in a
    # hidden tmux session every 5 min to parse plan percentages (session / week
    # / week-Sonnet meters). Each scrape costs ~hundreds of claude tokens and a
    # ~15s subprocess; the cost is tiny relative to interactive Claude usage
    # but explicit. Disable via `SWITCHBOARD_USAGE_SCRAPE_ENABLED=false` if you
    # don't want any background claude invocations (THI-110 commit 2).
    usage_scrape_enabled: bool = True

    # Binary invoked by POST /api/open to launch the user's IDE on a clicked
    # file path (THI-146 PR 3). Restricted to a known whitelist of GUI editor
    # launchers — Switchboard MUST NOT spawn arbitrary commands on behalf of a
    # mutating HTTP request, because any compromise of the loopback origin
    # (e.g. a malicious local script with the CSRF cookie) would otherwise
    # land as full RCE. Set to "" or any non-whitelisted name to disable the
    # endpoint entirely; the frontend hides file-path linkification when
    # disabled. Env: SWITCHBOARD_IDE_CMD.
    ide_cmd: str = "code"

    model_config = SettingsConfigDict(env_prefix="SWITCHBOARD_", env_file=".env")

    # GUI editor launchers — extend cautiously. Anything added here can be
    # spawned with an attacker-supplied (but cwd-contained) path argument; do
    # not include shells or arbitrary "runners".
    IDE_ALLOWLIST: frozenset[str] = frozenset(
        {
            "code",
            "code-insiders",
            "cursor",
            "subl",
            "idea",
            "pycharm",
            "webstorm",
            "rubymine",
            "goland",
            "rider",
            "clion",
            "phpstorm",
        }
    )

    @property
    def loopback_mode(self) -> bool:
        return is_loopback_host(self.host)

    @property
    def anthropic_enabled(self) -> bool:
        """True iff an API key is configured (via env or .env). Drives the
        503 / 200 fork in `routers/rename_ai` and lets the frontend hide the
        ✨ button before clicking discovers the key is missing."""
        # Either an explicit setting or the standard SDK env var counts —
        # the Anthropic SDK reads ANTHROPIC_API_KEY itself, so a user with
        # that exported in their shell doesn't need to set the prefixed one.
        import os

        return bool(self.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY"))

    @property
    def ide_enabled(self) -> bool:
        """True only when `ide_cmd` is a known GUI editor binary. Frontend
        hides the file-path linkifier when this is false (THI-146 PR 3)."""
        return self.ide_cmd in self.IDE_ALLOWLIST

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
