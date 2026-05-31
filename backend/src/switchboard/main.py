import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from switchboard.auth import auth_state
from switchboard.config import settings
from switchboard.logconfig import RequestContextMiddleware, setup_logging
from switchboard.routers import actions, auth, pane, rename_ai, state, usage, ws
from switchboard.security import SecurityMiddleware
from switchboard.services import claude_usage, pane_stream

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    auth_state.init()
    # Sweep stale `sb-pane-<pid>-*.fifo` from any prior crashed run, then arm
    # an atexit hook for clean SIGTERM shutdowns (THI-85). The startup sweep
    # is what catches SIGKILL cases where atexit never ran. PID-scoped so
    # that under `uvicorn --workers >1` each worker only touches its own
    # FIFOs and never a sibling's live ones.
    swept = pane_stream.cleanup_orphaned_fifos()
    if swept:
        log.info("Cleared %d orphaned pane FIFO(s) from a prior run.", swept)
    pane_stream.install_fifo_cleanup_hook()
    # Same idea for THI-110's `sb-usage-<uuid8>` headless tmux sessions —
    # SIGKILL'd scrapes leave the session behind. Sweep on startup, then
    # prewarm the scrape cache so the first /api/usage poll already has
    # plan-percentage data instead of returning null for 30 s.
    swept_usage = claude_usage.cleanup_orphaned_usage_sessions()
    if swept_usage:
        log.info("Cleared %d orphaned usage tmux session(s) from a prior run.", swept_usage)
    if settings.usage_scrape_enabled:
        claude_usage.prewarm_scrape()
    if settings.auth_enabled:
        log.warning(
            "Switchboard auth ENABLED (host=%s). Bootstrap URL: http://%s:%s/?token=%s",
            settings.host,
            settings.host,
            settings.port,
            auth_state.token,
        )
    else:
        log.info(
            "Switchboard in loopback mode (host=%s) — auth bypassed for local requests.",
            settings.host,
        )
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Switchboard", version="0.1.0", lifespan=lifespan)
    # Added inner-first. SecurityMiddleware runs inside RequestContextMiddleware
    # so security rejections are logged with a correlation id; both run inside
    # CORS so even rejected responses still carry CORS headers.
    app.add_middleware(SecurityMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id", "etag"],
    )

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(state.router)
    app.include_router(pane.router)
    app.include_router(actions.router)
    app.include_router(auth.router)
    app.include_router(rename_ai.router)
    app.include_router(usage.router)
    app.include_router(ws.router)
    return app


app = create_app()
