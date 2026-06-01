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


# ---------------------------------------------------------------------------
# THI-163 / sec:H5 — refuse non-loopback host with auth_required=False
# ---------------------------------------------------------------------------


def test_create_app_refuses_non_loopback_with_auth_disabled(token_path, monkeypatch):
    """Starting on 0.0.0.0 with SWITCHBOARD_AUTH_REQUIRED=false would expose
    an unauthenticated tmux/shell to the LAN. create_app() must fail fast."""
    monkeypatch.setattr(settings, "host", "0.0.0.0")
    monkeypatch.setattr(settings, "auth_required", False)
    with pytest.raises(RuntimeError, match="non-loopback"):
        create_app()


def test_create_app_accepts_loopback_with_auth_disabled(token_path, monkeypatch):
    """The same explicit auth_required=False is fine when bound to loopback."""
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", False)
    # Should not raise — this is the documented "I really mean no auth, on
    # my machine only" path.
    create_app()


def test_create_app_accepts_non_loopback_with_auth_enabled(token_path, monkeypatch):
    """auto-detect (None) on 0.0.0.0 → auth flips on, no refusal."""
    monkeypatch.setattr(settings, "host", "0.0.0.0")
    monkeypatch.setattr(settings, "auth_required", None)
    create_app()


# ---------------------------------------------------------------------------
# THI-162 / sec:H4 — bootstrap URL must not appear in logs at WARNING
# ---------------------------------------------------------------------------


def test_bootstrap_token_not_logged_in_plaintext(token_path, monkeypatch, caplog):
    """Auth-enabled startup must log only a masked fingerprint, not the
    full ?token= URL. The full URL goes to a 0600 file and stdout."""
    import logging as logging_mod

    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", True)
    caplog.set_level(logging_mod.WARNING, logger="switchboard.main")

    with TestClient(create_app(), base_url=BASE_URL):
        pass

    full_token = auth_mod.auth_state.token
    assert full_token, "test setup: token should have been generated"
    # The token MUST NOT appear verbatim in any logger record.
    for record in caplog.records:
        assert full_token not in record.getMessage(), (
            f"plaintext token leaked to log: {record.getMessage()!r}"
        )
    # A masked fingerprint should be in there somewhere.
    assert any(auth_mod.mask(full_token) in r.getMessage() for r in caplog.records), (
        "expected the masked token fingerprint in the startup log"
    )


def test_bootstrap_url_written_to_0600_file(token_path, monkeypatch):
    """The bootstrap URL is written to ~/.switchboard/bootstrap.url with
    mode 0600 so the operator can `cat` it without it landing in any log."""
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", True)
    bootstrap_file = token_path.parent / "bootstrap.url"
    with TestClient(create_app(), base_url=BASE_URL):
        pass
    assert bootstrap_file.exists()
    assert stat.S_IMODE(bootstrap_file.stat().st_mode) == 0o600
    content = bootstrap_file.read_text()
    assert auth_mod.auth_state.token in content
    assert content.startswith("http://127.0.0.1:")


# ---------------------------------------------------------------------------
# THI-161 / sec:H3 — opaque session IDs, not the raw API token
# ---------------------------------------------------------------------------


def test_session_cookie_is_not_the_raw_token(token_path, monkeypatch):
    """After a ?token= bootstrap, the sb_session cookie value MUST be a
    distinct opaque session ID, not the API token itself."""
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get(f"/api/state?token={auth_mod.auth_state.token}")
        assert r.status_code == 200
        sb_session = client.cookies.get("sb_session")
        assert sb_session
        # The cookie must NOT equal the API token (the whole point of H3).
        assert sb_session != auth_mod.auth_state.token
        # And the session must be tracked server-side.
        assert auth_mod.auth_state.is_valid_session(sb_session)


def test_regenerate_invalidates_existing_sessions(token_path, monkeypatch):
    """Rotating the token must clear all sessions — otherwise a leaked
    cookie survives rotation."""
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        # Bootstrap a session.
        client.get(f"/api/state?token={auth_mod.auth_state.token}")
        sb_session = client.cookies.get("sb_session")
        assert sb_session and auth_mod.auth_state.is_valid_session(sb_session)
        # Rotate the token via the API: need CSRF + the OLD bearer token.
        old_token = auth_mod.auth_state.token
        csrf = client.cookies.get("sb_csrf")
        r = client.post(
            "/api/auth/regenerate",
            headers={
                "x-csrf-token": csrf,
                "authorization": f"Bearer {old_token}",
            },
        )
        assert r.status_code == 200
        # The old session must be gone from the server-side store.
        assert not auth_mod.auth_state.is_valid_session(sb_session)


