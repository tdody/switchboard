# THI-116 — Robust terminal input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `tmux send-keys -l` with a stdin-based `load-buffer`/`paste-buffer` delivery path, add clipboard-image paste into Claude Code agent panes, and add Cmd-combo line-editing plus a single-Esc-to-pane / double-Esc-to-close model in the terminal modal.

**Architecture:** A new `tmux.deliver_text` primitive pipes literal text to a pane on **stdin**, so tmux's command parser never sees it as an argv element — fixing the parser silently dropping a standalone `;` and stripping newlines. `send_keys` routes its `paste` branch through it; `/api/send` opts into bracketed paste; a new `/api/paste-image` endpoint writes a temp file and bracket-pastes the `@path`. The frontend gains a pure `lib/termKeys.ts` key-mapping module, a `client.pasteImage` helper, and `TerminalModal` wiring (a `wsRef`, an image-paste listener, and a rewritten keydown handler).

**Tech Stack:** Backend — Python 3.11, FastAPI, libtmux, pytest. Frontend — React 18 + TypeScript, Vite, xterm.js, Vitest (happy-dom).

**Spec:** `docs/superpowers/specs/2026-05-14-thi-116-design.md`

---

## File Structure

**Backend**
- `backend/src/switchboard/services/tmux.py` — *modify*: add `deliver_text`, `pane_kind`; refactor `send_keys` to route `paste` through `deliver_text` and accept `bracketed`.
- `backend/src/switchboard/config.py` — *modify*: add `paste_image_max_bytes`.
- `backend/src/switchboard/routers/actions.py` — *modify*: `/api/send` passes `bracketed=True`; add `POST /api/paste-image` + temp-file helpers.
- `backend/tests/test_tmux.py` — *modify*: `deliver_text`, `send_keys` refactor, `pane_kind` tests.
- `backend/tests/test_actions.py` — *modify*: `/api/send` bracketed test, `/api/paste-image` tests.

**Frontend**
- `frontend/src/lib/termKeys.ts` — *create*: `escAction`, `comboBytes` — pure, unit-testable key logic.
- `frontend/src/lib/termKeys.test.ts` — *create*.
- `frontend/src/api/client.ts` — *modify*: add `pasteImage`.
- `frontend/src/api/client.test.ts` — *create*.
- `frontend/src/components/TerminalModal.tsx` — *modify*: `wsRef`, double-Esc + Cmd-combos, image-paste listener, `onToast` prop.
- `frontend/src/App.tsx` — *modify*: rename `killToast` → `messageToast`, pass it as `TerminalModal`'s `onToast`.

`ws.py` is intentionally **not** touched — its `send_keys(paste=msg)` call inherits the fix and stays a transparent (non-bracketed) passthrough.

---

## Task 1: `tmux.deliver_text` — stdin-based buffer paste

**Files:**
- Modify: `backend/src/switchboard/services/tmux.py`
- Test: `backend/tests/test_tmux.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_tmux.py` (and add the two imports at the top of the file — `from types import SimpleNamespace` and `from switchboard.services import tmux`):

```python
def test_deliver_text_pipes_text_on_stdin(monkeypatch) -> None:
    calls = []

    def fake_run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(tmux.subprocess, "run", fake_run)
    assert tmux.deliver_text("dev", 1, "a;b\nc", bracketed=False) is True

    load_args, load_kwargs = calls[0]
    assert load_args[:3] == ["tmux", "load-buffer", "-b"]
    assert load_args[4] == "-"  # text comes from stdin, never as an argv element
    assert load_kwargs["input"] == "a;b\nc"  # the `;` and newline survive intact

    paste_args, _ = calls[1]
    assert paste_args[:4] == ["tmux", "paste-buffer", "-d", "-b"]
    assert paste_args[4] == load_args[3]  # same buffer name
    assert paste_args[5:] == ["-t", "dev:1"]
    assert "-p" not in paste_args  # not bracketed


def test_deliver_text_bracketed_adds_dash_p(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(
        tmux.subprocess,
        "run",
        lambda args, **kw: calls.append(args)
        or SimpleNamespace(returncode=0, stdout=b"", stderr=b""),
    )
    assert tmux.deliver_text("dev", 1, "x", bracketed=True) is True
    assert calls[1][:4] == ["tmux", "paste-buffer", "-d", "-p"]


def test_deliver_text_false_when_paste_buffer_fails(monkeypatch) -> None:
    def fake_run(args, **kw):
        rc = 0 if "load-buffer" in args else 1
        return SimpleNamespace(returncode=rc, stdout=b"", stderr=b"")

    monkeypatch.setattr(tmux.subprocess, "run", fake_run)
    assert tmux.deliver_text("dev", 1, "x", bracketed=False) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_tmux.py -k deliver_text -v`
