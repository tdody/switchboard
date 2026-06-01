"""ASGI security middleware: Host allowlist, auth, CSRF, response headers.

**Loopback mode** (default — bound to 127.0.0.1): no token required, zero
friction. But the Host header must match a loopback allowlist (defeats DNS
rebinding from a malicious web page) and mutating requests still need the
double-submit CSRF cookie+header.

**Exposed mode** (bound to a non-loopback host, or SWITCHBOARD_AUTH_REQUIRED
=true): additionally requires a bearer token, a session cookie, or a one-time
`?token=` bootstrap that gets exchanged for the session cookie.

`/healthz` and `/api/auth/status` bypass every check.

Every non-open response also carries a baseline set of security headers
(CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) — see
THI-169 (sec:M6).
"""

from __future__ import annotations

import json
import logging
import secrets
from urllib.parse import parse_qs, urlencode

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from switchboard.auth import auth_state
from switchboard.config import settings

log = logging.getLogger(__name__)

CSRF_COOKIE = "sb_csrf"
SESSION_COOKIE = "sb_session"
CSRF_HEADER = "x-csrf-token"
_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
_OPEN_PATHS = {"/healthz", "/api/auth/status"}

# Session-cookie lifetime (THI-166, sec:M3). Sliding window: each successful
# auth via the cookie refreshes `last_seen`. After this many seconds with no
# activity, the session is dropped from the server-side store and the cookie
# stops being honored. 24h matches the typical "logged in for a working day"
# pattern; tune via env if your deployment needs longer.
SESSION_TTL_S = 24 * 60 * 60

# Baseline security response headers (THI-169, sec:M6). Applied to every
# non-open HTTP response. Frame-ancestors=none blocks clickjacking; CSP
# blocks any future inline-script regression; nosniff blocks MIME confusion
# attacks against served JS bundles.
_BASE_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    # xterm.js + Vite-built bundles include some inline style attributes;
    # 'unsafe-inline' on styles only (not scripts) is the standard trade-off.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: blob:; "
    # connect-src must allow WebSocket — the frontend opens ws://host:port/ws/*
    "connect-src 'self' ws: wss:; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)
_SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"content-security-policy", _BASE_CSP.encode("latin-1")),
    (b"x-frame-options", b"DENY"),
    (b"x-content-type-options", b"nosniff"),
    # THI-165 (sec:M2): never let the page leak its URL via Referer — important
    # because the bootstrap URL carries `?token=` until we 303 it away.
    (b"referrer-policy", b"no-referrer"),
)


