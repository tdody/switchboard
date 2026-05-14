import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from switchboard.auth import auth_state
from switchboard.config import settings
from switchboard.routers import actions, auth, pane, state, ws
from switchboard.security import SecurityMiddleware

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    auth_state.init()
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
    # Added inner-first: SecurityMiddleware runs inside CORS so that rejected
    # requests still get CORS headers on the way back out.
    app.add_middleware(SecurityMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(state.router)
    app.include_router(pane.router)
    app.include_router(actions.router)
    app.include_router(auth.router)
    app.include_router(ws.router)
    return app


app = create_app()
