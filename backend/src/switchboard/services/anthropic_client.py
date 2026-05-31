"""Thin Anthropic SDK wrapper for the auto-rename modal (THI-67).

The Anthropic SDK is imported lazily inside `get_client()` so the rest of the
backend boots even when the package isn't installed (or when no API key is
set). `/api/auto-rename/*` translates this module's exceptions to 503/401/502.

Mostly ported from periscope's `server.py` (~L875-940) - same prompt
structure, same parse-the-fenced-JSON dance, just split into testable units
and surfaced with explicit exceptions instead of bool tuples.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

from switchboard.config import settings

log = logging.getLogger(__name__)


class AnthropicConfigError(RuntimeError):
    """Raised when the SDK cannot be constructed (no API key configured)."""


class AnthropicResponseError(RuntimeError):
    """Raised when the model's response can't be parsed as the expected
    JSON object. Carries the offending raw text for diagnostic logging."""

    def __init__(self, message: str, raw: str = "") -> None:
        super().__init__(message)
        self.raw = raw


# Haiku 4.5 published pricing (USD per 1M tokens). Conservative estimates —
# update if Anthropic changes the rate card. Used only for the cost preview
# in the modal footer; actual billing is what Anthropic charges.
_HAIKU_INPUT_PER_M = 1.0
_HAIKU_OUTPUT_PER_M = 5.0

# Lazy singleton — constructed on first `complete()` call, NOT at import,
# so missing-key cases stay localized to the auto-rename route.
_client: Any | None = None


def get_client() -> Any:
    """Construct (or return the cached) `anthropic.Anthropic` instance.
    Raises `AnthropicConfigError` if no API key is reachable."""
    global _client
    if _client is not None:
        return _client
    if not settings.anthropic_enabled:
        raise AnthropicConfigError(
            "Anthropic API key not set. Export ANTHROPIC_API_KEY in your "
            "shell (or set SWITCHBOARD_ANTHROPIC_API_KEY) before opening the "
            "auto-rename modal."
        )
    # Import inside the function so a missing `anthropic` install only blows
    # up the auto-rename route, not the whole app.
    from anthropic import Anthropic

    _client = Anthropic(
        api_key=settings.anthropic_api_key
        or None,  # let SDK fall back to ANTHROPIC_API_KEY env var
    )
    return _client


def reset_client_for_tests() -> None:
    """Clear the lazy singleton so a fresh API key takes effect between tests
    (and after a hot SDK swap). Not for production use."""
    global _client
    _client = None


def resolve_key() -> tuple[str | None, Literal["env", "config", "none"]]:
    """Return `(key, source)` where source is `"config"` if the key came from
    `settings.anthropic_api_key`, `"env"` if from the standard
    `ANTHROPIC_API_KEY` env var, or `"none"` if neither is set. Matches the
    same priority order the SDK uses when we hand it our settings."""
    if settings.anthropic_api_key:
        return settings.anthropic_api_key, "config"
    import os

    env = os.environ.get("ANTHROPIC_API_KEY")
    if env:
        return env, "env"
    return None, "none"


def mask_key(key: str) -> str:
    """Short fingerprint for the Settings UI: known prefix (or first 7 chars)
    + `…` + last 4 chars. Never returns the full key — safe to render in any
    UI surface that might end up in a screenshot or shoulder-surf.

    For really short strings (test fixtures, malformed keys) we degrade
    gracefully to `…<last 4>` rather than echoing more than half the key.
    """
    if len(key) <= 12:
        return "…" + key[-4:]
    # Common shape: `sk-ant-api03-XXX…` — 7-char "sk-ant-" prefix is a stable
    # tell that lets the user recognize their own key without us echoing it.
    return key[:7] + "…" + key[-4:]


def estimate_cost(input_tokens: int, output_tokens: int) -> float:
    """Best-effort USD estimate based on Haiku 4.5's published rate card.
    Anthropic's actual charges are what they are; this number is shown in
    the modal as a `~$X.YYYY` so the user sees the rough magnitude."""
    return (
        input_tokens * _HAIKU_INPUT_PER_M / 1_000_000.0
        + output_tokens * _HAIKU_OUTPUT_PER_M / 1_000_000.0
    )


def complete(prompt: str, *, max_tokens: int = 1024) -> tuple[str, int, int]:
    """Single-shot completion. Returns `(text, input_tokens, output_tokens)`.

    Translates SDK exceptions to module-level exceptions the router can
    map to HTTP codes:
      - `AnthropicConfigError` (re-raised) → 503
      - `anthropic.AuthenticationError`    → router maps to 401
      - `anthropic.RateLimitError`         → router maps to 429
      - everything else                    → router 502
    """
    client = get_client()
    msg = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    # Concatenate text blocks. Haiku usually returns just one.
    text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
    usage = getattr(msg, "usage", None)
    in_tok = int(getattr(usage, "input_tokens", 0)) if usage else 0
    out_tok = int(getattr(usage, "output_tokens", 0)) if usage else 0
    return text, in_tok, out_tok


# --- prompt building / response parsing -----------------------------------


def build_rename_prompt(windows: list[dict[str, Any]]) -> str:
    """Render the rename-windows prompt. Ports periscope's L906 verbatim in
    structure; carries whatever optional fields each window dict provides
    (branch / pr / recap / pending_input / recent_excerpt)."""
    lines = [
        "You are renaming tmux windows in a senior developer's terminal session.",
        "",
        "For each window below, suggest a SHORT descriptive name that captures what",
        "is currently happening in that window. Constraints:",
        "  - 1-3 words, lowercase-with-dashes preferred (e.g. 'fs-build', 'cohort-inv')",
        "  - Max 25 characters",
        "  - Concept-focused, not generic. Bad: 'claude', 'shell', 'zsh', 'work'.",
        "    Good: 'postcode-ingestion', 'monitoring-cert', 'rust-port'",
        "  - If the existing name is still accurate, KEEP IT (don't change just to change)",
        "",
        "Windows in this session:",
    ]
    for w in windows:
        lines.append("")
        lines.append(f"[index {w['index']}] current_name='{w['current_name']}'")
        if w.get("branch"):
            pr = f", PR #{w['pr']}" if w.get("pr") else ""
            lines.append(f"  branch: {w['branch']}{pr}")
        if w.get("recap"):
            lines.append(f"  recap: {str(w['recap'])[:300]}")
        if w.get("pending_input"):
            lines.append(f"  pending input: {str(w['pending_input'])[:120]}")
        snippet = w.get("recent_excerpt", "")
        if snippet:
            lines.append(f"  recent terminal excerpt:\n    {snippet}")
    lines.append("")
    lines.append(
        "Return ONLY a JSON object mapping window index (as a string) to the new name. "
        'Example: {"1": "fs-build", "2": "cohort-inv"}. '
        "No markdown fences, no commentary, just the JSON object."
    )
    return "\n".join(lines)


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", flags=re.MULTILINE)


def parse_rename_response(text: str) -> dict[str, str]:
    """Strip an optional ```json fence and parse to a `{index_str: new_name}`
    dict. Raises `AnthropicResponseError` on invalid JSON, carrying the first
    500 chars of the raw response for the logs.

    Tolerates: leading/trailing whitespace, code fences with or without the
    `json` hint, surrounding commentary the model sometimes ignores the
    "no commentary" instruction to add.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = _FENCE_RE.sub("", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise AnthropicResponseError(f"model returned invalid JSON: {e}", raw=text) from e
    if not isinstance(parsed, dict):
        raise AnthropicResponseError(
            f"model returned non-object JSON: {type(parsed).__name__}", raw=text
        )
    # Coerce values to strings — the model sometimes returns numbers or null
    # for "keep as-is" instead of the existing string name. Cheaper to fix
    # here than in the router.
    return {str(k): str(v) if v is not None else "" for k, v in parsed.items()}