def _parse_cookies(headers: Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in headers.get("cookie", "").split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _query_without_token(query_string: bytes) -> bytes:
    """Return `query_string` with all `token` keys removed. Used by the
    303 bootstrap redirect (THI-165, sec:M2) so the cleaned URL preserves
    every other query param the user had."""
    pairs = parse_qs(query_string.decode("latin-1"), keep_blank_values=True)
    pairs.pop("token", None)
    flat = [(k, v) for k, vs in pairs.items() for v in vs]
    return urlencode(flat).encode("latin-1")


class SecurityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        if scope.get("path", "") in _OPEN_PATHS:
            # Open paths still get baseline security headers (M6) but no
            # cookies, no auth, no Host check.
            await self.app(scope, receive, self._with_security_headers(send))
            return

        headers = Headers(scope=scope)
        cookies = _parse_cookies(headers)
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))

        # 1. Host allowlist — loopback mode only (anti DNS-rebinding).
        # THI-164 (sec:M1): normalize the Host header (lowercase, strip
        # trailing dot, parse IPv6 brackets) before comparing — a static
        # set-membership check missed case variants and `localhost.` style
        # rewrites.
        if settings.loopback_mode:
            host = headers.get("host", "")
            if host and not settings.host_header_is_allowed(host):
                await self._reject(scope, receive, send, 421, "bad host header")
                return

        # 2. Authentication.
        via_query_token = False
        if settings.auth_enabled:
            authed, via_query_token = self._authenticate(headers, cookies, query)
            if not authed:
                await self._reject(scope, receive, send, 401, "authentication required")
                return

        # 3. CSRF — mutating HTTP requests carry the double-submit cookie+header.
        if scope["type"] == "http" and scope.get("method", "GET").upper() in _MUTATING:
            if not self._csrf_ok(headers, cookies):
                await self._reject(scope, receive, send, 403, "missing or invalid CSRF token")
                return

        # 4. WebSocket Origin check (THI-159/THI-160, sec:H1+H2) — enforced in
        # BOTH modes. The WS handshake is fully-mutating (each text frame
        # becomes a tmux send-keys), but browsers cannot send a CSRF header on
        # the upgrade, so Origin is our only defense against cross-origin
        # drive-by attacks. Missing Origin is treated as "not allowed" rather
        # than fail-open: a non-browser CLI tool can opt in by setting Origin
        # to one of the configured cors_origins.
        if scope["type"] == "websocket":
            origin = headers.get("origin")
            if not origin or origin not in settings.cors_origins:
                await self._reject(scope, receive, send, 403, "origin not allowed")
                return

        # 5. THI-165 (sec:M2): on the ?token= bootstrap (GET only), 303-redirect
        # to a URL without the token query param. This stops the token from
        # ending up in browser history, Referer headers to third-party assets,
        # or upstream proxy access logs. The session cookie is set as part of
        # the redirect response.
        if (
            via_query_token
            and scope["type"] == "http"
            and scope.get("method", "GET").upper() == "GET"
            and SESSION_COOKIE not in cookies
        ):
            await self._redirect_strip_token(scope, send)
            return

        # 6. Cookie + security-header response wrapper.
        set_csrf = scope["type"] == "http" and CSRF_COOKIE not in cookies
        # Mint an opaque session ID on the ?token= bootstrap (THI-161, sec:H3)
        # — never echo the raw API token as the cookie value.
        session_value: str | None = None
        if via_query_token and SESSION_COOKIE not in cookies:
            session_value = auth_state.create_session()
        # THI-172 (sec:M9): auto-issue a session in loopback mode too, so the
        # /api/auth/regenerate route has something to authenticate against.
        # The session cookie there is just a same-origin marker — the real
        # security in loopback is the Host header allowlist plus CSRF.
        elif (
            scope["type"] == "http"
            and not settings.auth_enabled  # loopback
            and SESSION_COOKIE not in cookies
        ):
            session_value = auth_state.create_session()
        send = self._response_wrapper(send, scope, set_csrf, session_value)
        await self.app(scope, receive, send)

    @staticmethod
    def _authenticate(
        headers: Headers, cookies: dict[str, str], query: dict[str, list[str]]
    ) -> tuple[bool, bool]:
        """Returns (authenticated, via_query_token).

        Bearer header and ?token= bootstrap compare against the API token.
        Session cookie is validated against the server-side session store
        (THI-161, sec:H3) — NOT compared to the token, so a leaked cookie
        cannot be used as a bearer-equivalent token.
        """
        token = auth_state.token
        auth_header = headers.get("authorization", "")
        if auth_header.startswith("Bearer ") and secrets.compare_digest(auth_header[7:], token):
            return True, False
        sess = cookies.get(SESSION_COOKIE, "")
        if sess and auth_state.is_valid_session(sess):
            return True, False
        q = (query.get("token") or [""])[0]
        if q and secrets.compare_digest(q, token):
            return True, True
        return False, False

    @staticmethod
    def _csrf_ok(headers: Headers, cookies: dict[str, str]) -> bool:
        cookie = cookies.get(CSRF_COOKIE, "")
        header = headers.get(CSRF_HEADER, "")
        return bool(cookie) and bool(header) and secrets.compare_digest(cookie, header)

    @staticmethod
    def _response_wrapper(
        send: Send, scope: Scope, set_csrf: bool, session_value: str | None
    ) -> Send:
        secure = scope.get("scheme") == "https"

        def _cookie(name: str, value: str, *, http_only: bool, max_age: int | None = None) -> bytes:
            attrs = f"{name}={value}; Path=/; SameSite=Strict"
            if http_only:
                attrs += "; HttpOnly"
            if secure:
                attrs += "; Secure"
            if max_age is not None:
                attrs += f"; Max-Age={max_age}"
            return attrs.encode("latin-1")

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                hdrs = list(message.get("headers", []))
                if set_csrf:
                    hdrs.append(
                        (
                            b"set-cookie",
                            _cookie(CSRF_COOKIE, auth_state.csrf_secret, http_only=False),
                        )
                    )
                if session_value:
                    # THI-166 (sec:M3): cookie carries Max-Age matching the
                    # server-side TTL so the browser stops sending it after
                    # the session is gone server-side anyway.
                    hdrs.append(
                        (
                            b"set-cookie",
                            _cookie(
                                SESSION_COOKIE,
                                session_value,
                                http_only=True,
                                max_age=SESSION_TTL_S,
                            ),
                        )
                    )
                # THI-169 (sec:M6): baseline security headers on every response.
                hdrs.extend(_SECURITY_HEADERS)
                message["headers"] = hdrs
            await send(message)

        return wrapped

    @staticmethod
    def _with_security_headers(send: Send) -> Send:
        """Lightweight wrapper for open paths (`/healthz`, `/api/auth/status`)
        that need security headers but no cookies."""

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                hdrs = list(message.get("headers", []))
                hdrs.extend(_SECURITY_HEADERS)
                message["headers"] = hdrs
            await send(message)

        return wrapped

    @staticmethod
    async def _redirect_strip_token(scope: Scope, send: Send) -> None:
        """303-redirect a GET that carried `?token=` to the same path without
        it (THI-165, sec:M2). Sets the session cookie as part of the response,
        plus the baseline CSRF cookie and security headers."""
        path = scope.get("path", "/")
        cleaned_qs = _query_without_token(scope.get("query_string", b""))
        location = path
        if cleaned_qs:
            location = f"{path}?{cleaned_qs.decode('latin-1')}"
        secure = scope.get("scheme") == "https"
        session_value = auth_state.create_session()

        def _cookie(name: str, value: str, *, http_only: bool, max_age: int | None = None) -> bytes:
            attrs = f"{name}={value}; Path=/; SameSite=Strict"
            if http_only:
                attrs += "; HttpOnly"
            if secure:
                attrs += "; Secure"
            if max_age is not None:
                attrs += f"; Max-Age={max_age}"
            return attrs.encode("latin-1")

        hdrs: list[tuple[bytes, bytes]] = [
            (b"location", location.encode("latin-1")),
            (b"content-length", b"0"),
            (
                b"set-cookie",
                _cookie(CSRF_COOKIE, auth_state.csrf_secret, http_only=False),
            ),
            (
                b"set-cookie",
                _cookie(SESSION_COOKIE, session_value, http_only=True, max_age=SESSION_TTL_S),
            ),
        ]
        hdrs.extend(_SECURITY_HEADERS)
        await send({"type": "http.response.start", "status": 303, "headers": hdrs})
        await send({"type": "http.response.body", "body": b""})

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send, status: int, detail: str) -> None:
        if scope["type"] == "websocket":
            try:
                await receive()  # consume the websocket.connect
            except Exception as e:  # noqa: BLE001
                log.debug("ws connect consume failed during reject: %s", e)
            await send({"type": "websocket.close", "code": 4401})
            return
        body = json.dumps({"detail": detail}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
