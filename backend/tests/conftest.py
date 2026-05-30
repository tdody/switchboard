"""Shared pytest fixtures (auto-applied unless explicitly overridden).

Lives at the test root so every test in `backend/tests/` picks it up
without an explicit import.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_claude_usage_scrape_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reset the `claude_usage` scrape singleton before every test (THI-157).

    `claude_usage._scrape_cache` and `_scrape_in_flight` are module-level
    globals that hold the most recent `/api/usage` scrape and a single-flight
    flag. Any test that touches the endpoint can leak state into the
    next: a background `_refresh_scrape_into_cache` thread completing
    after the test owns it populates `_scrape_cache` with a stale or
    test-specific payload that the next test inherits as if it were a
    fresh boot.

    Surfaced (but not caused) by THI-148 — full-suite runs flaked on
    `test_usage_endpoint_returns_camel_case_shape::scrape is None` because
    an earlier test seeded the cache. Previously papered over with a
    per-test `monkeypatch.setattr(...)` (ecd2500); replaced here by a
    single autouse reset.

    Tests that need a different `_scrape_in_flight` (e.g. forcing the
    single-flight guard on to suppress the refresh thread) still
    monkeypatch it explicitly — those overrides win because monkeypatch
    applies after the fixture body.
    """
    from switchboard.services import claude_usage

    monkeypatch.setattr(claude_usage, "_scrape_cache", (0.0, None))
    monkeypatch.setattr(claude_usage, "_scrape_in_flight", False)
