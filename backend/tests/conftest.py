"""Shared pytest fixtures (auto-applied unless explicitly overridden).

Lives at the test root so every test in `backend/tests/` picks it up
without an explicit import.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_claude_usage_scrape_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reset the `claude_usage` scrape singleton before every test (THI-157)
    AND neutralize the prewarm thread that flaked test_open.py in CI (THI-200).

    Scrape-singleton reset (THI-157)
    --------------------------------
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

    Prewarm-thread neutralization (THI-200)
    ---------------------------------------
    The app's lifespan calls `claude_usage.prewarm_scrape()` when
    `settings.usage_scrape_enabled` is True. That spawns a daemon thread
    which (via `cached_scraped_usage` → `_refresh_scrape_into_cache`)
    runs `scrape_usage_via_tmux()`, firing several
    `subprocess.run(["tmux", ...])` calls — including one in a `finally:`
    that always runs even when the scrape fails (e.g. when a test has
    patched `subprocess.Popen` to a stub that doesn't honor the context
    manager protocol).

    `test_open.py` patches `subprocess.Popen` globally to capture the
    IDE-spawn argv. In CI's slower timing, the leaked daemon's
    `tmux kill-session` call in `scrape_usage_via_tmux`'s finally block
    fires AFTER the IDE Popen has populated `captured["args"]`,
    overwriting it with `["tmux", ...]` and flaking the assertion that
    `args[0]` is the IDE binary.

    Two-layer defense:
      (A) Default `settings.usage_scrape_enabled = False` so the lifespan
          never spawns the prewarm thread in the first place.
      (B) Stub `scrape_usage_via_tmux` to a no-op so even if a test
          re-enables (A), any leaked daemon makes no subprocess calls.

    Tests that exercise the scrape behavior directly (e.g.
    `test_claude_usage.py::test_scrape_*`) override the stub
    per-test — those overrides win because monkeypatch applies after
    the fixture body.
    """
    from switchboard.config import settings
    from switchboard.services import claude_usage

    monkeypatch.setattr(claude_usage, "_scrape_cache", (0.0, None))
    monkeypatch.setattr(claude_usage, "_scrape_in_flight", False)
    monkeypatch.setattr(settings, "usage_scrape_enabled", False)
    monkeypatch.setattr(claude_usage, "scrape_usage_via_tmux", lambda: None)
