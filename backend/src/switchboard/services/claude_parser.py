"""Heuristic parser for Claude Code agent panes.

Reads the last N captured lines and produces an (status, pending_input, Agent).
- Spinner detection looks for the ✻ / brail-spinner glyph + "...ing…" pattern.
- Pending input is gated on an arrow-key menu, a `(y/n)` / `[y/n]`, or a
  `press enter`-style prompt appearing recently AND no spinner running. Pending
  input and an active spinner are mutually exclusive.
- Recap is the last assistant message (line starting with ●, ⏺, ✻, ✓, ✗
  glyphs — modern Claude Code builds use ⏺ U+23FA where older builds drew
  ● U+25CF).
- Branch / PR are best-effort `git` / `gh` shells; results are cached for 30s.
"""

from __future__ import annotations

import re
import subprocess
import threading
import time
from typing import Final

from switchboard.schemas import Agent, CIState, Prompt, PromptChoice, Status

# THI-188: cache parse_pane output keyed by capture content + cwd.
# parse_pane runs ~5 regex scans per call (`_scan_spinner`, `_scan_recap`,
# `parse_prompt`, `_scan_context_pct`, `_scan_session_cost`, plus
# `_scan_open_question` on the no-structured-prompt branch). With THI-181's
# capture cache returning identical inputs within ~0.5s under modal-open
# polling, a parallel TTL here lets us skip the whole regex pipeline on the
# cache hit. cwd is part of the key because _git_branch(cwd) feeds the result.
_PARSE_CACHE_TTL_S = 0.5
_parse_cache_lock = threading.Lock()
_parse_cache: dict[
    tuple[int, str | None], tuple[float, tuple[Status, bool, Agent | None]]
] = {}


def reset_parse_cache() -> None:
    """Clear the THI-188 parse_pane result cache. Exposed for tests; production
    code does not call this."""
    with _parse_cache_lock:
        _parse_cache.clear()

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

# Context-window percent: three phrasings Claude Code uses across builds.
#   `🧠 █░░░░░░░░░ 16%` — modern status bar (brain emoji + Block Elements bar)
#   `Context: 73% (~144k / 200k tokens)` — text variant on some 5.x builds
#   `(200k context window used: 73%)` — legacy scroll line
# Patterns are tail fragments — the line may have other content (box-drawing,
# ANSI residue, spinner pre) before the marker, so the scanner uses `.search`.
# Brain emoji is U+1F9E0; bar chars live in Block Elements U+2580..U+259F.
_CONTEXT_RE_BRAIN = re.compile(
    r"\U0001F9E0[\s▀-▟]*(\d{1,3})\s*%",
)
_CONTEXT_RE_NEW = re.compile(
    r"Context:\s+(\d{1,3})\s*%",
    re.IGNORECASE,
)
_CONTEXT_RE_OLD = re.compile(
    r"context\s+window\s+used:\s+(\d{1,3})\s*%",
    re.IGNORECASE,
)

# Per-session dollar cost reported by Claude Code's status line, e.g.
#   `📨 6 📤 542 | session: 155.4k in / 542 out 💰 $8.33 🤖 opus …`
# Captured as a float for the running session of THIS pane (THI-139). Summed
# across visible agent panes in the frontend to drive the header pill.
# Comma-separated thousands tolerated for future-proofing (current Claude
# builds don't seem to use them, but the cost can climb high enough that
# they'd be reasonable). 💰 is U+1F4B0.
_SESSION_COST_RE = re.compile(
    r"\U0001F4B0\s*\$([\d,]+(?:\.\d+)?)",
)

# Recap: assistant-message marker, then the message body. ⏺ (U+23FA,
# "BLACK CIRCLE FOR RECORD") is the marker modern Claude Code builds
# render; ● (U+25CF) is the legacy glyph. Both anchor identically.
_RECAP_RE = re.compile(r"^\s*[●⏺✓✗][\s ]+(.+?)\s*$")

