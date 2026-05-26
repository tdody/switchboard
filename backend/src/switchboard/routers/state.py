import asyncio
import hashlib

from fastapi import APIRouter, Header, Response

from switchboard.services import tmux

router = APIRouter(prefix="/api")


@router.get("/state")
async def get_state(
    response: Response,
    if_none_match: str | None = Header(default=None),
) -> Response:
    # Run the synchronous libtmux/git/gh sweep off the event loop. The
    # single-flight wrapper coalesces concurrent callers onto one scan so
    # repeated polling under modal-open cadence (THI-105) can't exhaust the
    # process's FD budget by piling up parallel tmux subprocess spawns
    # (THI-142).
    state = await asyncio.to_thread(tmux.collect_state_singleflight)
    body = state.model_dump_json(by_alias=True).encode("utf-8")
    etag = '"' + hashlib.sha256(body).hexdigest()[:16] + '"'

    if if_none_match == etag:
        return Response(status_code=304, headers={"etag": etag, "cache-control": "no-cache"})

    return Response(
        content=body,
        media_type="application/json",
        headers={"etag": etag, "cache-control": "no-cache"},
    )
