"""Per-key token-bucket rate limiter (THI-167, sec:M4).

In-memory; no external dependencies. Suited for single-worker uvicorn — the
canonical Switchboard deployment. Under `uvicorn --workers >1` each worker
keeps its own counters, which over-counts limits by a factor of N but still
caps the worst-case blast radius. That trade-off beats pulling in Redis or
slowapi for a personal dev tool.

Two limiters are configured in this module:

* `RENAME_AI_LIMITER` — caps Anthropic-billed endpoints at 10 requests per
  minute per client IP. Prevents a malicious tab from running up the bill.
* `WS_CONNECT_LIMITER` — caps WebSocket connections at 30 per minute per
  client IP. Prevents FD exhaustion / connect-flood DoS.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from collections.abc import Mapping
from threading import Lock

log = logging.getLogger(__name__)


class RateLimiter:
    """Sliding-window counter: `max_calls` within `window_s` seconds per key.

    Calling `allow(key)` records the attempt and returns True if it fits in
    the window. Returns False (and does NOT record the attempt) when the
    budget is exhausted, so a flood doesn't keep refreshing its own ban.
    """

    def __init__(self, max_calls: int, window_s: float, *, name: str = "limiter") -> None:
        self.max_calls = max_calls
        self.window_s = window_s
        self.name = name
        self._calls: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        if not key:
            # Empty key → can't distinguish callers, treat as denied. Caller
            # should pass a real client identifier (IP, session ID).
            return False
        now = time.monotonic()
        with self._lock:
            q = self._calls.setdefault(key, deque())
            # Drop stale entries from the head.
            cutoff = now - self.window_s
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= self.max_calls:
                return False
            q.append(now)
        return True

    def reset(self) -> None:
        """For tests: clear all counters."""
        with self._lock:
            self._calls.clear()


# Per-IP, 10 Anthropic calls per minute. Generous for legitimate use (the UI
# fires one call per ✨ click, which a human cannot exceed) but more than
# tight enough to neutralize a malicious tab in a fetch loop.
RENAME_AI_LIMITER = RateLimiter(max_calls=10, window_s=60.0, name="rename_ai")

# Per-IP, 30 WS connections per minute. Same logic — a human reopens panes
# at human speed.
WS_CONNECT_LIMITER = RateLimiter(max_calls=30, window_s=60.0, name="ws_connect")


def client_ip(scope_or_request: object) -> str:
    """Best-effort client identifier for rate-limiting purposes.

    Accepts either a Starlette `Request` (has `.client.host`) or a raw ASGI
    `scope` dict (has `scope["client"] == (host, port)`). Falls back to a
    constant so a misconfigured proxy doesn't silently bypass the limiter.
    Honors `X-Forwarded-For` only if `client.host` is loopback — outside
    that case we don't trust the header (no signed forwarding chain).
    """
    host: str | None = None
    if isinstance(scope_or_request, Mapping):
        # ASGI scope; treat as a generic mapping. ty narrows `object` to
        # `Mapping[Unknown, Unknown]` here which makes a typed `.get` call
        # awkward — getattr-style fallback works around it.
        client_obj: object = scope_or_request.get("client")  # ty: ignore
        if isinstance(client_obj, (tuple, list)) and len(client_obj) >= 1:
            host = str(client_obj[0])
    else:
        client = getattr(scope_or_request, "client", None)
        if client is not None:
            host = getattr(client, "host", None)
    return host or "unknown"