# THI-148: free-form question detection. Two complementary triggers on the
# visible last line of Claude's narration.
#  - `_QUESTION_END_RE`: ends with `?` (allow trailing `)`, `]`, `"`, `'`, ws).
#    Covers the bulk of cases — Claude almost always punctuates real questions.
#  - `_ASK_PHRASES_RE`: high-precision imperative-ask phrases that may not
#    end with `?` ("let me know …", "please confirm", "awaiting your …",
#    etc.). Each is anchored with word boundaries so substrings like
#    "knowledge" / "letting" don't false-positive in narration.
_QUESTION_END_RE = re.compile(r"\?[\"')\]\s]*$")
_ASK_PHRASES_RE = re.compile(
    r"\b("
    r"let\s+me\s+know|"
    r"(please|kindly)\s+(confirm|clarify|verify|advise|specify|provide)|"
    r"awaiting\s+(your|further)|"
    r"waiting\s+(for|on)\s+(your|further)|"
    r"your\s+(call|move|turn|choice|preference)|"
    r"up\s+to\s+you"
    r")\b",
    re.IGNORECASE,
)
# Tool-call lines below `●` narration are not assistant prose — skip them
# when scanning for a question (their text often ends with `)` or contains
# `?` inside shell arguments). Covers the built-in Claude Code tools plus
# any MCP-namespaced tool (e.g. `mcp__plugin_linear_linear__list_issues(`).
_TOOL_CALL_RE = re.compile(
    r"^(?:Bash|Read|Write|Edit|MultiEdit|Grep|Glob|Task|TodoWrite"
    r"|WebFetch|WebSearch|NotebookEdit|ExitPlanMode|mcp__)[A-Za-z0-9_]*\("
)

_BORDER_RE = re.compile(r"^[\s─━═]+$")
# Modern Claude Code builds render the prompt arrow as `❯` (U+276F) in some
# themes; the legacy glyph is plain `>`. Both anchor the same input box.
# Kept in sync with `_MENU_CHOICE_RE`'s cursor class, which also accepts both.
_PROMPT_BOX_RE = re.compile(r"^\s*[>❯]")

# A menu choice line: optional box-drawing/whitespace prefix, optional ❯/>
# cursor, a 1-2 digit number, a dot, then the label. The trailing box-drawing
# char (if any) is trimmed from the label by the strip in _scan_menu.
_MENU_CHOICE_RE = re.compile(r"^[\s│|┃▏╎]*([❯>])?\s*(\d{1,2})\.\s+(.+?)\s*$")
_BOX_CHARS = " │|┃▏╎─━═╭╮╰╯\t"

