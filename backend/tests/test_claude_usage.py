"""Tests for the Claude token-usage aggregator (THI-110).

Walks `~/.claude/projects/*/*.jsonl`, sums `message.usage` fields for records
whose ISO timestamp falls inside a rolling window (5 h by default). The
reset anchor is the *earliest* in-window message — the plan's rolling reset
fires window_hours after the first message of the window, not "now + 5 h".

Fixtures live under `tests/fixtures/usage/`. They mix in-window, out-of-window,
malformed, and usage-less records so the parser's tolerance can be pinned.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest

from switchboard.services import claude_usage

FIXTURES = Path(__file__).parent / "fixtures" / "usage"

# The fixtures' latest timestamp is 2026-05-23T20:10Z. Choose `now` so the
# 5 h cutoff is 15:30Z — fresh records pass, stale ones don't.
NOW = datetime(2026, 5, 23, 20, 30, tzinfo=UTC).timestamp()
CUTOFF = NOW - 5 * 3600  # 2026-05-23T15:30Z


def _seed_projects_dir(tmp_path: Path, *fixture_names: str) -> Path:
    """Copy named fixtures into `tmp_path/<project>/<filename>` so they match
    the `*/*.jsonl` glob compute_claude_usage uses."""
    projects = tmp_path / "projects"
    for name in fixture_names:
        sub = projects / name.removesuffix(".jsonl")
        sub.mkdir(parents=True, exist_ok=True)
        shutil.copy(FIXTURES / name, sub / name)
    return projects


def test_returns_available_false_when_projects_dir_missing(tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    result = claude_usage.compute_claude_usage(projects_dir=missing, now=NOW)
    assert result.available is False
    assert result.total_tokens == 0
    assert result.reset_at is None


def test_sums_in_window_records_from_fresh_session(tmp_path: Path) -> None:
    projects = _seed_projects_dir(tmp_path, "session-fresh.jsonl")
    result = claude_usage.compute_claude_usage(projects_dir=projects, now=NOW)

    assert result.available is True
    # Two assistant records with usage; the third is a user message — skipped.
    assert result.messages == 2
    # 120 + 15
    assert result.input_tokens == 135
    # 40 + 0
    assert result.cache_creation_tokens == 40
    # 800 + 1200
    assert result.cache_read_tokens == 2000
    # 60 + 90
    assert result.output_tokens == 150
    assert result.total_tokens == 135 + 40 + 2000 + 150


def test_skips_records_with_out_of_window_timestamps(tmp_path: Path) -> None:
    # Stale fixture has all records before the cutoff. mtime is fresh (just-
    # copied) so the file IS opened, but every line gets timestamp-filtered out.
    projects = _seed_projects_dir(tmp_path, "session-stale.jsonl")
    result = claude_usage.compute_claude_usage(projects_dir=projects, now=NOW)

    assert result.available is True
    assert result.messages == 0
    assert result.total_tokens == 0
    assert result.reset_at is None


def test_tolerates_garbage_in_jsonl(tmp_path: Path) -> None:
    # The mixed fixture has: non-JSON line, out-of-window record, bad
    # timestamp string, missing timestamp, user message (no usage), and one
    # valid in-window assistant record. Only the last contributes.
    projects = _seed_projects_dir(tmp_path, "session-mixed.jsonl")
    result = claude_usage.compute_claude_usage(projects_dir=projects, now=NOW)

    assert result.messages == 1
    assert result.input_tokens == 7
    assert result.cache_creation_tokens == 3
    assert result.cache_read_tokens == 2
    assert result.output_tokens == 11
    assert result.total_tokens == 23


def test_reset_at_anchors_to_earliest_in_window_message(tmp_path: Path) -> None:
    # The fresh fixture's earliest in-window record is 2026-05-23T20:00Z;
    # reset must be that + 5 h = 2026-05-24T01:00Z (not NOW + 5 h).
    projects = _seed_projects_dir(tmp_path, "session-fresh.jsonl")
    result = claude_usage.compute_claude_usage(projects_dir=projects, now=NOW)

    expected = int(datetime(2026, 5, 24, 1, 0, tzinfo=UTC).timestamp())
    assert result.reset_at == expected


def test_aggregates_across_multiple_session_files(tmp_path: Path) -> None:
    projects = _seed_projects_dir(
        tmp_path,
        "session-fresh.jsonl",
        "session-stale.jsonl",
        "session-mixed.jsonl",
    )
    result = claude_usage.compute_claude_usage(projects_dir=projects, now=NOW)

    # fresh contributes msgs=2, mixed contributes msgs=1, stale contributes 0.
    assert result.messages == 3
    # input: 120 + 15 + 7
    assert result.input_tokens == 142
    # cache_w: 40 + 0 + 3
    assert result.cache_creation_tokens == 43
    # cache_r: 800 + 1200 + 2
    assert result.cache_read_tokens == 2002
    # output: 60 + 90 + 11
    assert result.output_tokens == 161


def test_usage_endpoint_returns_camel_case_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    """End-to-end: TestClient hits `/api/usage`, asserts the response shape
    aliases to camelCase and `scrape` is None for commit 1 (scrape lands in
    commit 2)."""
    from fastapi.testclient import TestClient

    from switchboard.main import create_app
    from switchboard.schemas import ClaudeUsage

    canned = ClaudeUsage(
        available=True,
        window_hours=5.0,
        messages=4,
        input_tokens=200,
        cache_creation_tokens=50,
        cache_read_tokens=1000,
        output_tokens=150,
        total_tokens=1400,
        reset_at=1779999999,
    )
    monkeypatch.setattr(claude_usage, "cached_token_usage", lambda: canned)
    # Suppress the background `_refresh_scrape_into_cache` thread for the
    # duration of this test — the conftest autouse fixture (THI-157) already
    # resets `_scrape_cache` to empty; flipping the in-flight flag prevents
    # a refresh from starting and populating it mid-assertion.
    monkeypatch.setattr(claude_usage, "_scrape_in_flight", True)

    # SecurityMiddleware's loopback allowlist rejects the default `testserver`
    # Host header — match the BASE_URL trick the other endpoint tests use.
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        r = client.get("/api/usage")
    assert r.status_code == 200
    body = r.json()
    assert body["scrape"] is None
    tokens = body["tokens"]
    # camelCase aliases on the wire — input_tokens → inputTokens, etc.
    assert tokens["available"] is True
    assert tokens["windowHours"] == 5.0
    assert tokens["messages"] == 4
    assert tokens["inputTokens"] == 200
    assert tokens["cacheCreationTokens"] == 50
    assert tokens["cacheReadTokens"] == 1000
    assert tokens["outputTokens"] == 150
    assert tokens["totalTokens"] == 1400
    assert tokens["resetAt"] == 1779999999


def _load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def test_parse_usage_screen_full_three_meters() -> None:
    """Full /usage screen — three meters with bars + Resets lines."""
    scrape = claude_usage.parse_usage_screen(_load_fixture("usage_screen_full.txt"))
    assert scrape.available is True
    assert set(scrape.meters.keys()) == {"session", "week_all", "week_sonnet"}
    assert scrape.meters["session"].percent == 35
    assert scrape.meters["session"].label == "Current session"
    assert scrape.meters["session"].resets == "12:20am (America/New_York)"
    assert scrape.meters["week_all"].percent == 4
    assert scrape.meters["week_all"].resets == "Mon Jun 2"
    assert scrape.meters["week_sonnet"].percent == 1


def test_parse_usage_screen_partial_two_meters_no_resets_on_second() -> None:
    """A common shape: only session + week_all (no Sonnet meter), and week_all
    has no `Resets` follow-up line. Parser must still return both meters; the
    missing resets becomes the empty string."""
    scrape = claude_usage.parse_usage_screen(_load_fixture("usage_screen_partial.txt"))
    assert scrape.available is True
    assert set(scrape.meters.keys()) == {"session", "week_all"}
    assert scrape.meters["session"].percent == 35
    assert scrape.meters["session"].resets.startswith("12:20am")
    assert scrape.meters["week_all"].percent == 4
    assert scrape.meters["week_all"].resets == ""


def test_parse_usage_screen_garbage_returns_unavailable() -> None:
    """A non-/usage capture (e.g. claude rendered some other view) must not
    fabricate meters — `available=False` falls through to the token pill."""
    scrape = claude_usage.parse_usage_screen(_load_fixture("usage_screen_garbage.txt"))
    assert scrape.available is False
    assert scrape.meters == {}


def test_parse_usage_screen_empty_string() -> None:
    scrape = claude_usage.parse_usage_screen("")
    assert scrape.available is False
    assert scrape.meters == {}


def test_cached_scraped_usage_starts_empty_and_schedules_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Stale-while-revalidate contract:
      - First call returns None (no cached scrape yet), but kicks a background
        refresh.
      - Subsequent call inside the TTL returns the cached value (after the
        background thread has populated it).
      - Subsequent call past the TTL re-arms the refresher.
    The actual subprocess.run path is stubbed — we exercise the cache & lock,
    not the tmux drive. (Module state — `_scrape_cache` / `_scrape_in_flight`
    — is reset to empty/False by the autouse conftest fixture; THI-157.)
    """
    # Stub scrape_usage_via_tmux so the refresh thread completes synchronously
    # with a known payload.
    from switchboard.schemas import UsageMeter, UsageScrape

    canned = UsageScrape(
        available=True,
        meters={"session": UsageMeter(label="Current session", percent=42, resets="now")},
    )
    monkeypatch.setattr(claude_usage, "scrape_usage_via_tmux", lambda: canned)

    # Start the fake clock well past `_SCRAPE_TTL_S` so the cold-cache state
    # `(ts=0.0, data=None)` reads as expired and triggers the refresh path.
    # (At small `now` values the delta against ts=0 would still be < TTL,
    # masking the cache miss.)
    fake_clock = {"t": 100_000.0}
    monkeypatch.setattr(claude_usage.time, "time", lambda: fake_clock["t"])

    # First call: nothing cached yet → returns None, schedules the refresh
    # (which, with our sync stub, completes before we leave cached_scraped_usage
    # in practice; rely on it being populated by next call).
    first = claude_usage.cached_scraped_usage()
    assert first is None
    # Give the daemon thread a brief moment to land its write.
    import time as _time

    _time.sleep(0.05)

    # Second call inside TTL: should return the canned payload.
    second = claude_usage.cached_scraped_usage()
    assert second is not None
    assert second.meters["session"].percent == 42

    # Past TTL: re-arms (we can't easily observe the refresh kicking, but the
    # value should still be the canned one since the stub returns the same).
    fake_clock["t"] = 100_000.0 + claude_usage._SCRAPE_TTL_S + 1
    third = claude_usage.cached_scraped_usage()
    assert third is not None
    assert third.meters["session"].percent == 42


