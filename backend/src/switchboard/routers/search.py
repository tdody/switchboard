"""Pane history search (THI-100).

`GET /api/search?q=<term>&lines=<N>` walks every active pane via libtmux,
runs `capture_pane(-S -<N>)` on each, and grep's case-insensitively for the
term. Returns a flat list of matches, each carrying enough context (line
above, match line, line below) for the UI to render a useful result row.

Captures run in parallel via `asyncio.to_thread` so the route stays
responsive under modal-open polling cadence even with many panes.
"""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, HTTPException

from switchboard.schemas import SearchMatch, SearchResponse
from switchboard.services import tmux

router = APIRouter(prefix="/api")

_DEFAULT_LINES = 500
_MAX_LINES = 5_000
_MAX_MATCHES_PER_PANE = 50

# CSI escape sequences only (no OSC/DCS — tmux's `-e` output doesn't carry
# those for ordinary content). Matches `\x1b[…<final>` where the final byte
# is in the 0x40-0x7e range.
_ANSI_CSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def _strip_ansi(line: str) -> str:
    return _ANSI_CSI_RE.sub("", line)


def _search_one_pane(
    session: str,
    index: int,
    window_name: str,
    pane_id: str,
    needle: str,
    lines: int,
) -> list[SearchMatch]:
    """Capture one pane and return its substring matches with context."""
    captured = tmux.capture_pane(session, index, lines=lines)
    if not captured:
        return []
    stripped = [_strip_ansi(line) for line in captured]
    matches: list[SearchMatch] = []
    for i, line in enumerate(stripped):
        if needle in line.lower():
            ctx_above = stripped[i - 1] if i > 0 else ""
            ctx_below = stripped[i + 1] if i + 1 < len(stripped) else ""
            matches.append(
                SearchMatch(
                    pane_id=pane_id,
                    session=session,
                    window_name=window_name,
                    window_index=index,
                    line_number=i + 1,
                    context=[ctx_above, line, ctx_below],
                )
            )
            if len(matches) >= _MAX_MATCHES_PER_PANE:
                break
    return matches


@router.get("/search")
async def search(q: str, lines: int = _DEFAULT_LINES) -> SearchResponse:
    if not q.strip():
        # Empty query would match every line in every pane — refuse rather
        # than DoS the dashboard.
        raise HTTPException(status_code=400, detail="query must not be empty")
    lines = max(1, min(lines, _MAX_LINES))

    srv = tmux.get_server()
    if srv is None:
        return SearchResponse(query=q, matches=[])

    # Enumerate all (session, index, window_name, pane_id) targets up front
    # on a single thread — libtmux's session/window walk isn't worth
    # parallelizing and the underlying tmux server already serializes.
    targets: list[tuple[str, int, str, str]] = []
    for s in srv.sessions:
        sess_name = s.session_name or ""
        try:
            session_windows = list(s.windows)
        except Exception:  # noqa: BLE001 — libtmux can vanish mid-walk
            continue
        for w in session_windows:
            pane = w.active_pane
            if pane is None:
                continue
            try:
                idx = int(w.window_index or 0)
            except (TypeError, ValueError):
                continue
            targets.append(
                (sess_name, idx, w.window_name or "", pane.pane_id or "")
            )

    needle = q.lower()
    results = await asyncio.gather(
        *(
            asyncio.to_thread(
                _search_one_pane, sess, idx, win_name, pane_id, needle, lines
            )
            for sess, idx, win_name, pane_id in targets
        )
    )
    flat: list[SearchMatch] = [m for sub in results for m in sub]
    return SearchResponse(query=q, matches=flat)