# Input-box footer: the literal `? for shortcuts` hint Claude Code renders
# below the user's input field. Never present below a menu — Claude swaps
# the footer for navigation hints (or hides it) while a menu is active. Used
# in `_scan_menu` to reject numbered lists the user has typed INTO the input
# box (the `>` prompt on the first line otherwise looks like a menu cursor).
_INPUT_FOOTER_RE = re.compile(r"\?\s+for\s+shortcuts", re.IGNORECASE)

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
    off the visible TUI doesn't beat a fresh one. Tolerates the three
    phrasings Claude Code has used over time (see _CONTEXT_RE_* above).
    Values outside 0..100 (corrupt captures, mid-redraw garbage) return None.
    """
    for raw in reversed(lines[-30:]):
        line = _strip_ansi(raw)
        m = (
            _CONTEXT_RE_BRAIN.search(line)
            or _CONTEXT_RE_NEW.search(line)
            or _CONTEXT_RE_OLD.search(line)
        )
        if m:
            pct = int(m.group(1))
            if 0 <= pct <= 100:
                return pct
            # Out-of-range: keep scanning upward; a corrupt tail shouldn't
            # mask a valid older line. (Spec test treats sole 101% as None,
            # which falls through this loop to the final return.)
    return None


def _scan_session_cost(lines: list[str]) -> float | None:
    """Per-session USD cost as reported by Claude Code's status line (THI-139).

    Matches `💰 $X.XX` in the last ~30 lines, bottom-up so a fresh reading
    wins over a stale one that scrolled. Returns the running total for this
    pane's session (the same number Claude shows in its TUI footer); the
    frontend sums these across visible agent panes for the header pill.
    `None` when the line isn't present (fresh session before the first
    billed turn, or a TUI screen that doesn't render the footer).
    """
    for raw in reversed(lines[-30:]):
        line = _strip_ansi(raw)
        m = _SESSION_COST_RE.search(line)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except ValueError:
                # Capture matched the pattern but isn't a parseable number —
                # keep scanning upward in case a cleaner line sits above.
                continue
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
    Code menu always renders a cursor on the selected choice. We also reject
    (c) candidate runs that sit INSIDE the user's input box — when the user
    types `> 1. AAAA / 2. BBB / 3. CCC` into Claude Code's input, the `>`
    prompt indicator satisfies (b) and the structure otherwise looks identical
    to a real menu. The input box is distinguishable by what follows it: a
    horizontal `────` separator (line-style input) or the `? for shortcuts`
    footer hint. Real menus replace the input box and carry neither.
    """
    tail = [_strip_ansi(r) for r in lines[-40:]]
    rev: list[tuple[int, str, bool]] = []  # (number, label, selected) bottom-up
    first_choice_idx: int | None = None
    last_choice_idx: int | None = None  # highest-numbered choice's tail index
    for i in range(len(tail) - 1, -1, -1):
        m = _MENU_CHOICE_RE.match(tail[i])
        if not m:
            continue
        cursor, num, label = m.group(1), int(m.group(2)), m.group(3)
        rev.append((num, label.strip(_BOX_CHARS), cursor is not None))
        if last_choice_idx is None:
            last_choice_idx = i
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
    # Reject if the candidate is the user's input box (see (c) above). Scan a
    # short window below the last choice for the box's bottom separator or
    # the `? for shortcuts` footer; both are exclusive to the input box.
    if last_choice_idx is not None:
        for j in range(last_choice_idx + 1, min(last_choice_idx + 6, len(tail))):
            line = tail[j]
            if not line.strip():
                continue
            if _BORDER_RE.match(line):
                return None
            if _INPUT_FOOTER_RE.search(line):
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