# --- THI-110 commit 3: orphan sweep + config endpoint ----------------------


def test_cleanup_orphaned_usage_sessions_kills_only_our_prefix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sweep should kill `sb-usage-*` sessions and leave everything else
    alone. The user's own tmux work must never be touched."""
    from types import SimpleNamespace

    listed = "sb-usage-aaaaaaaa\nmain\nagents\nsb-usage-bbbbbbbb\n"
    killed: list[list[str]] = []

    def fake_run(args, *_a, **_kw):
        if args[:2] == ["tmux", "list-sessions"]:
            return SimpleNamespace(returncode=0, stdout=listed, stderr="")
        if args[:2] == ["tmux", "kill-session"]:
            killed.append(list(args))
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        raise AssertionError(f"unexpected subprocess.run args: {args}")

    monkeypatch.setattr(claude_usage.subprocess, "run", fake_run)

    removed = claude_usage.cleanup_orphaned_usage_sessions()
    assert removed == 2
    kill_targets = [c[-1] for c in killed]
    assert kill_targets == ["sb-usage-aaaaaaaa", "sb-usage-bbbbbbbb"]
    # main / agents must NEVER show up in the kill list.
    assert "main" not in kill_targets
    assert "agents" not in kill_targets


def test_cleanup_orphaned_usage_sessions_returns_zero_when_no_tmux_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """list-sessions returns nonzero when no tmux server is running. Sweep
    must short-circuit without crashing."""
    from types import SimpleNamespace

    def fake_run(_args, *_a, **_kw):
        return SimpleNamespace(returncode=1, stdout="", stderr="no server")

    monkeypatch.setattr(claude_usage.subprocess, "run", fake_run)
    assert claude_usage.cleanup_orphaned_usage_sessions() == 0