Expected: FAIL with `AttributeError: module 'switchboard.services.tmux' has no attribute 'deliver_text'` (and `tmux.subprocess` does not exist yet).

- [ ] **Step 3: Write minimal implementation**

In `backend/src/switchboard/services/tmux.py`, update the import block at the top of the file from:

```python
from __future__ import annotations

import libtmux
```

to:

```python
from __future__ import annotations

import subprocess
import uuid

import libtmux
```

Then add `deliver_text` immediately after the `capture_pane` function:

```python
def deliver_text(session: str, index: int, text: str, *, bracketed: bool) -> bool:
    """Deliver literal text to a pane via tmux load-buffer + paste-buffer.

    The text enters tmux on stdin (`load-buffer ... -`), so tmux's command
    parser never sees it as an argv element. This is what fixes `send-keys -l`
    silently dropping a standalone `;` (tmux treats a bare `;` arg as a command
    separator) and stripping embedded newlines.

    `bracketed` adds `-p`, wrapping the paste in bracketed-paste markers so a
    multi-line block's newlines don't each submit — the caller sends an explicit
    Enter afterward.
    """
    target = f"{session}:{index}"
    buf = f"sb-in-{uuid.uuid4().hex[:8]}"
    paste_args = ["tmux", "paste-buffer", "-d"]
    if bracketed:
        paste_args.append("-p")
    paste_args += ["-b", buf, "-t", target]
    try:
        load = subprocess.run(
            ["tmux", "load-buffer", "-b", buf, "-"],
            input=text,
            text=True,
            capture_output=True,
            timeout=5,
        )
        if load.returncode != 0:
            return False
        paste = subprocess.run(paste_args, capture_output=True, timeout=5)
        return paste.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_tmux.py -k deliver_text -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/switchboard/services/tmux.py backend/tests/test_tmux.py
git commit -m "feat(thi-116): add tmux.deliver_text — stdin-based buffer paste"
```

---

## Task 2: Refactor `tmux.send_keys` to route through `deliver_text`

**Files:**
- Modify: `backend/src/switchboard/services/tmux.py`
- Test: `backend/tests/test_tmux.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_tmux.py`:

```python
def test_send_keys_paste_routes_through_deliver_text(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    seen = []
    monkeypatch.setattr(
        tmux,
        "deliver_text",
        lambda s, i, text, *, bracketed: seen.append((s, i, text, bracketed)) or True,
    )
    assert tmux.send_keys("dev", 1, paste="a;b", bracketed=True) is True
    assert seen == [("dev", 1, "a;b", True)]


def test_send_keys_sleeps_between_paste_and_keys(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    cmds = []
    monkeypatch.setattr(
        tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: cmds.append(a))
    )
    monkeypatch.setattr(tmux, "deliver_text", lambda *a, **k: True)
    slept = []
    monkeypatch.setattr(tmux.time, "sleep", lambda s: slept.append(s))
    assert tmux.send_keys("dev", 1, paste="x", keys=["Enter"]) is True
    assert slept == [0.10]
    assert cmds == [("send-keys", "-t", "dev:1", "Enter")]


def test_send_keys_keys_only_skips_deliver_and_sleep(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    slept = []
    monkeypatch.setattr(tmux.time, "sleep", lambda s: slept.append(s))

    def _explode(*a, **k):
        raise AssertionError("deliver_text should not be called for keys-only")

    monkeypatch.setattr(tmux, "deliver_text", _explode)
    assert tmux.send_keys("dev", 1, keys=["C-c"]) is True
    assert slept == []


def test_send_keys_false_when_deliver_text_fails(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_pane", lambda s, i: object())
    monkeypatch.setattr(tmux, "get_server", lambda: SimpleNamespace(cmd=lambda *a: None))
    monkeypatch.setattr(tmux, "deliver_text", lambda *a, **k: False)
    assert tmux.send_keys("dev", 1, paste="x") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_tmux.py -k send_keys -v`
Expected: FAIL — `send_keys` has no `bracketed` parameter (`TypeError: send_keys() got an unexpected keyword argument 'bracketed'`), and `tmux.time` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/switchboard/services/tmux.py`, add `time` to the stdlib import block so it reads:

```python
from __future__ import annotations

