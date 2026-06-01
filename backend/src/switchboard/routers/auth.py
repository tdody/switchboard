import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from switchboard.auth import auth_state
from switchboard.config import settings
from switchboard.security import SESSION_COOKIE

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
def regenerate(request: Request) -> RegenerateResponse:
    """Rotate the API token. Returns the new token once, in full, so it can be
    copied. Any existing session cookie is invalidated by the rotation.

    THI-172 (sec:M9): regenerate requires authentication regardless of mode.
    The SecurityMiddleware skips auth in loopback, but rotating the API
    token is a sensitive operation — a malicious local page (or a stale
    background tab) with only the CSRF cookie should NOT be able to lock
    the legitimate user out. We accept either:

    * a valid session cookie (sb_session), OR
    * a matching `Authorization: Bearer <token>` header.

    In loopback mode the middleware auto-issues a session cookie on the
    first response so the SPA's regenerate button keeps working seamlessly.
    """
    sess = request.cookies.get(SESSION_COOKIE, "")
    bearer = request.headers.get("authorization", "")
    bearer_ok = bearer.startswith("Bearer ") and secrets.compare_digest(
        bearer[7:], auth_state.token
    )
    session_ok = bool(sess) and auth_state.is_valid_session(sess)
    if not (bearer_ok or session_ok):
        raise HTTPException(
            status_code=401,
            detail="regenerate requires an authenticated session or bearer token",
        )
    token = auth_state.rotate_token()
    return RegenerateResponse(
        token=token,
        auth_enabled=settings.auth_enabled,
        loopback_mode=settings.loopback_mode,
    )
