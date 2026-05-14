"""Structured logging: key=value formatter + per-request correlation IDs.

A request-scoped contextvar carries a short correlation id; WebSocket streams
additionally carry a `session:index` scope tag. The formatter injects both into
every log line emitted within that request/task, so a slow or failing request
can be traced across modules.

`contextvars` propagate into `asyncio.create_task` children (the context is
copied at task-creation time), so the pane-stream task inherits the WS scope
tag without any explicit plumbing.

Named `logconfig` rather than `logging` to avoid shadowing the stdlib module.
"""

from __future__ import annotations

import contextvars
import logging
import sys
import uuid
from urllib.parse import parse_qs

from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Empty outside a request. Set by RequestContextMiddleware.
request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")
# Optional extra scope tag, e.g. "ws main:0" for a pane stream.
scope_tag: contextvars.ContextVar[str] = contextvars.ContextVar("scope_tag", default="")

_configured = False


def new_request_id() -> str:
    return uuid.uuid4().hex[:8]


class ContextFilter(logging.Filter):
    """Attach the request-scoped contextvars to each LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get()
        record.scope_tag = scope_tag.get()
        return True


class KeyValueFormatter(logging.Formatter):
    """`<ts> level=… logger=… [req=…] [scope=…] msg=…` — one line per record."""

    def format(self, record: logging.LogRecord) -> str:
        parts = [
            self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            f"level={record.levelname}",
            f"logger={record.name}",
        ]
        rid = getattr(record, "request_id", "")
        if rid:
            parts.append(f"req={rid}")
        tag = getattr(record, "scope_tag", "")
        if tag:
            parts.append(f"scope={tag!r}")
        parts.append(f"msg={record.getMessage()!r}")
        line = " ".join(parts)
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def setup_logging(level: int = logging.INFO) -> None:
    """Install the structured handler on the root logger (idempotent).

    uvicorn ships its own handlers; we clear them and let those loggers
    propagate to the root so everything is formatted consistently.
    """
    global _configured
    if _configured:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(KeyValueFormatter())
    handler.addFilter(ContextFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True

    _configured = True


class RequestContextMiddleware:
    """Assigns a correlation id per HTTP request / WS stream, binds it to the
    logging contextvars, echoes it as `X-Request-ID`, and logs any unhandled
    exception while the id is still in context."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        rid = new_request_id()
        rid_token = request_id.set(rid)
        tag_token = None
        if scope["type"] == "websocket":
            query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
            sess = (query.get("session") or [""])[0]
            idx = (query.get("index") or [""])[0]
            if sess:
                tag_token = scope_tag.set(f"ws {sess}:{idx}")

        log = logging.getLogger("switchboard.request")
        try:
            if scope["type"] == "http":
                await self.app(scope, receive, self._tag_response(send, rid))
            else:
                await self.app(scope, receive, send)
        except Exception:
            # Logged here, while the contextvar is still set — Starlette's
            # ServerErrorMiddleware runs outside this scope and would lose it.
            log.exception("unhandled exception")
            raise
        finally:
            request_id.reset(rid_token)
            if tag_token is not None:
                scope_tag.reset(tag_token)

    @staticmethod
    def _tag_response(send: Send, rid: str) -> Send:
        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", rid.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        return wrapped
