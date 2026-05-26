"""Heuristic parser for Claude Code agent panes.

Reads the last N captured lines and produces an (status, pending_input, Agent).
- Spinner detection looks for the ✻ / brail-spinner glyph + "...ing…" pattern.
- Pending input is gated on an arrow-key menu, a `(y/n)` / `[y/n]`, or a
  `press enter`-style prompt appearing recently AND no spinner running. Pending
  input and an active spinner are mutually exclusive.
- Recap is the last assistant message (line starting with ●, ✻, ✓, ✗ glyphs).
- Branch / PR are best-effort `git` / `gh` shells; results are cached for 30s.
"""

from __future__ import annotations

import re
import subprocess
import time
from typing import Final

from switchboard.schemas import Agent, CIState, Prompt, PromptChoice, Status

# Spinner: line starting with one of Claude's spinner glyphs (braille, the
# original ✻●, plus the star/middle-dot family Claude rotates through in
# modern builds: ✽ ✶ ✷ ✸ ✺ ✼ ·). Active vs. done is decided by the trailing
# "(time · tokens · …)" payload below — not by a verb allowlist, which can't
# keep up with Claude's whimsical verb pool (Kneading, Asking, …).
_BRAIL_GLYPHS: Final = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⡿⣟⣯⣷⣾⣽⣻⢿"
_SPINNER_GLYPHS: Final = f"{_BRAIL_GLYPHS}✻●✽✶✷✸✺✼·"
_SPINNER_RE = re.compile(
    rf"^\s*[{_SPINNER_GLYPHS}][\s ]+(.+?)\s*$",
)
# Within a spinner line, peel out the "(X · …)" parenthesized payload
_SPINNER_PAYLOAD_RE = re.compile(r"\(([^)]+)\)")
_DURATION_RE = re.compile(r"\b(\d+\s*[smhd])\b", re.IGNORECASE)

# Pending-input patterns. Must match a recent line (last ~25 lines).
# The trailing `(?=[\s│|┃▏╎]*$)` anchors the marker to the end of the line
# (allowing only whitespace or box-drawing chars after). Without this anchor,
# prose mentioning `[Y/n]` mid-sentence — e.g. a chat message describing the
# feature — was classified as a pending y/n prompt. Real Claude Code prompts
# always render the marker as the last visible content on the question line.
_YN_PATTERNS: Final = [
    re.compile(r"\(\s*y\s*/\s*n[a-z/?]*\)(?=[\s│|┃▏╎]*$)", re.IGNORECASE),
    re.compile(r"\[\s*y\s*/\s*n[a-z/?]*\](?=[\s│|┃▏╎]*$)", re.IGNORECASE),
]
_ENTER_PATTERNS: Final = [
    re.compile(r"\bpress\s+enter\b", re.IGNORECASE),
    re.compile(r"\bcontinue\?\s*$", re.IGNORECASE),
]

# Context-window percent: two phrasings Claude Code uses across recent builds.
# `Context: 73% (~144k / 200k tokens)` (modern 5.x) and
# `(200k context window used: 73%)` (legacy scroll). Patterns are tail fragments
# — the line may have other content (box-drawing, ANSI residue, spinner pre)
# before the marker, so the scanner uses `.search`, not `.match`.
_CONTEXT_RE_NEW = re.compile(
    r"Context:\s+(\d{1,3})\s*%",
    re.IGNORECASE,
)
_CONTEXT_RE_OLD = re.compile(
    r"context\s+window\s+used:\s+(\d{1,3})\s*%",
    re.IGNORECASE,
)

# Recap: assistant-message marker, then the message body.
_RECAP_RE = re.compile(r"^\s*[●✓✗][\s ]+(.+?)\s*$")

_BORDER_RE = re.compile(r"^[\s─━═]+$")
_PROMPT_BOX_RE = re.compile(r"^\s*>")

# A menu choice line: optional box-drawing/whitespace prefix, optional ❯/>
# cursor, a 1-2 digit number, a dot, then the label. The trailing box-drawing
# char (if any) is trimmed from the label by the strip in _scan_menu.
_MENU_CHOICE_RE = re.compile(r"^[\s│|┃▏╎]*([❯>])?\s*(\d{1,2})\.\s+(.+?)\s*$")
_BOX_CHARS = " │|┃▏╎─━═╭╮╰╯\t"

_RECAP_CLIP = 240
_ACTION_CLIP = 160