import subprocess
import time
import uuid

import libtmux
```

Then replace the entire `send_keys` function with:

```python
def send_keys(
    session: str,
    index: int,
    *,
    keys: list[str] | None = None,
    paste: str | None = None,
    bracketed: bool = False,
) -> bool:
    pane = get_pane(session, index)
    if pane is None:
        return False
    target = f"{session}:{index}"
    srv = get_server()
    if srv is None:
        return False
    try:
        if paste is not None:
            # Literal text goes through deliver_text (load-buffer/paste-buffer)
            # rather than `send-keys -l`, which silently drops a standalone `;`.
            if not deliver_text(session, index, paste, bracketed=bracketed):
                return False
            if keys:
                # Grace so a TUI applies the pasted block before Enter lands.
                time.sleep(0.10)
        if keys:
            for key in keys:
                srv.cmd("send-keys", "-t", target, key)  # ty: ignore
        return True
    except Exception:  # noqa: BLE001
        return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_tmux.py -k send_keys -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/switchboard/services/tmux.py backend/tests/test_tmux.py
git commit -m "feat(thi-116): route send_keys paste through deliver_text + grace delay"
```

---

## Task 3: `tmux.pane_kind` — agent-pane gate helper

**Files:**
- Modify: `backend/src/switchboard/services/tmux.py`
- Test: `backend/tests/test_tmux.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_tmux.py`:

```python
def _fake_server_with_pane(cmd: str, window_name: str, index: str = "1"):
    pane = SimpleNamespace(pane_current_command=cmd)
    win = SimpleNamespace(window_index=index, window_name=window_name, active_pane=pane)
    sess = SimpleNamespace(windows=[win])
    return SimpleNamespace(sessions=SimpleNamespace(get=lambda session_name: sess))


def test_pane_kind_returns_agent_for_claude_pane(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: _fake_server_with_pane("claude", "main"))
    assert tmux.pane_kind("dev", 1) == "agent"


def test_pane_kind_returns_shell_for_plain_pane(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: _fake_server_with_pane("zsh", "main"))
    assert tmux.pane_kind("dev", 1) == "shell"


def test_pane_kind_none_when_window_missing(monkeypatch) -> None:
    empty = SimpleNamespace(sessions=SimpleNamespace(get=lambda session_name: SimpleNamespace(windows=[])))
    monkeypatch.setattr(tmux, "get_server", lambda: empty)
    assert tmux.pane_kind("dev", 1) is None


