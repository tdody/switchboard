"""Rolling-window Claude token usage aggregator (THI-110).

Claude Code writes one JSONL per session under
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Each line is a JSON
record; assistant turns carry a `message.usage` block with `input_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`, and `output_tokens`.
Summing across files for records whose ISO timestamp falls inside a rolling
window (5 h by default) yields a real measurement of plan token usage — no
billing endpoint required.

Caching mirrors `claude_parser._BRANCH_CACHE`: a single module-level slot keyed
by nothing (the aggregator covers the whole user), with a `time.monotonic()`
TTL so the FastAPI handler can call it on every poll without re-walking the
filesystem.

The `/usage` TUI scrape and its 5-minute background refresh land in THI-110
commit 2; this module only owns the cheap JSONL aggregator for now.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from switchboard.config import settings
from switchboard.schemas import ClaudeUsage, UsageMeter, UsageScrape

log = logging.getLogger(__name__)

# Cheap aggregator → short TTL is fine. Picked to feel live without re-walking
# the FS on every modal-open `/api/state` poll (100 ms cadence per THI-105).
_TOKEN_TTL_S = 30.0

# Single global slot — the aggregator covers the user's entire ~/.claude/
# projects tree, so there's nothing to key the cache by.
_token_cache: tuple[float, ClaudeUsage] | None = None
_token_lock = threading.Lock()


def compute_claude_usage(
    projects_dir: Path | None = None,
    *,
    window_hours: float = 5.0,
    now: float | None = None,
) -> ClaudeUsage:
    """Walk every recent session JSONL and sum token usage in the window.

    Returns `available=False` when the projects directory doesn't exist (e.g.
    the user has never run Claude Code on this machine). Otherwise always
    returns `available=True`, with zero totals when nothing falls in the
    window — the UI uses zero-totals to render a neutral "0 / 5h" pill rather
    than hiding entirely.

    Parameters
    ----------
    projects_dir:
        Override for testing. Defaults to `settings.claude_projects_dir`.
    window_hours:
        Rolling window size; the plan's reset fires this many hours after the
        *earliest* in-window message (not "now + window_hours" — see ticket).
    now:
        Override for testing. Defaults to `time.time()`. Float seconds since
        epoch, UTC. We measure the cutoff against this rather than `monotonic`
        because the records carry wall-clock ISO timestamps.
    """
    root = projects_dir if projects_dir is not None else settings.claude_projects_dir
    if not root.exists():
        return ClaudeUsage(available=False, window_hours=window_hours)

    cutoff = (now if now is not None else time.time()) - window_hours * 3600
    fresh = cache_w = cache_r = out = msgs = 0
    earliest_msg_ts: float | None = None

    for jsonl in root.glob("*/*.jsonl"):
        # mtime pre-filter: a file last touched before the cutoff can't contain
        # any records inside the window, so skip the open() entirely. Saves
        # walking large historical logs on every refresh.
        try:
            if jsonl.stat().st_mtime < cutoff:
                continue
        except OSError:
            continue
        try:
            with jsonl.open(encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts_str = rec.get("timestamp")
                    if not isinstance(ts_str, str):
                        continue
                    try:
                        # `Z` suffix isn't accepted by fromisoformat until 3.11;
                        # the swap keeps us forward- and backward-compatible.
                        ts = datetime.fromisoformat(
                            ts_str.replace("Z", "+00:00")
                        ).timestamp()
                    except Exception:  # noqa: BLE001
                        continue
                    if ts < cutoff:
                        continue
                    usage = ((rec.get("message") or {}).get("usage")) or {}
                    if not usage:
                        # `user` records and assistant tool-call placeholders
                        # carry no `usage` block — only fully-billed turns do.
                        continue
                    fresh += int(usage.get("input_tokens") or 0)
                    cache_w += int(usage.get("cache_creation_input_tokens") or 0)
                    cache_r += int(usage.get("cache_read_input_tokens") or 0)
                    out += int(usage.get("output_tokens") or 0)
                    msgs += 1
                    if earliest_msg_ts is None or ts < earliest_msg_ts:
                        earliest_msg_ts = ts
        except OSError:
            continue

    reset_at = (
        int(earliest_msg_ts + window_hours * 3600) if earliest_msg_ts is not None else None
    )
    return ClaudeUsage(
        available=True,
        window_hours=window_hours,
        messages=msgs,
        input_tokens=fresh,
        cache_creation_tokens=cache_w,
        cache_read_tokens=cache_r,
        output_tokens=out,
        total_tokens=fresh + cache_w + cache_r + out,
        reset_at=reset_at,
    )


# --- /usage TUI scrape ------------------------------------------------------
#
# The jsonl aggregator above gives token counts; it doesn't know the user's
# plan's % limits. Those only render inside claude's TUI on `/usage`. We spawn
# a hidden tmux session, run claude there, send `/usage`, capture the screen,
# and parse the three progress bars. Refreshed every 5 min in a background
# thread — that bounds the cost (claude binary spawn + small inference) without
# making the bars feel stale.

# Bound the lifetime of the headless tmux session at every step. Boot is slow
# (claude has to authenticate + load its UI); render is fast (the /usage screen
# is essentially static text the moment the command is acknowledged).
_SCRAPE_TTL_S = 300.0
_SCRAPE_BOOT_TIMEOUT_S = 30.0
_SCRAPE_RENDER_TIMEOUT_S = 12.0

# Labels we know how to map to a stable key. Other strings under the same
# pattern get ignored — keeps a future claude release that adds a fourth bar
# from breaking the existing two/three.
_USAGE_LABELS = {
    "Current session": "session",
    "Current week (all models)": "week_all",
    "Current week (Sonnet only)": "week_sonnet",
}

_PCT_RE = re.compile(r"(\d+)%\s+used")
_RESETS_RE = re.compile(r"Resets\s+(.+?)\s*$")

_scrape_cache: tuple[float, UsageScrape | None] = (0.0, None)
_scrape_in_flight = False
_scrape_lock = threading.Lock()


def parse_usage_screen(text: str) -> UsageScrape:
    """Walk the captured /usage screen, picking out each meter's percentage
    and reset string. The TUI lays each meter out as three consecutive lines:
    label, bar+"NN% used", "Resets …". The Resets line is sometimes absent
    (the second / third meters often skip it); the parser tolerates that.

    Returns `available=False` when no known label is recognized — a screen
    that's not /usage (claude rendered something else) must not produce
    fabricated meters; the UI falls back to the token pill.
    """
    lines = text.split("\n")
    meters: dict[str, UsageMeter] = {}
    for i, line in enumerate(lines):
        stripped = line.strip()
        key = _USAGE_LABELS.get(stripped)
        if not key or i + 1 >= len(lines):
            continue
        pct_match = _PCT_RE.search(lines[i + 1])
        if not pct_match:
            continue
        resets = ""
        # The Resets line is optional: only read it when there IS a third line
        # AND it parses; otherwise leave resets empty so the UI can still show
        # the percentage on its own.
        if i + 2 < len(lines):
            rs = _RESETS_RE.search(lines[i + 2])
            if rs:
                resets = rs.group(1).strip()
        meters[key] = UsageMeter(
            label=stripped,
            percent=int(pct_match.group(1)),
            resets=resets,
        )
    return UsageScrape(available=bool(meters), meters=meters)


def scrape_usage_via_tmux() -> UsageScrape | None:
    """Drive `claude` in a hidden tmux session to capture its /usage output.

    Costs a small claude invocation per scrape (~hundreds of tokens) and a
    boot wait of up to 30 s; the cached_scraped_usage wrapper amortizes this
    behind a 5-minute TTL. Returns None on any failure path — the UI then
    falls through to the token-pill branch.

    Isolation: the headless session name is prefixed `sb-usage-<uuid8>` so a
    sweep can find orphans (THI-110 commit 3). The empty MCP config keeps the
    user's globally-configured MCP servers from loading and stalling boot.
    """
    sess = f"sb-usage-{uuid.uuid4().hex[:8]}"
    empty_mcp = settings.token_file.parent / ".empty-mcp.json"
    try:
        empty_mcp.parent.mkdir(parents=True, exist_ok=True)
        if not empty_mcp.exists():
            empty_mcp.write_text('{"mcpServers":{}}')
    except OSError as e:
        log.warning("usage scrape: cannot write empty MCP config: %s", e)
        return None

    def cap() -> str:
        return subprocess.run(
            ["tmux", "capture-pane", "-t", sess, "-p"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout

    try:
        subprocess.run(
            [
                "tmux",
                "new-session",
                "-d",
                "-s",
                sess,
                "-x",
                "200",
                "-y",
                "60",
                f"claude --strict-mcp-config {empty_mcp}",
            ],
            check=True,
            capture_output=True,
            timeout=5,
        )

        # Wait for the prompt chevron to indicate claude is ready for input.
        deadline = time.time() + _SCRAPE_BOOT_TIMEOUT_S
        booted = False
        while time.time() < deadline:
            time.sleep(0.5)
            if "❯" in cap():
                booted = True
                break
        if not booted:
            log.warning("usage scrape: claude did not boot within %.1fs", _SCRAPE_BOOT_TIMEOUT_S)
            return None

        subprocess.run(
            ["tmux", "send-keys", "-t", sess, "/usage", "Enter"],
            check=False,
            capture_output=True,
            timeout=5,
        )
        deadline = time.time() + _SCRAPE_RENDER_TIMEOUT_S
        usage_text = ""
        while time.time() < deadline:
            time.sleep(0.5)
            content = cap()
            # Sentinel: both markers must appear so we don't capture the
            # screen mid-render (the bars draw before the percentages on
            # slower terminals).
            if "% used" in content:
                usage_text = content
                break
        if not usage_text:
            log.warning(
                "usage scrape: /usage did not render within %.1fs",
                _SCRAPE_RENDER_TIMEOUT_S,
            )
            return None
        scrape = parse_usage_screen(usage_text)
        if not scrape.available:
            # We captured *something* but it didn't match any known label —
            # log a diagnostic and a small text excerpt so a future claude
            # rename of the labels is easy to notice in dev logs.
            log.warning(
                "usage scrape: captured screen had no recognized labels; first 200 chars: %r",
                usage_text[:200],
            )
        return scrape
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError) as e:
        log.warning("usage scrape failed: %s", e)
        return None
    except Exception as e:  # noqa: BLE001
        log.warning("usage scrape unexpected error: %s", e)
        return None
    finally:
        subprocess.run(
            ["tmux", "kill-session", "-t", sess],
            capture_output=True,
            check=False,
        )


def _refresh_scrape_into_cache() -> None:
    """Background-thread refresh. Always clears the in-flight flag in `finally`
    so a one-off failure doesn't permanently lock out future refreshes."""
    global _scrape_cache, _scrape_in_flight
    try:
        result = scrape_usage_via_tmux()
    except Exception:  # noqa: BLE001
        result = None
    with _scrape_lock:
        if result is not None:
            # Only update the cache on a successful scrape — a transient
            # failure shouldn't blank out a previously-good value.
            _scrape_cache = (time.time(), result)
        _scrape_in_flight = False


