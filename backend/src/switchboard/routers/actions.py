import tempfile
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from switchboard.config import settings
from switchboard.services import tmux

router = APIRouter(prefix="/api")


class SendBody(BaseModel):
    keys: list[str] | None = None
    paste: str | None = None


class RenameBody(BaseModel):
    name: str


@router.post("/focus")
def post_focus(session: str, index: int) -> dict[str, bool]:
    focused = tmux.focus(session, index)
    if focused is None:
        raise HTTPException(status_code=404, detail="window not found")
    return {"focused": focused}


@router.post("/send")
def post_send(session: str, index: int, body: SendBody) -> dict[str, bool]:
    # Command-palette text is always a typed block — bracket the paste so
    # embedded newlines don't each submit; the trailing keys (Enter) submit once.
    ok = tmux.send_keys(session, index, keys=body.keys, paste=body.paste, bracketed=True)
    if not ok:
        raise HTTPException(status_code=404, detail="pane not found")
    return {"ok": True}


@router.post("/rename")
def post_rename(session: str, index: int, body: RenameBody) -> dict[str, object]:
    ok = tmux.rename_window(session, index, body.name)
    if not ok:
        raise HTTPException(status_code=404, detail="window not found")
    return {"ok": True, "name": body.name}


@router.delete("/window")
def delete_window(session: str, index: int) -> dict[str, bool]:
    ok = tmux.kill_window(session, index)
    if not ok:
        raise HTTPException(status_code=404, detail="window not found")
    return {"ok": True}


@router.delete("/session")
def delete_session(session: str) -> dict[str, bool]:
    ok = tmux.kill_session(session)
    if not ok:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@router.post("/window")
def post_window(session: str, name: str) -> dict[str, object]:
    index = tmux.new_window(session, name)
    if index is None:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True, "index": index, "id": f"{session}:{index}"}


@router.post("/detach")
def post_detach(tty: str) -> dict[str, bool]:
    ok = tmux.detach_client(tty)
    if not ok:
        raise HTTPException(status_code=404, detail="client not found")
    return {"ok": True}


# --- image paste ------------------------------------------------------------

_PASTE_PREFIX = "switchboard-paste-"
_PASTE_MAX_AGE_S = 3600
_EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


def _sweep_old_paste_images() -> None:
    """Delete switchboard-paste-* temp files older than _PASTE_MAX_AGE_S."""
    cutoff = time.time() - _PASTE_MAX_AGE_S
    for path in Path(tempfile.gettempdir()).glob(f"{_PASTE_PREFIX}*"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            continue


@router.post("/paste-image")
async def post_paste_image(session: str, index: int, request: Request) -> dict[str, object]:
    """Accept a clipboard image and bracket-paste its @path into an agent pane."""
    mime = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    ext = _EXT_BY_MIME.get(mime)
    if ext is None:
        raise HTTPException(status_code=415, detail="unsupported image type")
    body = await request.body()
    if len(body) > settings.paste_image_max_bytes:
        raise HTTPException(status_code=413, detail="image too large")
    kind = tmux.pane_kind(session, index)
    if kind is None:
        raise HTTPException(status_code=404, detail="pane not found")
    if kind != "agent":
        raise HTTPException(status_code=409, detail="image paste is only supported for agent panes")
    _sweep_old_paste_images()
    path = Path(tempfile.gettempdir()) / f"{_PASTE_PREFIX}{uuid.uuid4().hex}.{ext}"
    try:
        path.write_bytes(body)
    except OSError:
        raise HTTPException(status_code=500, detail="failed to write temp file") from None
    # Claude Code's file-attach syntax: `@<path> ` (trailing space).
    if not tmux.deliver_text(session, index, f"@{path} ", bracketed=True):
        raise HTTPException(status_code=404, detail="pane not found")
    return {"ok": True, "path": str(path), "bytes": len(body)}
