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
    # Command-palette text is always a typed block — bracket the paste so
    # embedded newlines don't each submit; the trailing keys (Enter) submit once.
    ok = tmux.send_keys(
        session, index, keys=body.keys, paste=body.paste, bracketed=True
    )
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
