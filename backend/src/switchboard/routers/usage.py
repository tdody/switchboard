"""HTTP surface for Claude usage (THI-110).

Lives at `/api/usage` rather than folded into `/api/state` for two reasons:
  - `/api/state` polls at 100 ms when the terminal modal is open (THI-105). The
    JSONL walk is cached but a busy 100 ms-cadence ETag race against a 30 s
    cache window would still recompute hashes 10x/s for nothing.
  - Usage failures (jsonl parse drift on a Claude Code upgrade, or the future
    `/usage` scrape) shouldn't poison `/api/state`, which the rest of the UI
    depends on.

Token usage is cached for 30 s and is cheap; this endpoint is safe to poll on
a separate 30 s cadence from the frontend. The `scrape` half of the response
is wired in commit 2 of THI-110.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter

from switchboard.schemas import UsageResponse
from switchboard.services import claude_usage

router = APIRouter(prefix="/api")


@router.get("/usage", response_model=UsageResponse)
async def get_usage() -> UsageResponse:
    # `cached_token_usage` does (potentially) a small FS walk + JSONL parse;
    # off-load to a worker thread so the event loop stays responsive even on
    # a cold cache.
    tokens = await asyncio.to_thread(claude_usage.cached_token_usage)
    return UsageResponse(tokens=tokens, scrape=None)
