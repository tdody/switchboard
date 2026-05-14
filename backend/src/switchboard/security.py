"""ASGI security middleware: Host allowlist, auth, CSRF.

**Loopback mode** (default — bound to 127.0.0.1): no token required, zero
friction. But the Host header must match a loopback allowlist (defeats DNS
rebinding from a malicious web page) and mutating requests still need the
double-submit CSRF cookie+header.

**Exposed mode** (bound to a non-loopback host, or SWITCHBOARD_AUTH_REQUIRED
=true): additionally requires a bearer token, a session cookie, or a one-time
`?token=` bootstrap that gets exchanged for the session cookie.

`/healthz` and `/api/auth/status` bypass every check.
"""

from __future__ import annotations

import json
import logging
import secrets
from urllib.parse import parse_qs

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


def _parse_cookies(headers: Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in headers.get("cookie", "").split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


class SecurityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        if scope.get("path", "") in _OPEN_PATHS:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        cookies = _parse_cookies(headers)
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))

        # 1. Host allowlist — loopback mode only (anti DNS-rebinding).
        if settings.loopback_mode:
            host = headers.get("host", "")
            if host and host not in settings.allowed_hosts:
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

        # 4. WebSocket Origin check — exposed mode (loopback already trusts the host).
        if scope["type"] == "websocket" and settings.auth_enabled:
            origin = headers.get("origin")
            if origin and origin not in settings.cors_origins:
                await self._reject(scope, receive, send, 403, "origin not allowed")
                return

        set_csrf = scope["type"] == "http" and CSRF_COOKIE not in cookies
        session_value = (
            auth_state.token if via_query_token and SESSION_COOKIE not in cookies else None
        )
        if set_csrf or session_value:
            send = self._cookie_setter(send, scope, set_csrf, session_value)
        await self.app(scope, receive, send)

    @staticmethod
    def _authenticate(
        headers: Headers, cookies: dict[str, str], query: dict[str, list[str]]
    ) -> tuple[bool, bool]:
        """Returns (authenticated, via_query_token)."""
        token = auth_state.token
        auth_header = headers.get("authorization", "")
        if auth_header.startswith("Bearer ") and secrets.compare_digest(auth_header[7:], token):
            return True, False
        sess = cookies.get(SESSION_COOKIE, "")
        if sess and secrets.compare_digest(sess, token):
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
    def _cookie_setter(send: Send, scope: Scope, set_csrf: bool, session_value: str | None) -> Send:
        secure = scope.get("scheme") == "https"

        def _cookie(name: str, value: str, *, http_only: bool) -> bytes:
            attrs = f"{name}={value}; Path=/; SameSite=Strict"
            if http_only:
                attrs += "; HttpOnly"
            if secure:
                attrs += "; Secure"
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
                    hdrs.append(
                        (b"set-cookie", _cookie(SESSION_COOKIE, session_value, http_only=True))
                    )
                message["headers"] = hdrs
            await send(message)

        return wrapped

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
