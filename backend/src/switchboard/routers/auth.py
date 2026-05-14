from fastapi import APIRouter
from pydantic import BaseModel

from switchboard.auth import auth_state
from switchboard.config import settings

router = APIRouter(prefix="/api/auth")


class AuthStatus(BaseModel):
    auth_enabled: bool
    loopback_mode: bool


class RegenerateResponse(BaseModel):
    token: str
    auth_enabled: bool
    loopback_mode: bool


@router.get("/status", response_model=AuthStatus)
def auth_status() -> AuthStatus:
    """Open endpoint — lets the frontend know whether a token is required."""
    return AuthStatus(
        auth_enabled=settings.auth_enabled,
        loopback_mode=settings.loopback_mode,
    )


@router.post("/regenerate", response_model=RegenerateResponse)
def regenerate() -> RegenerateResponse:
    """Rotate the API token. Returns the new token once, in full, so it can be
    copied. Any existing session cookie is invalidated by the rotation."""
    token = auth_state.rotate_token()
    return RegenerateResponse(
        token=token,
        auth_enabled=settings.auth_enabled,
        loopback_mode=settings.loopback_mode,
    )
