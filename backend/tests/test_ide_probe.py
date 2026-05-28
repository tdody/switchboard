"""Unit tests for the IDE probe (THI-146 PR 4).

The probe walks a curated list of known GUI editors and returns those whose
launcher binary is on PATH. Output drives the SettingsModal dropdown so the
user only sees IDEs they can actually launch from this machine.
"""

from __future__ import annotations

import pytest

from switchboard.services import ide_probe


def test_known_ides_only_contains_allowlisted_binaries():
    """The curated probe list must be a subset of the security allowlist —
    otherwise the frontend dropdown could surface a binary that /api/open
    would refuse to spawn."""
    from switchboard.config import settings

    for entry in ide_probe.KNOWN_IDES:
        assert entry["id"] in settings.IDE_ALLOWLIST, (
            f"{entry['id']} is in KNOWN_IDES but not in IDE_ALLOWLIST"
        )


def test_known_ides_covers_the_four_supported_editors():
    # First-cut surface — Cursor, PyCharm, Sublime Text, VSCode. Expanding the
    # list later is a one-line change but the contract here is "these four
    # render in Settings on day 1".
    ids = {entry["id"] for entry in ide_probe.KNOWN_IDES}
    assert ids == {"code", "cursor", "subl", "pycharm"}


def test_probe_returns_only_editors_present_on_path(monkeypatch):
    # Stub which() to claim cursor and subl exist; code / pycharm do not.
    # The probe must return exactly the two installed entries, preserving
    # their declaration order so the dropdown is stable.
    def fake_which(name: str) -> str | None:
        return f"/usr/local/bin/{name}" if name in {"cursor", "subl"} else None

    monkeypatch.setattr(ide_probe.shutil, "which", fake_which)
    ide_probe._reset_cache_for_tests()

    result = ide_probe.probe_available_ides()
    ids = [entry["id"] for entry in result]
    assert "cursor" in ids
    assert "subl" in ids
    assert "code" not in ids
    assert "pycharm" not in ids


def test_probe_returns_empty_when_no_editor_is_installed(monkeypatch):
    monkeypatch.setattr(ide_probe.shutil, "which", lambda _name: None)
    ide_probe._reset_cache_for_tests()

    assert ide_probe.probe_available_ides() == []


def test_probe_caches_results_to_avoid_repeated_path_scans(monkeypatch):
    # `shutil.which` walks PATH and stats every directory — cheap but not free.
    # The probe is called once per /api/ide-config request, which is itself
    # called once per app mount, so caching is more about not paying a stat
    # storm if a misbehaving client polls the endpoint than about CPU.
    calls = {"n": 0}

    def counting_which(name: str) -> str | None:
        calls["n"] += 1
        return f"/usr/local/bin/{name}"

    monkeypatch.setattr(ide_probe.shutil, "which", counting_which)
    ide_probe._reset_cache_for_tests()

    ide_probe.probe_available_ides()
    first_call_count = calls["n"]
    assert first_call_count == len(ide_probe.KNOWN_IDES)

    ide_probe.probe_available_ides()
    assert calls["n"] == first_call_count, "second call should hit the cache"


@pytest.fixture(autouse=True)
def _clear_probe_cache():
    """Probe state is process-global; reset between tests so order doesn't
    matter and one test's monkeypatched `which` doesn't leak into another."""
    ide_probe._reset_cache_for_tests()
    yield
    ide_probe._reset_cache_for_tests()
