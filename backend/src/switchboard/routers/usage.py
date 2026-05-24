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

from switchboard.config import settings
from switchboard.schemas import UsageConfig, UsageResponse
from switchboard.services import claude_usage

router = APIRouter(prefix="/api")


@router.get("/usage/config", response_model=UsageConfig)
def get_usage_config() -> UsageConfig:
    """Read-only knobs for the Settings panel — surfaces whether the optional
    `claude /usage` scrape is wired and the cache TTLs (THI-110 commit 3).
    Tiny payload + rare callsite (Settings open), so no caching needed."""
    return UsageConfig(
        scrape_enabled=settings.usage_scrape_enabled,
        scrape_ttl_s=claude_usage._SCRAPE_TTL_S,
        token_ttl_s=claude_usage._TOKEN_TTL_S,
    )


@router.get("/usage", response_model=UsageResponse)
async def get_usage() -> UsageResponse:
    # `cached_token_usage` does (potentially) a small FS walk + JSONL parse;
    # off-load to a worker thread so the event loop stays responsive even on
    # a cold cache.
    tokens = await asyncio.to_thread(claude_usage.cached_token_usage)
    scrape = None
    if settings.usage_scrape_enabled:
        # `cached_scraped_usage` is non-blocking on the hot path (just a cache
        # read + maybe-spawn a refresh thread). It returns None until the first
        # background scrape completes; the UI handles that by falling through
        # to the token-pill branch.
        scrape = await asyncio.to_thread(claude_usage.cached_scraped_usage)
    return UsageResponse(tokens=tokens, scrape=scrape)
