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
import threading
import time
from datetime import datetime
from pathlib import Path

from switchboard.config import settings
from switchboard.schemas import ClaudeUsage

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