def _scan_open_question(lines: list[str]) -> str | None:
    """Detect a free-form question Claude is asking the user (THI-148).

    Walks the recent tail bottom-up, skipping the prompt box, borders, blank
    lines, tool calls, and tool output (`⎿`). Accumulates the visible
    narration block (the most recent `●`/`✓`/`✗` message and its
    continuation lines) until a tool call, tool output, or another marker
    is hit. Two complementary triggers:

      - The visible last line ends with `?` — Claude asked a question.
        Returned action text is that line.
      - Any line in the block contains a high-precision ask-phrase
        ("let me know", "please confirm", "awaiting your …", …) — Claude
        deferred to the user without a literal question mark. Returned
        action text is the line carrying the phrase.

    Complements `parse_prompt`: structured shapes (menu / yn / enter) are
    handled there. This is only called by `parse_pane` (status / pending /
    action) — open questions deliberately do NOT emit a `Prompt` for the
    WS overlay, since there's no menu/button interaction to render. The
    pending_input flag + `agent.action` text are enough to drive the
    THI-78 native notification and the Kanban "Pending input" badge.
    """
    # Narration always sits ABOVE the prompt box; the TUI footer below it
    # ("? for shortcuts ... Context: N%", session-cost line) is not prose
    # and must not anchor block[0]. Find the most recent prompt-box line
    # and scan only the slice above it. When no prompt box is captured
    # (rare — first frames before the input renders), scan the full tail.
    tail = lines[-30:]
    upper_bound = len(tail)
    for i in range(len(tail) - 1, -1, -1):
        if _PROMPT_BOX_RE.match(_strip_ansi(tail[i]).rstrip()):
            upper_bound = i
            break

    block: list[str] = []  # bottom-up: block[0] is the visible last line
    for raw in reversed(tail[:upper_bound]):
        line = _strip_ansi(raw).rstrip()
        if not line.strip():
            continue
        if _PROMPT_BOX_RE.match(line) or _BORDER_RE.match(line):
            continue
        stripped = line.strip(_BOX_CHARS)
        if not stripped:
            continue
        if stripped.startswith("⎿") or _TOOL_CALL_RE.match(stripped):
            # Tool call / output above this — stop walking; this is the
            # boundary of the current narration block.
            break
        m = _RECAP_RE.match(line)
        if m:
            stripped = m.group(1).strip()
            block.append(stripped)
            break  # `●`/`⏺`/`✓`/`✗` marker anchors the top of the block
        # Claude Code prints `✻ Worked for 2s` / `✻ Churned for 14s`-style
        # turn-timing notes after some turns end — same spinner-glyph family
        # as a live spinner but with no `(N · …)` payload. Metadata, not
        # prose; without skipping them they displace the actual question line
        # as block[0] and the trailing-`?` check misses it. (Active spinners
        # with payload also match here and are skipped — benign, since the
        # spinner override in `parse_pane` clears pending downstream anyway.)
        if _SPINNER_RE.match(line):
            continue
        block.append(stripped)
    if not block:
        return None
    last = block[0]
    if _QUESTION_END_RE.search(last):
        return last[:_ACTION_CLIP]
    # Ask-phrases can appear anywhere in the block; bottom-up scan returns
    # the most recent line carrying the phrase as the action label.
    for candidate in block:
        if _ASK_PHRASES_RE.search(candidate):
            return candidate[:_ACTION_CLIP]
    return None


_BRANCH_CACHE: dict[str, tuple[float, str | None]] = {}
_PR_CACHE: dict[
    tuple[str, str],
    tuple[float, tuple[int | None, CIState | None, str | None]],
] = {}
_REPO_URL_CACHE: dict[str, tuple[float, str | None]] = {}
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
# Repo URL is `git remote get-url origin` + a tiny parse — local, no network,
# and the origin almost never changes. Long TTL is fine. Cached separately
# from `_PR_CACHE` so panes on a branch with no PR still get the URL for the
# in-pane `PR #N` linkifier (THI-146 PR 2).
_REPO_URL_TTL_SECONDS = 300.0


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
        # THI-171 (sec:M8): a branch starting with `-` would be reinterpreted
        # as a flag by downstream tools (e.g. `gh pr view -R evil/repo`). Even
        # though git itself created the name without complaint, refuse to
        # propagate it.
        if branch and branch.startswith("-"):
            branch = None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        branch = None
    _BRANCH_CACHE[cwd] = (now, branch)
    return branch


def _gh_pr(cwd: str | None, branch: str | None) -> tuple[int | None, CIState | None, str | None]:
    if not cwd or not branch:
        return None, None, None
    # THI-171 (sec:M8): defense in depth — _git_branch should already drop
    # `-`-prefixed names, but a future caller could pass one in directly.
    if branch.startswith("-"):
        return None, None, None
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
        #
        # THI-171 (sec:M8): use `--` separator so the branch positional cannot
        # be reinterpreted as a flag even if the leading-`-` check above is
        # ever bypassed. The `--json …` flag stays BEFORE the separator so it's
        # parsed normally.
        out = subprocess.run(
            ["gh", "pr", "view", "--json", "number,statusCheckRollup,url", "--", branch],
            capture_output=True,
            text=True,
            timeout=1.5,
            cwd=cwd,
        )
        if out.returncode != 0:
            _PR_CACHE[key] = (now, (None, None, None))
            return None, None, None
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
        pr_url = data.get("url") or None
        result = (pr_num, ci, pr_url)
    except Exception:  # noqa: BLE001
        result = (None, None, None)
    _PR_CACHE[key] = (now, result)
    return result