def test_bearer_token_still_works_independently_of_sessions(token_path, monkeypatch):
    """A non-browser client using Authorization: Bearer must NOT need a
    session — bearer auth is the API client path (H3 acceptance criterion)."""
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get(
            "/api/state",
            headers={"authorization": f"Bearer {auth_mod.auth_state.token}"},
        )
        assert r.status_code == 200
        # No session was created — bearer clients don't get cookies.
        assert "sb_session" not in client.cookies


# ---------------------------------------------------------------------------
# THI-159 / THI-160 — sec:H1+H2 — WS Origin enforcement in all modes
# ---------------------------------------------------------------------------


def test_ws_rejected_without_origin_in_loopback_mode(token_path, monkeypatch):
    """Missing Origin on a WS upgrade is rejected even in loopback mode —
    fixes the drive-by RCE vector where any local page could open ws://."""
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "cors_origins", ["http://localhost:5173"])
    with TestClient(create_app(), base_url=BASE_URL) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/ws/pane?session=x&index=0",
                headers={"host": "127.0.0.1:8765"},  # NO origin
            ):
                pass


def test_ws_rejected_with_evil_origin_in_loopback_mode(token_path, monkeypatch):
    """A cross-origin page (evil.com) opening ws://127.0.0.1 is rejected."""
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "cors_origins", ["http://localhost:5173"])
    with TestClient(create_app(), base_url=BASE_URL) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/ws/pane?session=x&index=0",
                headers={
                    "host": "127.0.0.1:8765",
                    "origin": "http://evil.example.com",
                },
            ):
                pass


# ---------------------------------------------------------------------------
# THI-164 / sec:M1 — Host header normalization
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "host_header",
    [
        "127.0.0.1:8765",
        "127.0.0.1",
        "localhost:8765",
        "localhost",
        "LocalHost:8765",  # case-insensitive
        "localhost.",  # trailing dot
        "localhost.:8765",
        "[::1]:8765",  # bracketed IPv6
        "[::1]",
        "::1",  # bracketless IPv6
    ],
)
def test_host_header_variants_accepted_in_loopback(token_path, monkeypatch, host_header):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/api/state", headers={"host": host_header})
        assert r.status_code == 200, f"expected 200 for Host={host_header!r}"


@pytest.mark.parametrize(
    "host_header",
    [
        "evil.example.com",
        "evil.example.com:8765",
        "127.0.0.1:9999",  # wrong port
        "[::1]:9999",  # wrong port (IPv6)
        "[bad",  # malformed brackets
    ],
)
def test_host_header_variants_rejected_in_loopback(token_path, monkeypatch, host_header):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/api/state", headers={"host": host_header})
        assert r.status_code == 421, f"expected 421 for Host={host_header!r}"


# ---------------------------------------------------------------------------
# THI-165 / sec:M2 — 303-redirect to strip ?token=; Referrer-Policy
# ---------------------------------------------------------------------------


def test_query_token_bootstrap_303_redirects_without_token(token_path, monkeypatch):
    """The ?token=… bootstrap must NOT keep the token in the URL — set the
    session cookie and 303-redirect to the bare path."""
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL, follow_redirects=False) as client:
        r = client.get(f"/api/state?token={auth_mod.auth_state.token}")
        assert r.status_code == 303
        location = r.headers["location"]
        assert "token=" not in location, f"token must not appear in Location: {location!r}"
        # Session cookie was set as part of the redirect.
        assert "sb_session" in client.cookies


def test_query_token_preserves_other_query_params_in_redirect(token_path, monkeypatch):
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL, follow_redirects=False) as client:
        r = client.get(f"/api/state?token={auth_mod.auth_state.token}&keep=this")
        assert r.status_code == 303
        assert "keep=this" in r.headers["location"]
        assert "token=" not in r.headers["location"]


def test_referrer_policy_header_set_on_responses(token_path, monkeypatch):
    """Every non-open response should carry Referrer-Policy: no-referrer."""
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/api/state")
        assert r.headers.get("referrer-policy") == "no-referrer"


# ---------------------------------------------------------------------------
# THI-166 / sec:M3 — Max-Age on cookie + sliding session expiry
# ---------------------------------------------------------------------------


