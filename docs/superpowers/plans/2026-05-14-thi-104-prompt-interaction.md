# THI-104 — Interact with Claude Code Prompts From the UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Claude Code agent pane is waiting on an interactive prompt, surface it as a structured choice list inside the terminal modal and let the user answer it with ↑/↓ + Enter (or a mouse click to jump).

**Architecture:** A backend parser (`parse_prompt`) classifies the pane tail into a `menu` / `yn` / `enter` prompt. The `PaneStreamer` — which already feeds the terminal modal's WebSocket — polls for prompt changes and pushes a `{type:"prompt"}` JSON control frame over the *same* WS. `TerminalModal` renders a `PromptOverlay` from those frames; the overlay forwards ↑/↓/Enter live to the pane, so the rendered highlight is an honest mirror of the real pane cursor.

**Tech Stack:** Backend — Python 3.11, FastAPI, Pydantic v2, libtmux, pytest. Frontend — React 18 + TypeScript, Vite, xterm.js, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-14-thi-104-design.md`

---

## File Structure

**Backend**
- `backend/src/switchboard/schemas.py` — *modify*: add `PromptKind`, `PromptChoice`, `Prompt`.
- `backend/src/switchboard/services/claude_parser.py` — *modify*: add `parse_prompt`, `_scan_menu`, `_scan_yn_enter`; refactor `parse_pane` to use `parse_prompt`.
- `backend/src/switchboard/services/tmux.py` — *modify*: add `pane_kind` helper.
- `backend/src/switchboard/services/pane_stream.py` — *modify*: add prompt-poll loop + `_emit_prompt_if_changed`, gated to agent panes.
- `backend/tests/fixtures/claude_menu.txt`, `claude_menu_cursor2.txt`, `claude_menu_redraw.txt` — *create*.
- `backend/tests/test_claude_parser.py` — *modify*: `parse_prompt` cases + backward-compat.
- `backend/tests/test_pane_stream.py` — *create*: `_emit_prompt_if_changed` change/dedup test.

**Frontend**
- `frontend/src/lib/prompt.ts` — *create*: `Prompt`/`PromptChoice` types, `parsePromptMessage`, `arrowSteps`.
- `frontend/src/lib/prompt.test.ts` — *create*.
- `frontend/src/components/PromptOverlay.tsx` — *create*: the overlay component.
- `frontend/src/components/PromptOverlay.test.tsx` — *create*.
- `frontend/src/styles/styles.css` — *modify*: append `.prompt-overlay` styles.
- `frontend/src/components/TerminalModal.tsx` — *modify*: route prompt frames, hold `wsRef`, render overlay, focus management.

`ws.py` is intentionally **not** touched — the agent-pane gate lives inside `PaneStreamer.run()`.

---

## Task 1: `Prompt` / `PromptChoice` schemas

**Files:**
- Modify: `backend/src/switchboard/schemas.py`
- Test: `backend/tests/test_schemas.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_schemas.py`:

```python
from switchboard.schemas import Prompt, PromptChoice


def test_prompt_serializes_to_expected_json() -> None:
    p = Prompt(
        kind="menu",
        question="Do you want to proceed?",
        choices=[
            PromptChoice(index=1, label="Yes", selected=True),
            PromptChoice(index=2, label="No", selected=False),
        ],
    )
    assert p.model_dump(by_alias=True) == {
        "kind": "menu",
        "question": "Do you want to proceed?",
        "choices": [
            {"index": 1, "label": "Yes", "selected": True},
            {"index": 2, "label": "No", "selected": False},
        ],
    }


def test_prompt_defaults_question_and_choices() -> None:
    p = Prompt(kind="enter")
    assert p.question is None
    assert p.choices == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_schemas.py -k prompt -v`
Expected: FAIL with `ImportError: cannot import name 'Prompt'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/switchboard/schemas.py`, add after the `CIState` line (`CIState = Literal[...]`):

```python
PromptKind = Literal["menu", "yn", "enter"]
```

And add these classes after the `Agent` class:

```python
class PromptChoice(_CamelModel):
    index: int  # 1-based, as Claude Code numbers the menu
    label: str
    selected: bool  # the choice currently bearing the ❯ cursor


class Prompt(_CamelModel):
    kind: PromptKind
    question: str | None = None
    choices: list[PromptChoice] = []  # empty for "enter"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_schemas.py -k prompt -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/switchboard/schemas.py backend/tests/test_schemas.py
git commit -m "feat(thi-104): add Prompt/PromptChoice schemas"
```

---

## Task 2: `parse_prompt` — arrow-key menu detection

**Files:**
- Create: `backend/tests/fixtures/claude_menu.txt`
- Create: `backend/tests/fixtures/claude_menu_cursor2.txt`
- Create: `backend/tests/fixtures/claude_menu_redraw.txt`
- Modify: `backend/src/switchboard/services/claude_parser.py`
- Test: `backend/tests/test_claude_parser.py`

- [ ] **Step 1: Create the menu fixtures**

`backend/tests/fixtures/claude_menu.txt` — a permission menu, cursor on choice 1:

```
● I'll remove the build artifacts so the next build is clean.