def _strip_ansi(line: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", line)


def _scan_spinner(lines: list[str]) -> tuple[str | None, str | None]:
    """Find the most recent active-spinner line; return (label, duration).

    Active spinners always carry a `(duration · tokens · …)` payload; lines
    without it are recap markers (`● Done.`) or one-off notes (`✻ Churned for
    14s`) and must not flip status to "running".
    """
    for raw in reversed(lines[-15:]):
        line = _strip_ansi(raw).rstrip()
        m = _SPINNER_RE.match(line)
        if not m:
            continue
        body = m.group(1)
        paren = _SPINNER_PAYLOAD_RE.search(body)
        if paren is None:
            continue
        # Strip the parenthesized payload from the visible label.
        label_match = _SPINNER_PAYLOAD_RE.split(body, maxsplit=1)
        label = (label_match[0] if label_match else body).strip(" …·")
        duration = None
        d = _DURATION_RE.search(paren.group(1))
        if d:
            duration = d.group(1).replace(" ", "").lower()
        return label, duration
    return None, None


def _scan_context_pct(lines: list[str]) -> int | None:
    """Most recent Claude context-window percent, or None if not found.

    Scans the last ~30 lines bottom-up so a stale Context line that scrolled
    off the visible TUI doesn't beat a fresh one. Tolerates both modern
    (`Context: 73%`) and legacy (`context window used: 73%`) phrasings.
    Values outside 0..100 (corrupt captures, mid-redraw garbage) return None.
    """
    for raw in reversed(lines[-30:]):
        line = _strip_ansi(raw)
        m = _CONTEXT_RE_NEW.search(line) or _CONTEXT_RE_OLD.search(line)
        if m:
            pct = int(m.group(1))
            if 0 <= pct <= 100:
                return pct
            # Out-of-range: keep scanning upward; a corrupt tail shouldn't
            # mask a valid older line. (Spec test treats sole 101% as None,
            # which falls through this loop to the final return.)
    return None


def _scan_recap(lines: list[str]) -> str | None:
    """Last ●/✓/✗-prefixed line above any prompt box."""
    in_prompt_box = False
    for raw in reversed(lines):
        line = _strip_ansi(raw).rstrip()
        if _PROMPT_BOX_RE.match(line):
            in_prompt_box = True
            continue
        if _BORDER_RE.match(line):
            continue
        m = _RECAP_RE.match(line)
        if m and (in_prompt_box or not in_prompt_box):
            text = m.group(1).strip()
            return text[:_RECAP_CLIP]
    return None


def _scan_yn_enter(lines: list[str]) -> Prompt | None:
    """Detect a legacy (y/n) or press-enter prompt in the recent tail.

    Scans bottom-up and returns on the first matching line. yn is checked
    before enter within a line so a "(y/n)" wins over a stray "continue?".
    """
    for raw in reversed(lines[-25:]):
        line = _strip_ansi(raw).rstrip()
        if not line:
            continue
        action = line.strip(" >")[:_ACTION_CLIP]
        for pat in _YN_PATTERNS:
            if pat.search(line):
                return Prompt(kind="yn", question=action, choices=[])
        for pat in _ENTER_PATTERNS:
            if pat.search(line):
                return Prompt(kind="enter", question=action, choices=[])
    return None


def _scan_menu(lines: list[str]) -> Prompt | None:
    """Detect Claude Code's modern numbered arrow-key menu in the recent tail.

    Walks up from the bottom, collecting every numbered-choice line within the
    40-line window and stopping once we've recorded choice 1. Non-matching
    lines between choices are skipped — modern menus carry multi-line indented
    descriptions per choice plus a blank-line gap before trailing options like
    "Chat about this", and an earlier strict contiguous-run scan missed all
    but the bottom-most choice.

    The run is only accepted as a menu when (a) the numbers are sequential
    starting at 1 — rejects captures caught mid-redraw — AND (b) at least one
    collected choice carries the `❯` cursor — rejects numbered prose (chat
    messages, README excerpts) that happens to look like a menu. A real Claude
    Code menu always renders a cursor on the selected choice.
    """
    tail = [_strip_ansi(r) for r in lines[-40:]]
    rev: list[tuple[int, str, bool]] = []  # (number, label, selected) bottom-up
    first_choice_idx: int | None = None
    for i in range(len(tail) - 1, -1, -1):
        m = _MENU_CHOICE_RE.match(tail[i])
        if not m:
            continue
        cursor, num, label = m.group(1), int(m.group(2)), m.group(3)
        rev.append((num, label.strip(_BOX_CHARS), cursor is not None))
        first_choice_idx = i
        if num == 1:
            break  # complete run anchored at 1; further matches would be a prior menu
    if not rev:
        return None
    rev.reverse()
    nums = [n for n, _, _ in rev]
    if nums != list(range(1, len(nums) + 1)):
        return None
    if not any(sel for _, _, sel in rev):
        return None
    choices = [PromptChoice(index=n, label=lbl, selected=sel) for n, lbl, sel in rev]
    # At most one selected; if a redraw left two cursors, keep only the last.
    selected_positions = [j for j, c in enumerate(choices) if c.selected]
    for j in selected_positions[:-1]:
        choices[j].selected = False
    # Question: nearest non-empty, non-border line above the first choice.
    question: str | None = None
    if first_choice_idx is not None:
        for j in range(first_choice_idx - 1, -1, -1):
            stripped = tail[j].strip(_BOX_CHARS)
            if not stripped or _BORDER_RE.match(tail[j].strip()):
                continue
            question = stripped[:_ACTION_CLIP]
            break
    return Prompt(kind="menu", question=question, choices=choices)


def parse_prompt(lines: list[str]) -> Prompt | None:
    """Detect an interactive Claude Code prompt in the recent pane tail.

    Menus take priority over the legacy (y/n)/press-enter patterns because a
    menu can legitimately contain the word "continue" etc. in a choice label.
    """
    menu = _scan_menu(lines)
    if menu is not None:
        return menu
    return _scan_yn_enter(lines)


_BRANCH_CACHE: dict[str, tuple[float, str | None]] = {}
_PR_CACHE: dict[tuple[str, str], tuple[float, tuple[int | None, CIState | None]]] = {}
# Branch resolution caches per-cwd; the key doesn't change when the user runs
# `git checkout` from inside the pane, so a long TTL freezes the dashboard
# branch chip until expiry (THI-126). Keep it short — ~one user-noticeable
# beat. With N agent panes polled at 100ms (THI-105), the upper bound on git
# subprocess invocations is N / _BRANCH_TTL_SECONDS per second.
_BRANCH_TTL_SECONDS = 2.0
# PR resolution shells out to `gh` (~1s), and PR state changes far less often
# than branch state. The PR cache also keys on (cwd, branch) so a branch flip
# already invalidates it naturally — staleness here is bounded by gh's RTT,
# not user impatience.
_PR_TTL_SECONDS = 30.0


def _git_branch(cwd: str | None) -> str | None:
    if not cwd:
        return None
    now = time.monotonic()
    cached = _BRANCH_CACHE.get(cwd)
    if cached and now - cached[0] < _BRANCH_TTL_SECONDS:
        return cached[1]
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=0.5,
        )
        branch = out.stdout.strip() if out.returncode == 0 else None
        if branch == "HEAD":
            branch = None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        branch = None
    _BRANCH_CACHE[cwd] = (now, branch)
    return branch