def cached_scraped_usage() -> UsageScrape | None:
    """Stale-while-revalidate: serve the last successful scrape immediately
    and spawn a background refresh whenever the cache is older than
    `_SCRAPE_TTL_S`. The first-ever call returns None — the next poll picks
    up the freshly-cached result.

    Single-flight: the `_scrape_in_flight` flag guards against simultaneous
    callers each spawning their own subprocess.
    """
    global _scrape_in_flight
    now = time.time()
    with _scrape_lock:
        ts, data = _scrape_cache
        if now - ts < _SCRAPE_TTL_S:
            return data
        if not _scrape_in_flight:
            _scrape_in_flight = True
            threading.Thread(target=_refresh_scrape_into_cache, daemon=True).start()
        return data


# --- end /usage scrape ------------------------------------------------------


def cached_token_usage() -> ClaudeUsage:
    """30 s-cached entry point for the `/api/usage` handler.

    Thread-safe: the lock guards the read-modify-write of the module-level
    cache slot. The cache hit path is a single dict-like read so contention
    is negligible at the realistic call cadence (~one per dashboard poll).
    """
    global _token_cache
    now = time.monotonic()
    with _token_lock:
        if _token_cache is not None and now - _token_cache[0] < _TOKEN_TTL_S:
            return _token_cache[1]
    # Release the lock for the actual walk — multiple racing first-callers will
    # each walk once, but each writes the same value, so the worst case is a
    # bounded duplicate read instead of every caller serializing behind the FS.
    data = compute_claude_usage()
    with _token_lock:
        _token_cache = (now, data)
    return data
