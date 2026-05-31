"""Auto-rename endpoints (THI-67) — preview only.

The endpoints return rename *suggestions*; the frontend's modal lets the user
accept/skip per row and calls the existing `/api/rename` per accepted row.
That keeps a single `tmux rename-window` site (this route never mutates) and
lets the user override the model's choice before applying.

Status codes:
  - 503  no Anthropic key configured (UI then hides the ✨ button)
  - 401  SDK authentication failure (bad key)
  - 429  upstream rate limit
  - 502  model returned non-JSON / unparseable
  - 404  target session / window not found or empty
  - 200  `AutoRenameResponse` (suggestions + usage)
"""

from __future__ import annotations

import asyncio
import logging
import re

from fastapi import APIRouter, HTTPException

from switchboard.config import settings
from switchboard.schemas import AiStatus, AutoRenameResponse, RenameSuggestion, Usage
from switchboard.services import anthropic_client, claude_parser, tmux

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# ANSI SGR strip — captures the `^[[...m` color sequences that capture-pane
# emits with the `-e` flag. We strip them BEFORE feeding the prompt so we
# don't pay tokens for color noise.
_ANSI_RE = re.compile(r"\x1b\[[\d;]*m")

# Cap the snippet at last N non-empty lines + N chars so a chatty pane (npm
# build with thousands of progress lines) doesn't blow the context window.
_SNIPPET_LAST_LINES = 20
_SNIPPET_LAST_CHARS = 1200


@router.get("/auto-rename/status", response_model=AiStatus)
def auto_rename_status() -> AiStatus:
    """Lightweight capability probe — the frontend uses this to hide the ✨
    button before clicking would discover the key is missing, and to render
    the masked key + source in the Settings panel (THI-67)."""
    key, source = anthropic_client.resolve_key()
    return AiStatus(
        enabled=settings.anthropic_enabled,
        model=settings.anthropic_model,
        source=source,
        masked=anthropic_client.mask_key(key) if key else None,
    )


@router.post("/auto-rename-session", response_model=AutoRenameResponse)
async def auto_rename_session(session: str) -> AutoRenameResponse:
    """Suggest names for every window in `session`. Sequential per-window
    capture so a slow tmux doesn't pile up parallel `capture-pane` calls.
    The SDK request happens off the event loop via `asyncio.to_thread`."""
    # Heavy bits (libtmux + Anthropic SDK) all live in worker threads so the
    # event loop stays responsive even on a 30-window session.
    target_windows = await asyncio.to_thread(_collect_session_context, session)
    if not target_windows:
        raise HTTPException(status_code=404, detail=f"session {session!r} not found or empty")
    return await _suggest(target_windows)


@router.post("/auto-rename-window", response_model=AutoRenameResponse)
async def auto_rename_window(session: str, index: int) -> AutoRenameResponse:
    """Single-window variant of `/auto-rename-session`. Same prompt
    machinery, just scoped — useful when one card's name drifted but the
    rest are fine."""
    contexts = await asyncio.to_thread(_collect_window_context, session, index)
    if not contexts:
        raise HTTPException(status_code=404, detail=f"window {session}:{index} not found")
    return await _suggest(contexts)


async def _suggest(contexts: list[dict]) -> AutoRenameResponse:
    """Build the prompt, call Haiku, parse → AutoRenameResponse. Maps SDK
    exceptions to HTTP errors with the same mapping used across the file."""
    prompt = anthropic_client.build_rename_prompt(contexts)
    try:
        text, in_tok, out_tok = await asyncio.to_thread(anthropic_client.complete, prompt)
    except anthropic_client.AnthropicConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        # Import here so the rest of the app boots when the SDK isn't installed.
        from anthropic import APIStatusError, AuthenticationError, RateLimitError

        if isinstance(e, AuthenticationError):
            raise HTTPException(status_code=401, detail="invalid Anthropic API key") from e
        if isinstance(e, RateLimitError):
            raise HTTPException(status_code=429, detail="Anthropic rate limit hit") from e
        if isinstance(e, APIStatusError):
            raise HTTPException(status_code=502, detail=f"Anthropic API error: {e}") from e
        log.warning("auto-rename completion failed: %s", e)
        raise HTTPException(status_code=502, detail=f"completion failed: {e}") from e

    try:
        mapping = anthropic_client.parse_rename_response(text)
    except anthropic_client.AnthropicResponseError as e:
        log.warning("auto-rename parse failed: %s; raw[:200]=%r", e, e.raw[:200])
        raise HTTPException(status_code=502, detail=str(e)) from e

    suggestions = _diff_suggestions(contexts, mapping)
    return AutoRenameResponse(
        suggestions=suggestions,
        usage=Usage(
            input_tokens=in_tok,
            output_tokens=out_tok,
            est_cost_usd=anthropic_client.estimate_cost(in_tok, out_tok),
        ),
    )


