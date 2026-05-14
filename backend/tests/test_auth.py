import stat

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app

# TestClient defaults to Host: testserver, which the loopback Host allowlist
# rejects. Pin the base_url so requests carry an allowed Host header.
BASE_URL = "http://127.0.0.1:8765"


@pytest.fixture
def token_path(tmp_path, monkeypatch):
    """Point the token file at a temp path; reset AuthState between tests."""
    p = tmp_path / "token"
    monkeypatch.setattr(settings, "token_file", p)
    monkeypatch.setattr(auth_mod.auth_state, "token", "")
    monkeypatch.setattr(auth_mod.auth_state, "csrf_secret", "")
    return p


def test_token_created_with_0600(token_path):
    token = auth_mod.load_or_create_token()
    assert token_path.exists()
    assert len(token) > 20
    assert stat.S_IMODE(token_path.stat().st_mode) == 0o600
    # idempotent — second call returns the same persisted token
    assert auth_mod.load_or_create_token() == token


def test_regenerate_changes_token(token_path):
    first = auth_mod.load_or_create_token()
    second = auth_mod.regenerate_token()
    assert first != second
    assert token_path.read_text().strip() == second


def test_mask_hides_most_of_the_token():
    masked = auth_mod.mask("abcdefghijklmnopqrstuvwxyz")
    assert masked == "abcd…wxyz"
    assert auth_mod.mask("short") == "•••••"


def test_loopback_mode_needs_no_token(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/api/state")
        assert r.status_code == 200
        # the CSRF cookie is issued on the first response
        assert "sb_csrf" in client.cookies


def test_exposed_mode_requires_token(token_path, monkeypatch):
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        assert client.get("/api/state").status_code == 401
        ok = client.get(
            "/api/state",
            headers={"authorization": f"Bearer {auth_mod.auth_state.token}"},
        )
        assert ok.status_code == 200


def test_exposed_mode_bootstrap_query_token(token_path, monkeypatch):
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get(f"/api/state?token={auth_mod.auth_state.token}")
        assert r.status_code == 200
        # bootstrap exchanged the query token for a session cookie
        assert "sb_session" in client.cookies
        # subsequent request rides the cookie, no query param needed
        assert client.get("/api/state").status_code == 200


def test_healthz_and_auth_status_always_open(token_path, monkeypatch):
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        assert client.get("/healthz").status_code == 200
        s = client.get("/api/auth/status")
        assert s.status_code == 200
        assert s.json() == {"auth_enabled": True, "loopback_mode": True}


def test_csrf_required_for_mutations(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        client.get("/api/state")  # prime the sb_csrf cookie
        csrf = client.cookies.get("sb_csrf")
        assert csrf

        # no CSRF header → blocked
        blocked = client.post("/api/rename?session=x&index=0", json={"name": "y"})
        assert blocked.status_code == 403

        # with the matching header → passes CSRF (tmux 404 is fine, not 403)
        passed = client.post(
            "/api/rename?session=x&index=0",
            json={"name": "y"},
            headers={"x-csrf-token": csrf},
        )
        assert passed.status_code != 403


def test_bad_host_header_rejected_in_loopback_mode(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/api/state", headers={"host": "evil.example.com"})
        assert r.status_code == 421


def test_regenerate_endpoint_rotates_token(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        client.get("/api/state")  # prime sb_csrf
        csrf = client.cookies.get("sb_csrf")
        before = auth_mod.auth_state.token
        r = client.post("/api/auth/regenerate", headers={"x-csrf-token": csrf})
        assert r.status_code == 200
        new_token = r.json()["token"]
        assert new_token != before
        assert auth_mod.auth_state.token == new_token