╭──────────────────────────────────────────────────────────────────────────────╮
│ Bash command                                                                  │
│                                                                                │
│   rm -rf build/                                                                │
│   Remove the build/ directory                                                  │
│                                                                                │
│ Do you want to proceed?                                                        │
│ ❯ 1. Yes                                                                       │
│   2. Yes, and don't ask again for rm commands in this project                  │
│   3. No, and tell Claude what to do differently (esc)                          │
│                                                                                │
╰──────────────────────────────────────────────────────────────────────────────╯
```

`backend/tests/fixtures/claude_menu_cursor2.txt` — same menu, cursor on choice 2:

```
● I'll remove the build artifacts so the next build is clean.

╭──────────────────────────────────────────────────────────────────────────────╮
│ Bash command                                                                  │
│                                                                                │
│   rm -rf build/                                                                │
│   Remove the build/ directory                                                  │
│                                                                                │
│ Do you want to proceed?                                                        │
│   1. Yes                                                                       │
│ ❯ 2. Yes, and don't ask again for rm commands in this project                  │
│   3. No, and tell Claude what to do differently (esc)                          │
│                                                                                │
╰──────────────────────────────────────────────────────────────────────────────╯
```

`backend/tests/fixtures/claude_menu_redraw.txt` — a capture caught mid-redraw: choice `1.` not yet drawn, so the numbering is non-sequential and the menu must be rejected:

```
● I'll remove the build artifacts so the next build is clean.

╭──────────────────────────────────────────────────────────────────────────────╮
│ Do you want to proceed?                                                        │
│   2. Yes, and don't ask again for rm commands in this project                  │
│   3. No, and tell Claude what to do differently (esc)                          │
```

- [ ] **Step 2: Write the failing test**

Append to `backend/tests/test_claude_parser.py`:

```python
def test_parse_prompt_menu_cursor_on_first() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_menu.txt"))
    assert prompt is not None
    assert prompt.kind == "menu"
    assert prompt.question == "Do you want to proceed?"
    assert [c.index for c in prompt.choices] == [1, 2, 3]
    assert [c.label for c in prompt.choices] == [
        "Yes",
        "Yes, and don't ask again for rm commands in this project",
        "No, and tell Claude what to do differently (esc)",
    ]
    assert [c.selected for c in prompt.choices] == [True, False, False]


def test_parse_prompt_menu_cursor_on_second() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_menu_cursor2.txt"))
    assert prompt is not None
    assert prompt.kind == "menu"
    assert [c.selected for c in prompt.choices] == [False, True, False]


def test_parse_prompt_menu_redraw_rejected() -> None:
    # Non-sequential numbering (1. not yet drawn) must not be treated as a menu.
    assert claude_parser.parse_prompt(_load("claude_menu_redraw.txt")) is None


def test_parse_prompt_no_prompt_returns_none() -> None:
    assert claude_parser.parse_prompt(_load("claude_idle.txt")) is None
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_claude_parser.py -k parse_prompt -v`
Expected: FAIL with `AttributeError: module 'switchboard.services.claude_parser' has no attribute 'parse_prompt'`.

- [ ] **Step 4: Write minimal implementation**

In `backend/src/switchboard/services/claude_parser.py`, update the schema import line:

```python
from switchboard.schemas import Agent, CIState, Prompt, PromptChoice, Status
```

Add this regex next to the other module-level regexes (after `_PROMPT_BOX_RE`):

```python
# A menu choice line: optional box-drawing/whitespace prefix, optional ❯/>
# cursor, a 1-2 digit number, a dot, then the label. The trailing box-drawing
# char (if any) is trimmed from the label by the strip in _scan_menu.
_MENU_CHOICE_RE = re.compile(r"^[\s│|┃▏╎]*([❯>])?\s*(\d{1,2})\.\s+(.+?)\s*$")
_BOX_CHARS = " │|┃▏╎─━═\t"
```

Add `_scan_menu` after `_scan_pending`:

```python
def _scan_menu(lines: list[str]) -> Prompt | None:
    """Detect Claude Code's modern numbered arrow-key menu in the recent tail.

    Walks up from the bottom, skipping trailing blank/border lines, and collects
    the contiguous run of numbered choice lines. The run is only accepted as a
    menu when the numbers are sequential starting at 1 — this rejects captures
    caught mid-redraw and stray numbered prose.
    """
    tail = [_strip_ansi(r) for r in lines[-40:]]
    rev: list[tuple[int, str, bool]] = []  # (number, label, selected) bottom-up
    started = False
    first_choice_idx: int | None = None
    for i in range(len(tail) - 1, -1, -1):
        m = _MENU_CHOICE_RE.match(tail[i])
        if m:
            started = True
            cursor, num, label = m.group(1), int(m.group(2)), m.group(3)
            rev.append((num, label.strip(_BOX_CHARS), cursor is not None))
            first_choice_idx = i
        elif started:
            break  # end of the choice run
    if not rev:
        return None
    rev.reverse()
    nums = [n for n, _, _ in rev]
    if nums != list(range(1, len(nums) + 1)):
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
```

Add `parse_prompt` after `_scan_menu`:

```python
def parse_prompt(lines: list[str]) -> Prompt | None:
    """Detect an interactive Claude Code prompt in the recent pane tail.

    Menus take priority over the legacy (y/n)/press-enter patterns because a
    menu can legitimately contain the word "continue" etc. in a choice label.
    """
    menu = _scan_menu(lines)
    if menu is not None:
        return menu
    return None
