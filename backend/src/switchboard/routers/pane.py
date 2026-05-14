from fastapi import APIRouter, HTTPException

from switchboard.config import settings
from switchboard.services import tmux

router = APIRouter(prefix="/api")


@router.get("/pane")
def get_pane(session: str, index: int, lines: int | None = None) -> dict[str, list[str]]:
    n = lines or settings.pane_capture_lines
    captured = tmux.capture_pane(session, index, lines=n)
    if captured is None:
        raise HTTPException(status_code=404, detail="pane not found")
    return {"lines": captured}
