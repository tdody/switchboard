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

    expected = int(
        datetime(2026, 5, 24, 1, 0, tzinfo=UTC).timestamp()
    )
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
        return real_compute(*args, projects_dir=projects, now=NOW, **{
            k: v for k, v in kwargs.items() if k not in ("projects_dir", "now")
        })

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