```

> Note: `parse_prompt` only handles `menu` for now — `yn`/`enter` are wired in Task 3.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_claude_parser.py -k parse_prompt -v`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/src/switchboard/services/claude_parser.py backend/tests/test_claude_parser.py backend/tests/fixtures/claude_menu.txt backend/tests/fixtures/claude_menu_cursor2.txt backend/tests/fixtures/claude_menu_redraw.txt
git commit -m "feat(thi-104): detect Claude Code arrow-key menus in claude_parser"
```

---

## Task 3: `parse_prompt` — (y/n) + press-enter, and `parse_pane` refactor

**Files:**
- Modify: `backend/src/switchboard/services/claude_parser.py`
- Test: `backend/tests/test_claude_parser.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_claude_parser.py`:

```python
def test_parse_prompt_yn() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_waiting.txt"))
    assert prompt is not None
    assert prompt.kind == "yn"
    assert prompt.choices == []
    assert prompt.question is not None
    assert "(y/n)" in prompt.question.lower()


def test_parse_prompt_enter() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_pressenter.txt"))
    assert prompt is not None
    assert prompt.kind == "enter"
    assert prompt.choices == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_claude_parser.py -k "parse_prompt_yn or parse_prompt_enter" -v`
Expected: FAIL — `parse_prompt` returns `None` for these fixtures, so `assert prompt is not None` fails.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/switchboard/services/claude_parser.py`, replace the `_PENDING_PATTERNS` block:

```python
# Pending-input patterns. Must match a recent line (last ~25 lines).
_PENDING_PATTERNS: Final = [
    re.compile(r"\(\s*y\s*/\s*n[a-z/?]*\)", re.IGNORECASE),
    re.compile(r"\[\s*y\s*/\s*n[a-z/?]*\]", re.IGNORECASE),
    re.compile(r"\bpress\s+enter\b", re.IGNORECASE),
    re.compile(r"\bcontinue\?\s*$", re.IGNORECASE),
]
```

with split yn / enter pattern lists:

```python
# Pending-input patterns. Must match a recent line (last ~25 lines).
_YN_PATTERNS: Final = [
    re.compile(r"\(\s*y\s*/\s*n[a-z/?]*\)", re.IGNORECASE),
    re.compile(r"\[\s*y\s*/\s*n[a-z/?]*\]", re.IGNORECASE),
]
_ENTER_PATTERNS: Final = [
    re.compile(r"\bpress\s+enter\b", re.IGNORECASE),
    re.compile(r"\bcontinue\?\s*$", re.IGNORECASE),
]
```

Replace the whole `_scan_pending` function:

```python
def _scan_pending(lines: list[str]) -> tuple[bool, str | None]:
    """Detect a (y/n) / Press Enter prompt in the recent tail."""
    tail = lines[-25:]
    action: str | None = None
    pending = False
    for raw in reversed(tail):
        line = _strip_ansi(raw).rstrip()
        if not line:
            continue
        for pat in _PENDING_PATTERNS:
            if pat.search(line):
                pending = True
                if action is None:
                    action = line.strip(" >")[:_ACTION_CLIP]
                break
        if pending:
            break
    return pending, action
```

with a classifying scanner:

```python
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
```

Update `parse_prompt` to fall through to `_scan_yn_enter`:

```python
def parse_prompt(lines: list[str]) -> Prompt | None:
    """Detect an interactive Claude Code prompt in the recent pane tail.

    Menus take priority over the legacy (y/n)/press-enter patterns because a
    menu can legitimately contain the word "continue" etc. in a choice label.
    """
    menu = _scan_menu(lines)
    if menu is not None:
        return menu
    return _scan_yn_enter(lines)
```

Replace the body of `parse_pane` — the `pending, action = _scan_pending(lines)` line and the lines that depend on it — so the function reads:

```python
def parse_pane(lines: list[str], cwd: str | None) -> tuple[Status, bool, Agent | None]:
    spinner, duration = _scan_spinner(lines)
    recap = _scan_recap(lines)
    prompt = parse_prompt(lines)
    pending = prompt is not None
    action = prompt.question if prompt is not None else None
    # Active spinner overrides pending — Claude is still working.
    if spinner:
        pending = False
        action = None

    branch = _git_branch(cwd)
    pr, ci = _gh_pr(cwd, branch)

    status: Status = "waiting" if pending else ("running" if spinner else "idle")
    agent = Agent(
        branch=branch,
        pr=pr,
        ci=ci,
        spinner=spinner,
        duration=duration,
        recap=recap,
        action=action,
    )
    return status, pending, agent
```