def _gh_pr(cwd: str | None, branch: str | None) -> tuple[int | None, CIState | None]:
    if not cwd or not branch:
        return None, None
    key = (cwd, branch)
    now = time.monotonic()
    cached = _PR_CACHE.get(key)
    if cached and now - cached[0] < _PR_TTL_SECONDS:
        return cached[1]
    try:
        import json

        # NB: `gh pr view` takes the branch as a positional, not via `--head`
        # (a `--head` flag exists on `gh pr list` and `gh pr create`, not here).
        # Earlier we used `--head` and gh exited with "unknown flag", so every
        # call silently cached (None, None) — the modal header chip never got
        # its CI tint. Pin the positional form.
        out = subprocess.run(
            ["gh", "pr", "view", branch, "--json", "number,statusCheckRollup"],
            capture_output=True,
            text=True,
            timeout=1.5,
            cwd=cwd,
        )
        if out.returncode != 0:
            _PR_CACHE[key] = (now, (None, None))
            return None, None
        data = json.loads(out.stdout)
        pr_num = int(data["number"]) if "number" in data else None
        ci: CIState | None = None
        rollup = data.get("statusCheckRollup") or []
        states = {(item.get("conclusion") or item.get("status") or "").upper() for item in rollup}
        if states & {"FAILURE", "TIMED_OUT", "CANCELLED"}:
            ci = "failing"
        elif states & {"IN_PROGRESS", "QUEUED", "PENDING"}:
            ci = "running"
        elif states and states <= {"SUCCESS", "NEUTRAL", "SKIPPED"}:
            ci = "passing"
        result = (pr_num, ci)
    except Exception:  # noqa: BLE001
        result = (None, None)
    _PR_CACHE[key] = (now, result)
    return result


def parse_pane(lines: list[str], cwd: str | None) -> tuple[Status, bool, Agent | None]:
    spinner, duration = _scan_spinner(lines)
    recap = _scan_recap(lines)
    prompt = parse_prompt(lines)
    context_pct = _scan_context_pct(lines)
    pending = prompt is not None
    action = prompt.question if prompt is not None else None
    # Active spinner overrides pending — Claude is still working.
    if spinner:
        pending = False
        action = None

    branch = _git_branch(cwd)

    status: Status = "waiting" if pending else ("running" if spinner else "idle")
    agent = Agent(
        branch=branch,
        spinner=spinner,
        duration=duration,
        recap=recap,
        action=action,
        context_pct=context_pct,
    )
    return status, pending, agent