def _git_repo_url(cwd: str | None) -> str | None:
    """Normalized https origin URL for the git repo at `cwd`. None when the cwd
    isn't a git checkout, or when the origin isn't a recognizable github host.

    Used by the frontend's in-pane `PR #N` linkifier (THI-146 PR 2) — the
    linkifier opens `${repo_url}/pull/N` in a new tab. Other hosts use
    different PR/MR URL shapes (gitlab `/-/merge_requests/N`, bitbucket
    `/pull-requests/N`), so we restrict to github.com / GHE-style hosts here
    rather than guessing.
    """
    if not cwd:
        return None
    now = time.monotonic()
    cached = _REPO_URL_CACHE.get(cwd)
    if cached and now - cached[0] < _REPO_URL_TTL_SECONDS:
        return cached[1]
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=0.5,
        )
        raw = out.stdout.strip() if out.returncode == 0 else ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        raw = ""

    url = _normalize_git_remote(raw)
    _REPO_URL_CACHE[cwd] = (now, url)
    return url


def _normalize_git_remote(remote: str) -> str | None:
    """`git@github.com:owner/repo.git` / `https://github.com/owner/repo.git`
    → `https://github.com/owner/repo`. Returns None for non-github hosts so
    the in-pane linkifier doesn't construct bogus `/pull/N` URLs against a
    gitlab/bitbucket origin."""
    if not remote:
        return None
    # SSH form: git@host:owner/repo(.git)
    if remote.startswith("git@") and ":" in remote:
        host, _, path = remote[4:].partition(":")
    elif remote.startswith(("https://", "http://", "ssh://", "git://")):
        # https://host/owner/repo(.git) or ssh://git@host/owner/repo(.git)
        scheme, _, rest = remote.partition("://")
        del scheme
        host_path, _, _ = rest.partition("#")
        host, _, path = host_path.partition("/")
        # Strip leading `git@` from ssh://git@host/…
        host = host.split("@")[-1]
    else:
        return None

    # Only github.com (and GHE-style hosts ending in github.com) — guards
    # against constructing nonsense `/pull/N` URLs for gitlab/bitbucket.
    if not (host == "github.com" or host.endswith(".github.com")):
        return None

    path = path.rstrip("/").removesuffix(".git")
    if path.count("/") != 1 or not path:
        return None
    return f"https://{host}/{path}"


def parse_pane(lines: list[str], cwd: str | None) -> tuple[Status, bool, Agent | None]:
    # THI-188: short-TTL cache on (lines-hash, cwd). When THI-181's capture
    # cache returns the same input twice in a row (the modal-open polling
    # pattern), we skip the regex pipeline entirely.
    key = (hash(tuple(lines)), cwd)
    now = time.monotonic()
    with _parse_cache_lock:
        entry = _parse_cache.get(key)
        if entry is not None and now - entry[0] < _PARSE_CACHE_TTL_S:
            return entry[1]

    spinner, duration = _scan_spinner(lines)
    recap = _scan_recap(lines)
    prompt = parse_prompt(lines)
    context_pct = _scan_context_pct(lines)
    session_cost_usd = _scan_session_cost(lines)
    pending = prompt is not None
    action = prompt.question if prompt is not None else None
    # THI-148: free-form questions Claude asks the user (no menu / yn / enter
    # structure) also flip pending. Run only when no structured prompt fired
    # so the structured action text wins when both could match.
    if prompt is None:
        open_question = _scan_open_question(lines)
        if open_question is not None:
            pending = True
            action = open_question
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
        session_cost_usd=session_cost_usd,
    )
    result = (status, pending, agent)
    with _parse_cache_lock:
        _parse_cache[key] = (now, result)
    return result