- [ ] **Step 4: Run the full parser test file to verify pass + backward-compat**

Run: `cd backend && uv run pytest tests/test_claude_parser.py -v`
Expected: PASS — the two new tests pass **and** the pre-existing tests still pass (`test_waiting_yn_prompt`, `test_running_with_spinner`, `test_idle_with_recap`, `test_press_enter_prompt_is_waiting`, `test_empty_lines_returns_idle`, `test_duration_parsing`). These are the safety net proving the `parse_pane` refactor preserved behavior.

- [ ] **Step 5: Commit**

```bash
git add backend/src/switchboard/services/claude_parser.py backend/tests/test_claude_parser.py
git commit -m "feat(thi-104): classify (y/n)/press-enter prompts; route parse_pane through parse_prompt"
```

---

## Task 4: PaneStreamer prompt-poll loop (agent-gated)

**Files:**
- Modify: `backend/src/switchboard/services/tmux.py`
- Modify: `backend/src/switchboard/services/pane_stream.py`
- Test: `backend/tests/test_pane_stream.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_pane_stream.py`:

```python
"""Tests for the PaneStreamer prompt-poll integration (THI-104).

`_emit_prompt_if_changed` is the unit worth testing: it parses a capture for a
prompt and sends a {type:"prompt"} control frame only when the prompt changed.
The FIFO/pipe-pane plumbing around it is exercised manually, not here.
"""

import asyncio
import json
from pathlib import Path

from switchboard.services.pane_stream import PaneStreamer

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> list[str]:
    return (FIXTURES / name).read_text().splitlines()


class _FakeWS:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(text)


def test_emit_prompt_if_changed_sends_on_change_then_dedups() -> None:
    async def _run() -> None:
        ws = _FakeWS()
        streamer = PaneStreamer(session="s", index=0, ws=ws)
        menu = _load("claude_menu.txt")

        # First sight of a prompt → one control frame.
        last = await streamer._emit_prompt_if_changed(menu, None)
        assert last is not None
        assert len(ws.sent) == 1
        msg = json.loads(ws.sent[0])
        assert msg["type"] == "prompt"
        assert msg["prompt"]["kind"] == "menu"
        assert [c["selected"] for c in msg["prompt"]["choices"]] == [True, False, False]

        # Unchanged capture → no new frame.
        last = await streamer._emit_prompt_if_changed(menu, last)
        assert len(ws.sent) == 1

        # Cursor moved → a new frame.
        last = await streamer._emit_prompt_if_changed(_load("claude_menu_cursor2.txt"), last)
        assert len(ws.sent) == 2

        # Prompt cleared → a {prompt: null} frame, last_sent back to None.
        last = await streamer._emit_prompt_if_changed(_load("claude_idle.txt"), last)
        assert last is None
        assert len(ws.sent) == 3
        assert json.loads(ws.sent[2])["prompt"] is None

    asyncio.run(_run())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_pane_stream.py -v`
Expected: FAIL with `AttributeError: 'PaneStreamer' object has no attribute '_emit_prompt_if_changed'`.

- [ ] **Step 3: Add the `pane_kind` helper to tmux.py**

In `backend/src/switchboard/services/tmux.py`, add after `get_pane`:

```python
def pane_kind(session: str, index: int) -> Kind | None:
    """Infer the Kind of a window's active pane. None when it can't be found.

    Mirrors get_pane's lookup; used by pane_stream to gate prompt parsing to
    agent panes only (a plain shell can echo "[Y/n]" etc.).
    """
    srv = get_server()
    if srv is None:
        return None
    try:
        sess = srv.sessions.get(session_name=session)
    except Exception:  # noqa: BLE001
        return None
    if sess is None:
        return None
    win = next((w for w in sess.windows if _to_int(w.window_index) == index), None)
    if win is None or win.active_pane is None:
        return None
    return _infer_kind(win.active_pane.pane_current_command or "", win.window_name or "")
```

- [ ] **Step 4: Add the prompt-poll loop to pane_stream.py**

In `backend/src/switchboard/services/pane_stream.py`, update the imports block:

```python
import asyncio
import contextlib
import json
import logging
import os
import tempfile
import uuid
from typing import TYPE_CHECKING

from switchboard.services import claude_parser, tmux
```

Add module-level constants after `log = logging.getLogger(__name__)`:

```python
# Prompt-poll cadence: fast while a prompt is on screen (so the highlight
# tracks live arrow presses), slow otherwise (just watching for one to appear).
_PROMPT_POLL_ACTIVE = 0.15
_PROMPT_POLL_IDLE = 1.0
```

Add these two methods to the `PaneStreamer` class (after `__init__`):