def _diff_suggestions(contexts: list[dict], mapping: dict[str, str]) -> list[RenameSuggestion]:
    """Pair each context window with its mapped suggestion, ordered by the
    original window index for stable rendering. Empty / unchanged suggestions
    are kept in the response (`suggested == old`) — the modal grays them out
    so the user sees what wasn't changed too."""
    by_index = {int(c["index"]): c for c in contexts}
    suggestions: list[RenameSuggestion] = []
    for idx in sorted(by_index.keys()):
        old = by_index[idx]["current_name"]
        suggested = (mapping.get(str(idx)) or "").strip()
        # Cap to a sane length defensively — the prompt asks for ≤25 chars
        # but the model occasionally goes over.
        if len(suggested) > 50:
            suggested = suggested[:50]
        if not suggested:
            suggested = old  # nothing to change → show the row as a no-op
        suggestions.append(RenameSuggestion(index=idx, old=old, suggested=suggested))
    return suggestions


def _collect_session_context(session: str) -> list[dict]:
    """Walk every window of `session`, capture pane + parse_pane + git/gh
    context, return one dict per window matching `build_rename_prompt`'s
    expected shape. Returns `[]` if the session doesn't exist or is empty."""
    srv = tmux.get_server()
    if srv is None:
        return []
    try:
        sess = srv.sessions.get(session_name=session)
    except Exception:  # noqa: BLE001
        return []
    if sess is None:
        return []

    out: list[dict] = []
    for w in sess.windows:
        pane = w.active_pane
        if pane is None:
            continue
        try:
            idx = int(w.window_index or 0)
        except (TypeError, ValueError):
            continue
        ctx = _context_for_pane(
            session=session,
            index=idx,
            window_name=w.window_name or "",
            cwd=pane.pane_current_path or "",
        )
        out.append(ctx)
    return out


def _collect_window_context(session: str, index: int) -> list[dict]:
    pane = tmux.get_pane(session, index)
    if pane is None:
        return []
    # Resolve the window name from the parent session — Pane doesn't carry it.
    srv = tmux.get_server()
    if srv is None:
        return []
    try:
        sess = srv.sessions.get(session_name=session)
    except Exception:  # noqa: BLE001
        return []
    if sess is None:
        return []
    win = next(
        (w for w in sess.windows if _to_int(w.window_index) == index),
        None,
    )
    if win is None:
        return []
    return [
        _context_for_pane(
            session=session,
            index=index,
            window_name=win.window_name or "",
            cwd=pane.pane_current_path or "",
        )
    ]


def _to_int(value: str | int | None, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _context_for_pane(*, session: str, index: int, window_name: str, cwd: str) -> dict:
    """Build the context dict for one window — capture, parse, git/gh,
    snippet shaping. Returns the shape `build_rename_prompt` expects."""
    capture = tmux.capture_pane(session, index, lines=settings.anthropic_capture_lines)
    if capture is None:
        capture = []
    status, pending, agent = claude_parser.parse_pane(capture, cwd)

    # Strip ANSI escapes inline; we don't want to spend tokens on color.
    plain = "\n".join(_ANSI_RE.sub("", line) for line in capture)
    non_empty = [ln for ln in plain.split("\n") if ln.strip()]
    snippet_lines = non_empty[-_SNIPPET_LAST_LINES:]
    snippet = "\n    ".join(snippet_lines)[-_SNIPPET_LAST_CHARS:]

    # branch / pr come from the same cached git helpers parse_pane uses, so
    # we get correct PRs even on shell panes (parse_pane only fills the
    # Agent block for kind=="agent" panes).
    branch = claude_parser._git_branch(cwd)
    # `_gh_pr` returns (number, CI state, html url) — THI-146 added the URL
    # for the clickable PR chip. We only need the number for naming context.
    pr_num, _ci, _pr_url = claude_parser._gh_pr(cwd, branch)

    # parse_pane's `pending` boolean tells us *whether* there's a prompt;
    # `agent.action` is its text (when an agent rendered one). For non-
    # agent panes, no action — keep the field absent.
    pending_text = agent.action if pending and agent and agent.action else None

    return {
        "index": index,
        "current_name": window_name,
        "branch": branch,
        "pr": pr_num,
        "recap": agent.recap if agent else None,
        "pending_input": pending_text,
        "recent_excerpt": snippet,
        "status": status,
    }