def test_pane_kind_none_when_no_server(monkeypatch) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: None)
    assert tmux.pane_kind("dev", 1) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_tmux.py -k pane_kind -v`
Expected: FAIL with `AttributeError: module 'switchboard.services.tmux' has no attribute 'pane_kind'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/switchboard/services/tmux.py`, add `pane_kind` immediately after `get_pane`:

```python
def pane_kind(session: str, index: int) -> Kind | None:
    """Infer the Kind of a window's active pane; None when it can't be found.

    Mirrors get_pane's lookup but returns the inferred Kind. Used to gate
    /api/paste-image to agent panes (a plain shell can't use the @path syntax).
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

> Note: THI-104's implementation plan introduces an identical `pane_kind`. Whichever ticket lands second deletes its copy — the definitions match exactly, so the conflict is trivial.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_tmux.py -k pane_kind -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/switchboard/services/tmux.py backend/tests/test_tmux.py
git commit -m "feat(thi-116): add tmux.pane_kind agent-pane gate helper"
```

---

## Task 4: `/api/send` opts into bracketed paste

**Files:**
- Modify: `backend/src/switchboard/routers/actions.py`
- Test: `backend/tests/test_actions.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_actions.py`:

```python
def test_post_send_uses_bracketed_paste(client: TestClient, monkeypatch) -> None:
    seen: dict = {}

    def fake_send_keys(session, index, *, keys=None, paste=None, bracketed=False):
        seen.update(
            session=session, index=index, keys=keys, paste=paste, bracketed=bracketed
        )
        return True

    monkeypatch.setattr("switchboard.services.tmux.send_keys", fake_send_keys)
    r = client.post(
        "/api/send?session=dev&index=1",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"paste": "echo a;b", "keys": ["Enter"]},
    )
    assert r.status_code == 200
    assert seen["bracketed"] is True
    assert seen["paste"] == "echo a;b"
    assert seen["keys"] == ["Enter"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_actions.py -k post_send -v`
Expected: FAIL — `seen["bracketed"]` is `False` (the route does not pass `bracketed=True` yet).

- [ ] **Step 3: Write minimal implementation**

In `backend/src/switchboard/routers/actions.py`, replace the `post_send` body:

```python
@router.post("/send")
def post_send(session: str, index: int, body: SendBody) -> dict[str, bool]:
    # Command-palette text is always a typed block — bracket the paste so
    # embedded newlines don't each submit; the trailing keys (Enter) submit once.
    ok = tmux.send_keys(
        session, index, keys=body.keys, paste=body.paste, bracketed=True
    )
    if not ok:
        raise HTTPException(status_code=404, detail="pane not found")
    return {"ok": True}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_actions.py -k post_send -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/switchboard/routers/actions.py backend/tests/test_actions.py
git commit -m "feat(thi-116): /api/send opts into bracketed paste"
```

---

## Task 5: `POST /api/paste-image` endpoint + config cap

**Files:**
- Modify: `backend/src/switchboard/config.py`
- Modify: `backend/src/switchboard/routers/actions.py`
- Test: `backend/tests/test_actions.py`

- [ ] **Step 1: Write the failing tests**

At the top of `backend/tests/test_actions.py`, add `from pathlib import Path` to the imports. Then append:

```python
# The endpoint validates the Content-Type header and the byte length, not PNG
# structure — arbitrary bytes with an image/* content type are sufficient here.
FAKE_IMAGE = b"\x89PNG\r\n\x1a\n" + b"fake-image-data" * 8  # ~128 bytes


def test_paste_image_requires_csrf(client: TestClient) -> None:
    r = client.post(
        "/api/paste-image?session=x&index=0",
        content=FAKE_IMAGE,
        headers={"content-type": "image/png"},
    )
    assert r.status_code == 403


def test_paste_image_415_on_non_image(client: TestClient) -> None:
    r = client.post(
        "/api/paste-image?session=x&index=0",
        content=b"hello",
        headers={**_csrf(client), "content-type": "text/plain"},
    )
    assert r.status_code == 415


def test_paste_image_413_over_size_cap(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "paste_image_max_bytes", 16)
    r = client.post(
        "/api/paste-image?session=x&index=0",
        content=FAKE_IMAGE,
        headers={**_csrf(client), "content-type": "image/png"},
    )
    assert r.status_code == 413


def test_paste_image_404_on_missing_pane(client: TestClient) -> None:
    r = client.post(
        "/api/paste-image?session=__nope__&index=0",
        content=FAKE_IMAGE,
        headers={**_csrf(client), "content-type": "image/png"},
    )
    assert r.status_code == 404


def test_paste_image_409_on_non_agent_pane(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.pane_kind", lambda s, i: "shell")
    r = client.post(
        "/api/paste-image?session=dev&index=0",
        content=FAKE_IMAGE,
        headers={**_csrf(client), "content-type": "image/png"},
    )
    assert r.status_code == 409


def test_paste_image_ok_on_agent_pane(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.pane_kind", lambda s, i: "agent")
    delivered: list = []
    monkeypatch.setattr(
        "switchboard.services.tmux.deliver_text",
        lambda s, i, text, *, bracketed: delivered.append((s, i, text, bracketed))
        or True,
    )
    r = client.post(
        "/api/paste-image?session=dev&index=0",
        content=FAKE_IMAGE,
        headers={**_csrf(client), "content-type": "image/png"},
    )
    assert r.status_code == 200
    payload = r.json()
    assert payload["ok"] is True
    assert payload["bytes"] == len(FAKE_IMAGE)
    # the @path reference was bracket-pasted into the pane
    assert delivered and delivered[0][3] is True
    assert delivered[0][2].startswith("@") and delivered[0][2].endswith(" ")
    # clean up the temp file the endpoint wrote
    Path(payload["path"]).unlink(missing_ok=True)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_actions.py -k paste_image -v`
Expected: FAIL — every case returns 404/405 because the `/api/paste-image` route does not exist (and `settings.paste_image_max_bytes` is undefined).

- [ ] **Step 3: Add the config cap**

In `backend/src/switchboard/config.py`, add a field to `Settings` directly after `pane_capture_lines: int = 200`:

```python
    paste_image_max_bytes: int = 10 * 1024 * 1024  # 10 MiB cap on /api/paste-image
```

- [ ] **Step 4: Add the endpoint + helpers**

In `backend/src/switchboard/routers/actions.py`, replace the import block at the top of the file:

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from switchboard.services import tmux
```

with:

```python
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from switchboard.config import settings
from switchboard.services import tmux
```

Then append to the end of `backend/src/switchboard/routers/actions.py`:

```python
# --- image paste ------------------------------------------------------------

_PASTE_PREFIX = "switchboard-paste-"
_PASTE_MAX_AGE_S = 3600
_EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


def _sweep_old_paste_images() -> None:
    """Delete switchboard-paste-* temp files older than _PASTE_MAX_AGE_S."""
    cutoff = time.time() - _PASTE_MAX_AGE_S
    for path in Path(tempfile.gettempdir()).glob(f"{_PASTE_PREFIX}*"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            continue


@router.post("/paste-image")
async def post_paste_image(
    session: str, index: int, request: Request
) -> dict[str, object]:
    """Accept a clipboard image and bracket-paste its @path into an agent pane."""
    mime = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    ext = _EXT_BY_MIME.get(mime)
    if ext is None:
        raise HTTPException(status_code=415, detail="unsupported image type")
    body = await request.body()
    if len(body) > settings.paste_image_max_bytes:
        raise HTTPException(status_code=413, detail="image too large")
    kind = tmux.pane_kind(session, index)
    if kind is None:
        raise HTTPException(status_code=404, detail="pane not found")
    if kind != "agent":
        raise HTTPException(
            status_code=409, detail="image paste is only supported for agent panes"
        )
    _sweep_old_paste_images()
    path = Path(tempfile.gettempdir()) / f"{_PASTE_PREFIX}{uuid.uuid4().hex}.{ext}"
    path.write_bytes(body)
    # Claude Code's file-attach syntax: `@<path> ` (trailing space).
    if not tmux.deliver_text(session, index, f"@{path} ", bracketed=True):
        raise HTTPException(status_code=404, detail="pane not found")
    return {"ok": True, "path": str(path), "bytes": len(body)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_actions.py -k paste_image -v`
Expected: PASS (6 passed).

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS — all tests, including the unchanged parser/auth/schema/logconfig suites.

- [ ] **Step 7: Commit**

```bash
git add backend/src/switchboard/config.py backend/src/switchboard/routers/actions.py backend/tests/test_actions.py
git commit -m "feat(thi-116): add POST /api/paste-image for agent-pane image paste"
```

---

## Task 6: Frontend `lib/termKeys.ts` — Esc + Cmd-combo logic

**Files:**
- Create: `frontend/src/lib/termKeys.ts`
- Test: `frontend/src/lib/termKeys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/termKeys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { comboBytes, escAction } from "./termKeys";

describe("escAction", () => {
  it("returns 'send' for the first Esc (no prior press)", () => {
    expect(escAction(1_000_000, 0)).toBe("send");
  });

  it("returns 'close' for a second Esc within 400ms", () => {
    expect(escAction(1_000_300, 1_000_000)).toBe("close");
  });

  it("returns 'send' for a second Esc after 400ms", () => {
    expect(escAction(1_000_500, 1_000_000)).toBe("send");
  });
});

describe("comboBytes", () => {
  it("maps Cmd+Backspace to Ctrl-U", () => {
    expect(comboBytes({ metaKey: true, key: "Backspace" })).toBe("\x15");
  });

  it("maps Cmd+Delete to Ctrl-K", () => {
    expect(comboBytes({ metaKey: true, key: "Delete" })).toBe("\x0b");
  });

  it("maps Cmd+ArrowLeft / ArrowRight to Ctrl-A / Ctrl-E", () => {
    expect(comboBytes({ metaKey: true, key: "ArrowLeft" })).toBe("\x01");
    expect(comboBytes({ metaKey: true, key: "ArrowRight" })).toBe("\x05");
  });

  it("returns null without the meta key", () => {
    expect(comboBytes({ metaKey: false, key: "Backspace" })).toBeNull();
  });

  it("returns null for unrelated combos", () => {
    expect(comboBytes({ metaKey: true, key: "c" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- termKeys`
Expected: FAIL — cannot resolve `./termKeys`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/termKeys.ts`:

```ts
/** Window (ms) within which a second Esc closes the modal instead of being
 *  forwarded to the pane. */
const DOUBLE_ESC_MS = 400;

/**
 * Decide what an Esc keypress should do. `"close"` when it falls within
 * DOUBLE_ESC_MS of the previous Esc (a deliberate double-press); otherwise
 * `"send"` — forward a literal Esc to the pane. A `lastEsc` of 0 (no prior
 * press) always yields `"send"`.
 */
export function escAction(now: number, lastEsc: number): "send" | "close" {
  return now - lastEsc <= DOUBLE_ESC_MS ? "close" : "send";
}

/**
 * Map a Cmd-combo to the control bytes to forward to the pane, or `null` when
 * the event is not a handled combo. Accepts a structural subset of
 * KeyboardEvent so it is trivially unit-testable.
 */
export function comboBytes(e: { metaKey: boolean; key: string }): string | null {
  if (!e.metaKey) return null;
  switch (e.key) {
    case "Backspace":
      return "\x15"; // Ctrl-U — kill line backward
    case "Delete":
      return "\x0b"; // Ctrl-K — kill line forward
    case "ArrowLeft":
      return "\x01"; // Ctrl-A — line start
    case "ArrowRight":
      return "\x05"; // Ctrl-E — line end
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- termKeys`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/termKeys.ts frontend/src/lib/termKeys.test.ts
git commit -m "feat(thi-116): add termKeys lib — Esc + Cmd-combo key logic"
```

---

## Task 7: Frontend `client.pasteImage`

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { pasteImage } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "sb_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

describe("pasteImage", () => {
  it("POSTs the blob with its content-type and the CSRF header", async () => {
    document.cookie = "sb_csrf=tok-123";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const ok = await pasteImage("dev", 2, blob);

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/paste-image?session=dev&index=2");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("image/png");
    expect(init.headers["x-csrf-token"]).toBe("tok-123");
    expect(init.body).toBe(blob);
  });

  it("resolves false on a non-2xx response", async () => {
    document.cookie = "sb_csrf=tok-123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    expect(await pasteImage("dev", 2, blob)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- client`
Expected: FAIL — `pasteImage` is not exported from `./client`.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/api/client.ts`, add `pasteImage` immediately after `sendKeys`:

```ts
/** Upload a clipboard image to a Claude Code agent pane. Resolves false on any
 *  non-2xx (415 unsupported type / 413 too large / 409 non-agent / 404). */
export async function pasteImage(
  session: string,
  index: number,
  blob: Blob,
): Promise<boolean> {
  const r = await fetch(
    `${BASE}/paste-image?session=${encodeURIComponent(session)}&index=${index}`,
    {
      method: "POST",
      headers: { "content-type": blob.type, ...csrfHeaders() },
      body: blob,
    },
  );
  return r.ok;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- client`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(thi-116): add client.pasteImage helper"
```

---

## Task 8: Wire `TerminalModal` — wsRef, double-Esc, Cmd-combos, image paste

**Files:**
- Modify: `frontend/src/components/TerminalModal.tsx`
- Modify: `frontend/src/App.tsx`

This task has no unit test — the frontend harness is lib-only (the `cardNav` / `filter` / `urlState` / `termKeys` / `client` tests). It is verified by a clean build, the full existing suites, and a manual checklist.

- [ ] **Step 1: Rename `killToast` → `messageToast` in `App.tsx`**

`killToast` is already a generic `(message: string) => void` message-toast helper; rename it so `TerminalModal` can reuse it without a misleading name. In `frontend/src/App.tsx`, replace the definition:

```tsx
  const killToast = useCallback(
    (message: string) =>
      pushToast({ id: Math.random().toString(36).slice(2), kind: "message", message }),
    [pushToast],
  );
```

with:

```tsx
  const messageToast = useCallback(
    (message: string) =>
      pushToast({ id: Math.random().toString(36).slice(2), kind: "message", message }),
    [pushToast],
  );
```

Then update its three other occurrences in `App.tsx`: inside `handleKill` (`else killToast(...)` → `else messageToast(...)`), inside `handleKillSession` (`else killToast(...)` → `else messageToast(...)`), and both `[killToast]` dependency arrays (`handleKill` and `handleKillSession`) → `[messageToast]`.

- [ ] **Step 2: Update `TerminalModal` imports and `Props`**

In `frontend/src/components/TerminalModal.tsx`, change the client import line:

```tsx
import { fetchPane, openPaneWS } from "../api/client";
```

to:

```tsx
import { fetchPane, openPaneWS, pasteImage } from "../api/client";
```

Add a new import after the `../types` import line:

```tsx
import { comboBytes, escAction } from "../lib/termKeys";
```

Replace the `Props` interface and the component signature:

```tsx
interface Props {
  window: Window;
  onClose: () => void;
}
```

```tsx
export function TerminalModal({ window: win, onClose }: Props) {
```

with:

```tsx
interface Props {
  window: Window;
  onClose: () => void;
  onToast: (message: string) => void;
}
```

```tsx
export function TerminalModal({ window: win, onClose, onToast }: Props) {
```

- [ ] **Step 3: Add `wsRef` + `lastEscRef` and wire `wsRef` in the construction effect**

In `TerminalModal.tsx`, after the `const fitRef = useRef<FitAddon | null>(null);` line, add:

```tsx
  const wsRef = useRef<WebSocket | null>(null);
  const lastEscRef = useRef(0);
```

In the construction effect, after the line `ws = openPaneWS(win.session, win.index);`, add:

```tsx
      wsRef.current = ws;
```

In the same effect's cleanup function (the `return () => { ... }`), after the `if (ws) { ... }` block and before `term.dispose();`, add:

```tsx
      wsRef.current = null;
```

- [ ] **Step 4: Add the image-paste effect**

In `TerminalModal.tsx`, immediately after the live-zoom `useEffect` (the one with the `[terminalFontSize]` dependency array), add:

```tsx
  // Image paste → upload to the pane. Capture phase so we intercept before
  // xterm's own paste handling. Agent panes only — the `@path` reference is
  // Claude Code's file-attach syntax and is meaningless in a plain shell.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) =>
        it.type.startsWith("image/"),
      );
      if (!item) return; // not an image — let xterm handle the text paste
      e.preventDefault();
      e.stopPropagation();
      if (win.kind !== "agent") {
        onToast("Image paste works only in Claude Code panes");
        return;
      }
      const blob = item.getAsFile();
      if (!blob) return;
      void pasteImage(win.session, win.index, blob).then((ok) => {
        if (!ok) onToast("Image paste failed — too large or unsupported type");
      });
    };
    host.addEventListener("paste", onPaste, true);
    return () => host.removeEventListener("paste", onPaste, true);
  }, [win.kind, win.session, win.index, onToast]);
```

- [ ] **Step 5: Rewrite the keydown effect (double-Esc + Cmd-combos)**

In `TerminalModal.tsx`, replace the entire keydown `useEffect` — currently:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // ⌘=/⌘-/⌘0 zoom. The browser binds these to page zoom, so preventDefault.
      // ⌘+ is physically ⌘⇧= on most layouts — match the unshifted "=".
      if (e.metaKey && (e.key === "=" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        if (e.key === "0") {
          updateSettings({ terminalFontSize: TERM_FONT_DEFAULT });
        } else {
          const delta = e.key === "=" ? ZOOM_STEP : -ZOOM_STEP;
          updateSettings({ terminalFontSize: clampFont(fontSizeRef.current + delta) });
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
```

with:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ws = wsRef.current;
      const live = ws !== null && ws.readyState === WebSocket.OPEN;

      if (e.key === "Escape") {
        // Double-Esc closes the modal; a single Esc is forwarded to the pane.
        // With no live socket (snapshot mode) there's nothing to interrupt — Esc
        // just closes.
        if (live && ws && escAction(Date.now(), lastEscRef.current) === "send") {
          e.preventDefault();
          ws.send("\x1b");
          lastEscRef.current = Date.now();
        } else {
          onClose();
        }
        return;
      }

      // ⌘=/⌘-/⌘0 zoom. The browser binds these to page zoom, so preventDefault.
      // ⌘+ is physically ⌘⇧= on most layouts — match the unshifted "=".
      if (e.metaKey && (e.key === "=" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        if (e.key === "0") {
          updateSettings({ terminalFontSize: TERM_FONT_DEFAULT });
        } else {
          const delta = e.key === "=" ? ZOOM_STEP : -ZOOM_STEP;
          updateSettings({ terminalFontSize: clampFont(fontSizeRef.current + delta) });
        }
        return;
      }

      // ⌘-combo line editing → control bytes forwarded to the pane.
      if (live && ws) {
        const bytes = comboBytes(e);
        if (bytes !== null) {
          e.preventDefault();
          ws.send(bytes);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
```

- [ ] **Step 6: Pass `onToast` from `App.tsx`**

In `frontend/src/App.tsx`, replace the `TerminalModal` render:

```tsx
      {openWindow && <TerminalModal window={openWindow} onClose={closeModal} />}
```

with:

```tsx
      {openWindow && (
        <TerminalModal
          window={openWindow}
          onClose={closeModal}
          onToast={messageToast}
        />
      )}
```

- [ ] **Step 7: Verify the build**

Run: `cd frontend && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Run the full frontend + backend suites**

Run: `cd frontend && npm test`
Expected: PASS — `termKeys`, `client`, and the pre-existing `cardNav` / `filter` / `urlState` suites.

Run: `cd backend && uv run pytest`
Expected: PASS — all backend tests.

- [ ] **Step 9: Manual verification**

Run `./scripts/dev.sh` (backend + frontend) and, against a real Claude Code pane:
- Open the terminal modal; type a command containing a `;` and submit — the `;` arrives intact (previously dropped).
- From the command palette, send multi-line text — newlines do not each submit; the trailing Enter submits once.
- Paste a screenshot into a Claude Code pane → the `@/tmp/switchboard-paste-*.png` reference appears in the pane.
- Open the modal on a **shell** pane and paste an image → a toast says image paste is Claude-only; nothing is pasted.
- At a shell prompt in the modal: type some text, press ⌘← / ⌘→ (cursor jumps to line start/end), ⌘⌫ (clears to line start), ⌘⌦ (clears to line end).
- Press Esc once → it reaches the pane (e.g. dismisses a Claude Code mode); press Esc twice quickly → the modal closes.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/TerminalModal.tsx frontend/src/App.tsx
git commit -m "feat(thi-116): wire TerminalModal — wsRef, double-Esc, Cmd-combos, image paste"
```

---

## Post-merge follow-up (not a code task)

THI-104's spec (`docs/superpowers/specs/2026-05-14-thi-104-design.md`) and plan
state "Esc stays 'close modal'." This ticket changes that to single-Esc-to-pane
/ double-Esc-to-close. Those files live on the `thi-104-prompt-interaction`
branch, not here — so once THI-116 merges to `main`, update THI-104's spec and
plan: the `PromptOverlay` owns Esc only while focused (its `onKeyDown` already
lets Escape fall through); when no overlay is mounted, the modal's double-Esc
model applies. No code conflict — the two handlers are scoped to different
focus states.

---

## Self-Review

**Spec coverage:**
- *`tmux.deliver_text` (stdin load-buffer + paste-buffer, `bracketed` toggles `-p`)* → Task 1. ✓
- *`send_keys` refactor — `paste` via `deliver_text`, `bracketed` param, 100 ms grace between paste + keys* → Task 2. ✓
- *`ws.py` unchanged, inherits the fix as a non-bracketed passthrough* → no task needed; Task 2 keeps `send_keys`'s default `bracketed=False`, and the File Structure notes `ws.py` is untouched. ✓
- *`/api/send` passes `bracketed=True`, no `SendBody` change* → Task 4. ✓
- *`tmux.pane_kind` agent-pane gate* → Task 3. ✓
- *`POST /api/paste-image` — 415/413/404/409 + happy path, temp file, sweep, `@path` bracketed paste, CSRF* → Task 5 (CSRF covered by `test_paste_image_requires_csrf`). ✓
- *`settings.paste_image_max_bytes`* → Task 5 Step 3. ✓
- *`client.pasteImage`* → Task 7. ✓
- *`lib/termKeys.ts` — `escAction`, `comboBytes`* → Task 6. ✓
- *`TerminalModal` — `wsRef`, double-Esc, Cmd-combos, image-paste listener, snapshot-mode degradation* → Task 8 (snapshot mode: `live` is false → Esc closes, combos inert). ✓
- *Toast feedback via the existing `ToastStack`* → Task 8 threads `onToast` (reusing the renamed `messageToast`). ✓
- *Edge cases — control bytes over WS, subprocess failure, oversize/non-image rejected pre-write, temp-file sweep, double-Esc race, snapshot mode* → Tasks 1/5/8 + tests. ✓
- *THI-104 Esc coordination* → Post-merge follow-up section. ✓

**Placeholder scan:** none — every code step contains complete code; every run step has an exact command and expected output.

**Type consistency:** `deliver_text(session, index, text, *, bracketed)` has one signature, used by `send_keys` (Task 2) and `/api/paste-image` (Task 5) and asserted in tests (Tasks 1/2/5). `send_keys(..., bracketed=False)` matches its callers in `ws.py` (default) and `/api/send` (Task 4). `pane_kind(session, index) -> Kind | None` matches its use in `/api/paste-image`. `escAction(now, lastEsc)` and `comboBytes({metaKey, key})` signatures match between `termKeys.ts` (Task 6), its tests, and `TerminalModal` (Task 8). `pasteImage(session, index, blob)` matches between `client.ts` (Task 7), its test, and `TerminalModal` (Task 8). `onToast: (message: string) => void` matches between `TerminalModal`'s `Props` and `messageToast` in `App.tsx` (Task 8).