```python
    async def _emit_prompt_if_changed(
        self, lines: list[str], last_sent: str | None
    ) -> str | None:
        """Parse `lines` for a prompt; send a control frame iff it changed.

        `last_sent` is the JSON of the last prompt we sent, or None for "no
        prompt". Returns the new last_sent value.
        """
        prompt = claude_parser.parse_prompt(lines)
        current = prompt.model_dump_json(by_alias=True) if prompt is not None else None
        if current == last_sent:
            return last_sent
        payload = json.loads(current) if current is not None else None
        with contextlib.suppress(Exception):
            await self.ws.send_text(json.dumps({"type": "prompt", "prompt": payload}))
        return current

    async def _prompt_poll_loop(self) -> None:
        """Re-capture the pane on a timer and emit prompt-change control frames."""
        last_sent: str | None = None
        while True:
            interval = _PROMPT_POLL_ACTIVE if last_sent is not None else _PROMPT_POLL_IDLE
            await asyncio.sleep(interval)
            lines = tmux.capture_pane(self.session, self.index, lines=120)
            if lines is None:
                return  # pane gone
            last_sent = await self._emit_prompt_if_changed(lines, last_sent)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_pane_stream.py -v`
Expected: PASS (1 passed).

- [ ] **Step 6: Wire the loop into `run()` and the fallback, gated to agent panes**

In `backend/src/switchboard/services/pane_stream.py`, in `run()`, change the declarations before the `try:` from:

```python
        fd = -1
        pipe_active = False
        try:
```

to:

```python
        fd = -1
        pipe_active = False
        prompt_task: asyncio.Task[None] | None = None
        try:
```

Immediately after `pipe_active = True` inside the `try`, add:

```python
            # Prompt parsing is only meaningful for Claude Code agent panes.
            if tmux.pane_kind(self.session, self.index) == "agent":
                prompt_task = asyncio.create_task(self._prompt_poll_loop())
```

In the `finally:` block of `run()`, add — before the `# Stop tmux writing.` comment:

```python
            # Stop the prompt-poll task.
            if prompt_task is not None:
                prompt_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await prompt_task
```

In `_tail_poll_fallback`, replace the whole method body so it also emits prompt frames (gated the same way):

```python
    async def _tail_poll_fallback(self) -> None:
        """Fallback for hosts where mkfifo is unsupported (e.g. some sandboxes)."""
        parse_prompts = tmux.pane_kind(self.session, self.index) == "agent"
        last: list[str] | None = None
        last_prompt: str | None = None
        while True:
            await asyncio.sleep(0.2)
            current = tmux.capture_pane(self.session, self.index, lines=500)
            if current is None:
                return
            if parse_prompts:
                last_prompt = await self._emit_prompt_if_changed(current, last_prompt)
            if current == last:
                continue
            try:
                await self.ws.send_text("\x1b[2J\x1b[H" + "\r\n".join(current) + "\r\n")
            except Exception:  # noqa: BLE001
                return
            last = current
```

- [ ] **Step 7: Run the full backend test suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS — all tests, including `test_pane_stream.py` and the unchanged route/parser/auth tests.

- [ ] **Step 8: Commit**

```bash
git add backend/src/switchboard/services/tmux.py backend/src/switchboard/services/pane_stream.py backend/tests/test_pane_stream.py
git commit -m "feat(thi-104): stream prompt-change frames from PaneStreamer for agent panes"
```

---

## Task 5: Frontend `lib/prompt.ts` — types + message parsing + arrow math

**Files:**
- Create: `frontend/src/lib/prompt.ts`
- Test: `frontend/src/lib/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { arrowSteps, parsePromptMessage } from "./prompt";

describe("parsePromptMessage", () => {
  it("returns undefined for plain terminal output", () => {
    expect(parsePromptMessage("$ ls -la\r\n")).toBeUndefined();
  });

  it("returns undefined for JSON that is not a prompt control message", () => {
    expect(parsePromptMessage('{"type":"other"}')).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parsePromptMessage('{"type":"prompt"')).toBeUndefined();
  });

  it("returns null when the prompt is cleared", () => {
    expect(parsePromptMessage('{"type":"prompt","prompt":null}')).toBeNull();
  });

  it("returns the Prompt when one is active", () => {
    const raw = JSON.stringify({
      type: "prompt",
      prompt: {
        kind: "menu",
        question: "Proceed?",
        choices: [{ index: 1, label: "Yes", selected: true }],
      },
    });
    const prompt = parsePromptMessage(raw);
    expect(prompt).not.toBeNull();
    expect(prompt).not.toBeUndefined();
    expect(prompt!.kind).toBe("menu");
    expect(prompt!.choices[0].label).toBe("Yes");
  });
});

describe("arrowSteps", () => {
  it("steps Down when the target is below", () => {
    expect(arrowSteps(0, 2)).toEqual(["Down", "Down"]);
  });

  it("steps Up when the target is above", () => {
    expect(arrowSteps(2, 0)).toEqual(["Up", "Up"]);
  });

  it("is a no-op when already on the target", () => {
    expect(arrowSteps(1, 1)).toEqual([]);
  });

  it("is a no-op when the source position is unknown", () => {
    expect(arrowSteps(-1, 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- prompt.test.ts`
