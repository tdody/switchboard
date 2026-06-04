"""Regression tests for THI-200: cross-test daemon-thread isolation.

The CI flake on `test_open.py` was caused by daemon threads spawned in one
test's `TestClient(create_app())` lifespan leaking subprocess.run calls into
the next test's FakePopen capture. The autouse fixture in `conftest.py`
neutralizes the leak at two layers:

  (A) `settings.usage_scrape_enabled = False` — the lifespan never spawns
      `prewarm_scrape()`'s daemon thread in the first place.
  (B) `claude_usage.scrape_usage_via_tmux` is stubbed to a no-op — if a
      test explicitly re-enables (A), any leaked daemon still makes no
      `subprocess.run(["tmux", ...])` calls.

These tests pin both layers so a future conftest edit can't silently
re-introduce the flake.
"""

from __future__ import annotations

import subprocess

import pytest

from switchboard.config import settings
from switchboard.services import claude_usage


def test_autouse_sets_usage_scrape_enabled_to_false() -> None:
    """Layer A: the lifespan reads `settings.usage_scrape_enabled` to decide
    whether to fire `prewarm_scrape()`. With the autouse default of False,
    no daemon thread is ever spawned during a test's `TestClient` lifespan."""
    assert settings.usage_scrape_enabled is False


def test_autouse_stubs_scrape_usage_via_tmux_to_no_subprocess_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Layer B: even if a test re-enables `usage_scrape_enabled`, the prewarm
    chain (`cached_scraped_usage` → `_refresh_scrape_into_cache` →
    `scrape_usage_via_tmux`) must not fire real `subprocess.run(["tmux", ...])`
    calls — otherwise a leaked daemon thread could overwrite test_open.py's
    FakePopen capture mid-test."""
    popen_args: list[object] = []
    real_popen = subprocess.Popen

    def tracking_popen(*args: object, **kwargs: object) -> object:
        popen_args.append(args[0] if args else None)
        return real_popen(*args, **kwargs)  # ty: ignore

    monkeypatch.setattr(subprocess, "Popen", tracking_popen)

    result = claude_usage.scrape_usage_via_tmux()

    assert result is None
    assert popen_args == [], (
        f"scrape_usage_via_tmux fired Popen ({popen_args!r}) — the autouse "
        f"fixture in conftest.py must stub it to a no-op (see THI-200)"
    )
