from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
    ok = tmux.send_keys(session, index, keys=body.keys, paste=body.paste)
    if not ok:
        raise HTTPException(status_code=404, detail="pane not found")
    return {"ok": True}


@router.post("/rename")
def post_rename(session: str, index: int, body: RenameBody) -> dict[str, object]:
    ok = tmux.rename_window(session, index, body.name)
    if not ok:
        raise HTTPException(status_code=404, detail="window not found")
    return {"ok": True, "name": body.name}