Expected: FAIL — cannot resolve `./prompt`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/prompt.ts`:

```ts
export type PromptKind = "menu" | "yn" | "enter";

export interface PromptChoice {
  index: number; // 1-based, as Claude Code numbers the menu
  label: string;
  selected: boolean; // the choice currently bearing the ❯ cursor
}

export interface Prompt {
  kind: PromptKind;
  question: string | null;
  choices: PromptChoice[]; // empty for "enter"
}

/**
 * Parse a server→client WebSocket text frame.
 *  - `undefined` → not a prompt control message (i.e. plain terminal output)
 *  - `null`      → a prompt control message that clears the prompt
 *  - `Prompt`    → a prompt control message with an active prompt
 */
export function parsePromptMessage(raw: string): Prompt | null | undefined {
  if (!raw.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { type?: unknown }).type !== "prompt"
  ) {
    return undefined;
  }
  const prompt = (parsed as { prompt?: unknown }).prompt;
  if (prompt === null || prompt === undefined) return null;
  return prompt as Prompt;
}

/**
 * The sequence of "Up"/"Down" tmux signals to move the menu cursor from
 * `fromIndex` to `toIndex` (0-based positions in the choices array). Returns
 * [] for a no-op move or when the source position is unknown (-1).
 */
export function arrowSteps(fromIndex: number, toIndex: number): ("Up" | "Down")[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];
  const delta = toIndex - fromIndex;
  const dir: "Up" | "Down" = delta > 0 ? "Down" : "Up";
  return Array.from({ length: Math.abs(delta) }, () => dir);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- prompt.test.ts`
Expected: PASS (9 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/prompt.ts frontend/src/lib/prompt.test.ts
git commit -m "feat(thi-104): add prompt types, message parsing, arrow math"
```

---

## Task 6: `PromptOverlay` component

**Files:**
- Create: `frontend/src/components/PromptOverlay.tsx`
- Create: `frontend/src/components/PromptOverlay.test.tsx`
- Modify: `frontend/src/styles/styles.css`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/PromptOverlay.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Prompt } from "../lib/prompt";
import { PromptOverlay } from "./PromptOverlay";

const menu: Prompt = {
  kind: "menu",
  question: "Do you want to proceed?",
  choices: [
    { index: 1, label: "Yes", selected: true },
    { index: 2, label: "No, stop", selected: false },
  ],
};