def test_cleanup_orphaned_usage_sessions_swallows_missing_tmux_binary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(*_a, **_kw):
        raise FileNotFoundError("tmux: not found")

    monkeypatch.setattr(claude_usage.subprocess, "run", boom)
    assert claude_usage.cleanup_orphaned_usage_sessions() == 0


def test_usage_config_endpoint_returns_camel_case_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi.testclient import TestClient

    from switchboard.config import settings
    from switchboard.main import create_app

    monkeypatch.setattr(settings, "usage_scrape_enabled", True)
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as client:
        r = client.get("/api/usage/config")
    assert r.status_code == 200
    body = r.json()
    assert body["scrapeEnabled"] is True
    # camelCase aliases on the wire — scrape_ttl_s → scrapeTtlS.
    assert body["scrapeTtlS"] == claude_usage._SCRAPE_TTL_S
    assert body["tokenTtlS"] == claude_usage._TOKEN_TTL_S


def test_cached_token_usage_serves_from_cache_within_ttl(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    projects = _seed_projects_dir(tmp_path, "session-fresh.jsonl")
    monkeypatch.setattr(claude_usage, "_token_cache", None)

    fake_clock = {"t": 1000.0}
    monkeypatch.setattr(claude_usage.time, "monotonic", lambda: fake_clock["t"])

    calls = {"n": 0}
    real_compute = claude_usage.compute_claude_usage

    def counting_compute(*args, **kwargs):
        calls["n"] += 1
        return real_compute(
            *args,
            projects_dir=projects,
            now=NOW,
            **{k: v for k, v in kwargs.items() if k not in ("projects_dir", "now")},
        )

    monkeypatch.setattr(claude_usage, "compute_claude_usage", counting_compute)

    # First call populates cache.
    a = claude_usage.cached_token_usage()
    assert calls["n"] == 1
    # Within TTL: cache hit.
    fake_clock["t"] = 1000.0 + claude_usage._TOKEN_TTL_S - 0.1
    b = claude_usage.cached_token_usage()
    assert calls["n"] == 1
    assert a == b
    # Past TTL: re-walks.
    fake_clock["t"] = 1000.0 + claude_usage._TOKEN_TTL_S + 0.1
    claude_usage.cached_token_usage()
    assert calls["n"] == 2