def test_session_cookie_has_max_age(token_path, monkeypatch):
    monkeypatch.setattr(settings, "auth_required", True)
    with TestClient(create_app(), base_url=BASE_URL, follow_redirects=False) as client:
        r = client.get(f"/api/state?token={auth_mod.auth_state.token}")
        assert r.status_code == 303
        # httpx merges multiple Set-Cookie headers via `get_list`.
        set_cookies = r.headers.get_list("set-cookie")
        sb_session_set_cookies = [c for c in set_cookies if c.startswith("sb_session=")]
        assert sb_session_set_cookies, (
            f"expected an sb_session Set-Cookie header; got {set_cookies}"
        )
        assert "Max-Age=" in sb_session_set_cookies[0]
        assert "HttpOnly" in sb_session_set_cookies[0]


def test_session_expires_when_idle_past_ttl(token_path, monkeypatch):
    """is_valid_session refreshes last_seen on use; sessions idle past
    SESSION_TTL_S are evicted."""
    import time as _time

    sess = auth_mod.auth_state.create_session()
    # Fresh session → valid.
    assert auth_mod.auth_state.is_valid_session(sess)
    # Backdate last_seen past the TTL.
    auth_mod.auth_state.sessions[sess]["last_seen"] = _time.monotonic() - auth_mod.SESSION_TTL_S - 1
    # Now it should be considered expired and dropped.
    assert not auth_mod.auth_state.is_valid_session(sess)
    assert sess not in auth_mod.auth_state.sessions


# ---------------------------------------------------------------------------
# THI-167 / sec:M4 — rate limit on auto-rename + WS connect
# ---------------------------------------------------------------------------


def test_rate_limiter_allows_under_budget_then_blocks():
    from switchboard.rate_limit import RateLimiter

    limiter = RateLimiter(max_calls=3, window_s=60.0, name="t")
    assert limiter.allow("ip-a")
    assert limiter.allow("ip-a")
    assert limiter.allow("ip-a")
    # 4th call within the window is blocked.
    assert not limiter.allow("ip-a")
    # Other keys have their own bucket.
    assert limiter.allow("ip-b")


# ---------------------------------------------------------------------------
# THI-168 / sec:M5 — reject "*" and malformed CORS origins at startup
# ---------------------------------------------------------------------------


def test_create_app_refuses_wildcard_cors(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "cors_origins", ["*"])
    with pytest.raises(RuntimeError, match="\\*"):
        create_app()


def test_create_app_refuses_origin_without_scheme(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "cors_origins", ["localhost:5173"])
    with pytest.raises(RuntimeError, match="http://"):
        create_app()


def test_create_app_refuses_glob_origin(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "cors_origins", ["http://*.example.com"])
    with pytest.raises(RuntimeError, match="\\*"):
        create_app()


# ---------------------------------------------------------------------------
# THI-169 / sec:M6 — CSP + security response headers
# ---------------------------------------------------------------------------


def test_csp_and_security_headers_present(token_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/api/state")
        assert "content-security-policy" in r.headers
        csp = r.headers["content-security-policy"]
        assert "default-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp
        assert r.headers.get("x-frame-options") == "DENY"
        assert r.headers.get("x-content-type-options") == "nosniff"
        assert r.headers.get("referrer-policy") == "no-referrer"


def test_security_headers_present_on_healthz_too(token_path, monkeypatch):
    """Open paths still emit baseline security headers — defense in depth."""
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/healthz")
        assert r.headers.get("x-frame-options") == "DENY"
        assert "content-security-policy" in r.headers


# ---------------------------------------------------------------------------
# THI-172 / sec:M9 — regenerate requires authentication even in loopback
# ---------------------------------------------------------------------------


def test_regenerate_rejects_csrf_only_without_session_or_bearer(token_path, monkeypatch):
    """In loopback mode a same-origin malicious page could previously
    rotate the token with only the CSRF cookie. The route now requires
    a valid session OR a bearer match."""
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    with TestClient(create_app(), base_url=BASE_URL) as client:
        # Force-init AuthState so we have a CSRF secret without first GETting
        # anything (which would auto-issue a session and defeat the test).
        if not auth_mod.auth_state.csrf_secret:
            auth_mod.auth_state.init()
        csrf_secret = auth_mod.auth_state.csrf_secret
        # Set the CSRF cookie directly on the client; do NOT set sb_session.
        client.cookies.set("sb_csrf", csrf_secret)
        r = client.post(
            "/api/auth/regenerate",
            headers={"x-csrf-token": csrf_secret},
        )
        assert r.status_code == 401