describe("PromptOverlay — menu", () => {
  it("renders the question and choices", () => {
    render(<PromptOverlay prompt={menu} send={vi.fn()} />);
    expect(screen.getByText("Do you want to proceed?")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("No, stop")).toBeTruthy();
  });

  it("forwards ArrowDown as an Up/Down signal frame", () => {
    const send = vi.fn();
    render(<PromptOverlay prompt={menu} send={send} />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowDown" });
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Down" }));
  });

  it("forwards Enter as an Enter signal frame", () => {
    const send = vi.fn();
    render(<PromptOverlay prompt={menu} send={send} />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "Enter" });
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Enter" }));
  });

  it("clicking a lower choice jumps with arrow signals but does not commit", () => {
    const send = vi.fn();
    render(<PromptOverlay prompt={menu} send={send} />);
    fireEvent.click(screen.getByText("No, stop"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Down" }));
  });
});

describe("PromptOverlay — yn / enter", () => {
  it("yn sends a literal y / n", () => {
    const send = vi.fn();
    const yn: Prompt = { kind: "yn", question: "Investigate? (y/n)", choices: [] };
    render(<PromptOverlay prompt={yn} send={send} />);
    fireEvent.click(screen.getByText("Yes"));
    expect(send).toHaveBeenCalledWith("y");
    fireEvent.click(screen.getByText("No"));
    expect(send).toHaveBeenCalledWith("n");
  });

  it("enter sends an Enter signal frame", () => {
    const send = vi.fn();
    const enter: Prompt = { kind: "enter", question: "Press Enter", choices: [] };
    render(<PromptOverlay prompt={enter} send={send} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Enter" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- PromptOverlay.test.tsx`
Expected: FAIL — cannot resolve `./PromptOverlay`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/PromptOverlay.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { Prompt } from "../lib/prompt";
import { arrowSteps } from "../lib/prompt";

interface Props {
  prompt: Prompt;
  /** Send a raw frame to the pane WS: a `{"signal":...}` JSON string, or literal text. */
  send: (data: string) => void;
}

const signal = (s: string): string => JSON.stringify({ signal: s });

/** ms within which a second Enter is ignored, so mashing can't skip prompts. */
const COMMIT_DEBOUNCE = 300;

export function PromptOverlay({ prompt, send }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastCommit = useRef(0);

  // Take focus so ↑/↓/Enter hit this handler, not xterm underneath.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => {
    const now = Date.now();
    if (now - lastCommit.current < COMMIT_DEBOUNCE) return;
    lastCommit.current = now;
    send(signal("Enter"));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape intentionally falls through so the modal's handler can close it.
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      send(signal("Up"));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      send(signal("Down"));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (prompt.kind === "yn" && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      e.stopPropagation();
      send("y");
    } else if (prompt.kind === "yn" && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      e.stopPropagation();
      send("n");
    }
  };

  const selectedPos = prompt.choices.findIndex((c) => c.selected);

  return (
    <div
      className={`prompt-overlay prompt-${prompt.kind}`}
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="group"
      aria-label="Claude Code prompt"
    >
      {prompt.question && <div className="prompt-q">{prompt.question}</div>}

      {prompt.kind === "menu" && (
        <ul className="prompt-choices" role="listbox" aria-label="Choices">
          {prompt.choices.map((c, pos) => (
            <li
              key={c.index}
              role="option"
              aria-selected={c.selected}
              className={`prompt-choice${c.selected ? " selected" : ""}`}
              onClick={() => {
                for (const s of arrowSteps(selectedPos, pos)) send(signal(s));
              }}
            >
              <span className="prompt-cursor">{c.selected ? "❯" : " "}</span>
              <span className="prompt-num">{c.index}.</span>
              <span className="prompt-label">{c.label}</span>
            </li>
          ))}
        </ul>
      )}

      {prompt.kind === "yn" && (
        <div className="prompt-buttons">
          <button className="btn" onClick={() => send("y")}>
            Yes
          </button>
          <button className="btn" onClick={() => send("n")}>
            No
          </button>
        </div>
      )}

      {prompt.kind === "enter" && (
        <div className="prompt-buttons">
          <button className="btn" onClick={() => send(signal("Enter"))}>
            Continue
          </button>
        </div>
      )}

      <div className="prompt-hint">
        {prompt.kind === "menu"
          ? "↑↓ move · Enter confirm · click to jump"
          : prompt.kind === "yn"
            ? "Press Y or N"
            : "Press Enter"}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- PromptOverlay.test.tsx`
Expected: PASS (5 passed).

- [ ] **Step 5: Add the overlay styles**

Append to `frontend/src/styles/styles.css`:

```css
/* THI-104 — interactive prompt overlay inside the terminal modal. */
.prompt-overlay {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--hairline-strong);
  background: var(--panel-2);
  font-family: var(--font-mono);
  font-size: 12px;
  outline: none;
}
.prompt-overlay:focus-visible { box-shadow: inset 0 0 0 1px var(--accent-edge); }
.prompt-q { color: var(--text); font-weight: 600; }
.prompt-choices { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.prompt-choice {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 3px 6px;
  border-radius: var(--r-sm);
  color: var(--text-mute);
  cursor: pointer;
}
.prompt-choice:hover { background: var(--bg-elev); }
.prompt-choice.selected {
  background: var(--accent-soft);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--accent-edge);
}
.prompt-cursor { width: 1ch; color: var(--accent); }
.prompt-num { color: var(--text-dim); }
.prompt-label { flex: 1; }
.prompt-buttons { display: flex; gap: 8px; }
.prompt-hint { color: var(--text-dim); font-size: 11px; }
```

- [ ] **Step 6: Verify build + styles compile**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript or CSS errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/PromptOverlay.tsx frontend/src/components/PromptOverlay.test.tsx frontend/src/styles/styles.css
git commit -m "feat(thi-104): add PromptOverlay component + styles"
```

---

## Task 7: Wire `PromptOverlay` into `TerminalModal`

**Files:**
- Modify: `frontend/src/components/TerminalModal.tsx`

- [ ] **Step 1: Add imports**

In `frontend/src/components/TerminalModal.tsx`, after the existing component imports (`./Icon`, `./StatusPill`), add:

```tsx
import { PromptOverlay } from "./PromptOverlay";
import { parsePromptMessage } from "../lib/prompt";
import type { Prompt } from "../lib/prompt";
```

- [ ] **Step 2: Add `prompt` state and a `wsRef`**

In the `TerminalModal` component body, just after the existing `const [conn, setConn] = useState<Connection>("connecting");` line, add:

```tsx
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
```

- [ ] **Step 3: Route prompt frames in `ws.onmessage`, store the socket in `wsRef`**

In the construction `useEffect`, inside `if (wsEnabled) {`, replace this block:

```tsx
      ws = openPaneWS(win.session, win.index);
      ws.onopen = () => setConn("live");
      ws.onmessage = (ev) => {
        const data = ev.data;
        if (typeof data === "string") term.write(data);
        else if (data instanceof ArrayBuffer) term.write(new Uint8Array(data));
      };
      ws.onclose = () => setConn("closed");
```

with:

```tsx
      ws = openPaneWS(win.session, win.index);
      wsRef.current = ws;
      ws.onopen = () => setConn("live");
      ws.onmessage = (ev) => {
        const data = ev.data;
        if (typeof data === "string") {
          const parsed = parsePromptMessage(data);
          if (parsed !== undefined) {
            setPrompt(parsed);
            return;
          }
          term.write(data);
        } else if (data instanceof ArrayBuffer) {
          term.write(new Uint8Array(data));
        }
      };
      ws.onclose = () => setConn("closed");
```

- [ ] **Step 4: Clear `wsRef` and `prompt` on teardown**

In the same effect's cleanup function (the `return () => { ... }`), after the `if (ws) { ... }` block and before `term.dispose();`, add:

```tsx
      wsRef.current = null;
      setPrompt(null);
```

- [ ] **Step 5: Add a `sendToPane` callback and a focus-return effect**

After the existing zoom `useEffect` (the one with `[onClose]` deps) and before `const zoomBy = ...`, add:

```tsx
  // Return focus to the terminal when a prompt clears; the overlay grabs focus
  // itself while it is mounted.
  useEffect(() => {
    if (prompt === null) termRef.current?.focus();
  }, [prompt]);

  const sendToPane = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  };
```

- [ ] **Step 6: Render the overlay between `.term-body` and `.term-foot`**

In the JSX, between the `<div className="term-body" ... />` element and `<div className="term-foot">`, add:

```tsx
        {prompt && <PromptOverlay prompt={prompt} send={sendToPane} />}
```

- [ ] **Step 7: Verify build and run the full frontend suite**

Run: `cd frontend && npm run build && npm test`
Expected: build succeeds; all Vitest suites pass (`prompt.test.ts`, `PromptOverlay.test.tsx`, and the pre-existing `cardNav` / `filter` / `urlState` tests).

- [ ] **Step 8: Manual verification against a real Claude Code pane**

Run `./scripts/dev.sh`, open a window card running Claude Code in the terminal modal, and confirm:
- Triggering a permission menu shows the overlay with the choices; the highlight matches the pane's `❯`.
- ↑/↓ move the highlight (with the ~150ms mirror lag); Enter confirms.
- Clicking a lower/upper choice jumps the highlight without committing.
- A `(y/n)` prompt shows Yes/No buttons that work; a `press enter` prompt shows a working Continue button.
- Esc still closes the modal while the overlay is up.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/TerminalModal.tsx
git commit -m "feat(thi-104): render PromptOverlay in the terminal modal"
```

---

## Self-Review

**Spec coverage:**
- *Shared `parse_prompt`* → Task 2 (`_scan_menu`, `parse_prompt`) + Task 3 (`_scan_yn_enter`, `parse_pane` derives `pending` from it). ✓
- *`menu` / `yn` / `enter` kinds* → Task 2 (menu), Task 3 (yn, enter). ✓
- *`Prompt` / `PromptChoice` schema, not on `Agent`/`Window`* → Task 1. ✓
- *WS stream integration, `{type:"prompt"}` on change, initial-snapshot + FIFO-fallback paths* → Task 4 (`_prompt_poll_loop` for the FIFO path, `_tail_poll_fallback` updated; `_emit_prompt_if_changed` dedups). ✓
- *Agent-pane gate* → Task 4 (`tmux.pane_kind` checked in `run()` and `_tail_poll_fallback`). ✓
- *`PromptOverlay` docked between body and footer* → Task 6 + Task 7 Step 6. ✓
- *Per-kind interaction (live ↑/↓, Enter commit + debounce, click-jamp-no-commit, y/n literal, Continue)* → Task 6. ✓
- *Highlight mirrors parsed state* → `selected` flows from `_scan_menu` → schema → WS → overlay; overlay renders `c.selected`, no local prediction. ✓
- *Esc stays "close modal"* → Task 6 (`onKeyDown` lets Escape fall through) + Task 7 (modal's existing Escape handler untouched). ✓
- *Focus management / no double-send* → Task 6 (overlay focuses itself, `stopPropagation` on ↑/↓/Enter) + Task 7 Step 5 (focus returns to terminal on clear). ✓
- *Edge cases: mid-redraw → None; click-jump disabled when selection unknown; non-agent panes; WS reconnect re-emits; commit debounce* → Task 2 (`nums` sequential guard), Task 5 (`arrowSteps` returns `[]` for `-1`), Task 4 (gate; loop starts fresh on each `run()` so reconnect re-emits), Task 6 (`COMMIT_DEBOUNCE`). ✓
- *Tests: menu/cursor2/redraw fixtures, backward-compat, streamer dedup, `arrowSteps`, component* → Tasks 2–6. ✓

**Placeholder scan:** none — every code step contains complete code; every run step has an exact command and expected output.

**Type consistency:** `Prompt`/`PromptChoice` fields (`kind`, `question`, `choices`, `index`, `label`, `selected`) are identical across `schemas.py` (Task 1), `claude_parser.py` (Task 2/3), `prompt.ts` (Task 5), and consumers (Tasks 6/7). `_emit_prompt_if_changed(lines, last_sent) -> str | None` has one signature, used by `_prompt_poll_loop`, `_tail_poll_fallback`, and the Task 4 test. `arrowSteps(fromIndex, toIndex)` and `parsePromptMessage(raw)` signatures match between `prompt.ts` and all callers. The `send: (data: string) => void` prop is consistent between `PromptOverlay` and `TerminalModal`.
