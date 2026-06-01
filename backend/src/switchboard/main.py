import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from switchboard.auth import auth_state, mask
from switchboard.config import is_loopback_host, settings
from switchboard.logconfig import RequestContextMiddleware, setup_logging
from switchboard.routers import actions, auth, pane, rename_ai, state, usage, ws
from switchboard.security import SecurityMiddleware
from switchboard.services import claude_usage, pane_stream

log = logging.getLogger(__name__)


def _assert_safe_config() -> None:
    """Fail fast on dangerous host/auth combinations (THI-163, sec:H5).

    A user who explicitly sets `SWITCHBOARD_AUTH_REQUIRED=false` AND a
    non-loopback host is asking to expose an unauthenticated tmux/shell to
    the network. Refuse to start rather than silently doing that — the
    auto-detect path (`auth_required=None`) still flips auth on for
    non-loopback hosts, so legitimate exposed deployments are unaffected.
    """
    if settings.auth_required is False and not is_loopback_host(settings.host):
        raise RuntimeError(
            f"refusing to start: host={settings.host!r} is non-loopback but "
            "SWITCHBOARD_AUTH_REQUIRED=false. Set SWITCHBOARD_AUTH_REQUIRED=true "
            "or unset it to use the auto-detect default."
        )


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
        # NEVER log the plaintext token (THI-162, sec:H4) — log streams flow
        # into journald/Docker/log forwarders/scrollback. Log only a masked
        # fingerprint; write the bootstrap URL to a 0600 file the operator
        # can `cat` once, and also print it to stdout once for the launching
        # terminal. Stdout is NOT routed through the structured logger.
        bootstrap_url = f"http://{settings.host}:{settings.port}/?token={auth_state.token}"
        bootstrap_file = settings.token_file.parent / "bootstrap.url"
        try:
            bootstrap_file.parent.mkdir(parents=True, exist_ok=True)
            # Atomic 0600 write via os.open so the file is never world-readable.
            fd = os.open(
                bootstrap_file,
                os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
                0o600,
            )
            try:
                os.write(fd, (bootstrap_url + "\n").encode())
            finally:
                os.close(fd)
        except OSError as e:
            log.warning("could not write bootstrap URL file %s: %s", bootstrap_file, e)
        log.warning(
            "Switchboard auth ENABLED (host=%s); token fingerprint=%s; bootstrap URL written to %s",
            settings.host,
            mask(auth_state.token),
            bootstrap_file,
        )
        print(f"Switchboard bootstrap URL: {bootstrap_url}", file=sys.stdout, flush=True)
    else:
        log.info(
            "Switchboard in loopback mode (host=%s) — auth bypassed for local requests.",
            settings.host,
        )
    yield


def create_app() -> FastAPI:
    _assert_safe_config()
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
