from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from switchboard.config import settings
from switchboard.routers import actions, pane, state, ws


def create_app() -> FastAPI:
    app = FastAPI(title="Switchboard", version="0.1.0")
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
    app.include_router(ws.router)
    return app


app = create_app()
