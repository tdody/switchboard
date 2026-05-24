"""Endpoint tests for the auto-rename router (THI-67). The Anthropic SDK is
stubbed via monkeypatch; nothing here hits the network."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app
from switchboard.services import anthropic_client

# SecurityMiddleware's loopback allowlist rejects the default `testserver`
# Host header. Match the pattern used elsewhere in the test suite.
BASE_URL = "http://127.0.0.1:8765"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "token_file", tmp_path / "token")
    monkeypatch.setattr(auth_mod.auth_state, "token", "")
    monkeypatch.setattr(auth_mod.auth_state, "csrf_secret", "")
    with TestClient(create_app(), base_url=BASE_URL) as c:
        c.get("/api/state")  # primes the sb_csrf cookie
        yield c


def _csrf(client: TestClient) -> dict[str, str]:
    return {"x-csrf-token": client.cookies.get("sb_csrf") or ""}


# --- /api/auto-rename/status ------------------------------------------------


def test_status_reports_disabled_without_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    r = client.get("/api/auto-rename/status")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False
    assert body["model"] == settings.anthropic_model
    assert body["source"] == "none"
    assert body["masked"] is None


def test_status_reports_enabled_when_key_is_set_via_config(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-api03-aBcDeFg1234567890XYZ")
    r = client.get("/api/auto-rename/status")
    body = r.json()
    assert body["enabled"] is True
    assert body["source"] == "config"
    # Never echoes the full key; matches the prefix + last-4 fingerprint.
    assert body["masked"] == "sk-ant-…0XYZ"


def test_status_source_is_env_when_only_env_var_is_set(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-eNvOnlyAbcdef987654")
    r = client.get("/api/auto-rename/status")
    body = r.json()
    assert body["enabled"] is True
    assert body["source"] == "env"
    assert body["masked"] == "sk-ant-…7654"


def test_status_config_key_takes_priority_over_env(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Both set → the explicit setting wins, since that's what the SDK
    # constructor will actually receive.
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-cfgKEYabcdefgh1234")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-ENVKEYxxxxxxxxxxxxxx")
    r = client.get("/api/auto-rename/status")
    body = r.json()
    assert body["source"] == "config"
    assert body["masked"].endswith("1234")


# --- /api/auto-rename-session ----------------------------------------------


def _patch_session_context(monkeypatch: pytest.MonkeyPatch, contexts: list[dict]) -> None:
    """Replace the tmux-walking helper with a deterministic fixture so the
    endpoint tests don't need a live tmux server."""
    from switchboard.routers import rename_ai

    monkeypatch.setattr(rename_ai, "_collect_session_context", lambda _s: contexts)


def test_session_returns_suggestions_with_usage(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_session_context(
        monkeypatch,
        [
            {"index": 1, "current_name": "shell"},
            {"index": 2, "current_name": "claude"},
        ],
    )
    monkeypatch.setattr(
        anthropic_client,
        "complete",
        lambda _p, **_kw: (
            '{"1": "fs-build", "2": "cohort-inv"}',
            120,
            18,
        ),
    )
    r = client.post("/api/auto-rename-session?session=main", headers=_csrf(client))
    assert r.status_code == 200
    body = r.json()
    assert [s["suggested"] for s in body["suggestions"]] == ["fs-build", "cohort-inv"]
    assert [s["old"] for s in body["suggestions"]] == ["shell", "claude"]
    assert [s["index"] for s in body["suggestions"]] == [1, 2]
    # camelCase aliases on the wire.
    assert body["usage"]["inputTokens"] == 120
    assert body["usage"]["outputTokens"] == 18
    # 120 * $1/M + 18 * $5/M
    assert body["usage"]["estCostUsd"] == pytest.approx(0.00021, rel=1e-3)


def test_session_404_when_no_windows(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_session_context(monkeypatch, [])
    r = client.post("/api/auto-rename-session?session=missing", headers=_csrf(client))
    assert r.status_code == 404


def test_session_503_when_no_anthropic_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_session_context(
        monkeypatch, [{"index": 1, "current_name": "shell"}]
    )

    def _no_key(_prompt: str, **_kw):
        raise anthropic_client.AnthropicConfigError("no key")

    monkeypatch.setattr(anthropic_client, "complete", _no_key)
    r = client.post("/api/auto-rename-session?session=main", headers=_csrf(client))
    assert r.status_code == 503
    assert "no key" in r.json()["detail"]


def test_session_502_when_model_returns_invalid_json(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_session_context(
        monkeypatch, [{"index": 1, "current_name": "shell"}]
    )
    monkeypatch.setattr(
        anthropic_client,
        "complete",
        lambda _p, **_kw: ("not json at all", 10, 5),
    )
    r = client.post("/api/auto-rename-session?session=main", headers=_csrf(client))
    assert r.status_code == 502


def test_session_keeps_unchanged_rows_in_response(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Even if the model omits a window (or returns null/empty for it), the
    # suggestion row is still emitted with suggested == old so the modal can
    # render it as a no-op rather than dropping the window silently.
    _patch_session_context(
        monkeypatch,
        [
            {"index": 1, "current_name": "shell"},
            {"index": 2, "current_name": "claude"},
        ],
    )
    monkeypatch.setattr(
        anthropic_client,
        "complete",
        lambda _p, **_kw: ('{"1": "fs-build"}', 50, 5),
    )
    r = client.post("/api/auto-rename-session?session=main", headers=_csrf(client))
    body = r.json()
    by_idx = {s["index"]: s for s in body["suggestions"]}
    assert by_idx[1]["suggested"] == "fs-build"
    assert by_idx[2]["suggested"] == "claude"  # unchanged, mirrors old


# --- /api/auto-rename-window -----------------------------------------------


def test_window_returns_single_suggestion(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from switchboard.routers import rename_ai

    monkeypatch.setattr(
        rename_ai,
        "_collect_window_context",
        lambda _s, _i: [{"index": 7, "current_name": "x"}],
    )
    monkeypatch.setattr(
        anthropic_client,
        "complete",
        lambda _p, **_kw: ('{"7": "renamed"}', 60, 6),
    )
    r = client.post(
        "/api/auto-rename-window?session=main&index=7", headers=_csrf(client)
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["suggestions"]) == 1
    assert body["suggestions"][0]["suggested"] == "renamed"


def test_window_404_when_pane_missing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from switchboard.routers import rename_ai

    monkeypatch.setattr(rename_ai, "_collect_window_context", lambda _s, _i: [])
    r = client.post(
        "/api/auto-rename-window?session=main&index=99", headers=_csrf(client)
    )
    assert r.status_code == 404
