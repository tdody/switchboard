from fastapi import APIRouter

from switchboard.schemas import StateResponse
from switchboard.services import tmux

router = APIRouter(prefix="/api")


@router.get("/state", response_model=StateResponse, response_model_by_alias=True)
def get_state() -> StateResponse:
    return tmux.collect_state()
