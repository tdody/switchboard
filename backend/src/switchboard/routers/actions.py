import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints

from switchboard.config import settings
from switchboard.schemas import TmuxName
from switchboard.services import tmux

router = APIRouter(prefix="/api")

# Per-element cap for keys[] (THI-177, sec:L5). A single key string of a few
# megabytes would otherwise still slip through the list-length cap. 4 KiB is
# more than any legitimate keystroke chord ("C-c", "Enter", "C-a C-x") needs
# and small enough that 512 elements at this cap stays a 2 MiB upper bound.
_KeyElement = Annotated[str, StringConstraints(max_length=4096)]


class SendBody(BaseModel):
    # THI-170 (sec:M7) + THI-177 (sec:L5): cap both the list length AND each
    # element. Send-keys content is intentionally arbitrary (it's keystrokes —
    # the whole point of the WS / palette), so the constraint here is a sanity
    # cap, not a charset filter.
    keys: list[_KeyElement] | None = Field(default=None, max_length=512)
    paste: str | None = Field(default=None, max_length=1_000_000)


class RenameBody(BaseModel):
    name: TmuxName


@router.post("/focus")
def post_focus(session: str, index: int) -> dict[str, bool]:
    focused = tmux.focus(session, index)
    if focused is None:
        raise HTTPException(status_code=404, detail="window not found")
    return {"focused": focused}


@router.post("/send")
def post_send(session: str, index: int, body: SendBody) -> dict[str, bool]:
    # Command-palette text is always a typed block — bracket the paste so
    # embedded newlines don't each submit; the trailing keys (Enter) submit once.
    ok = tmux.send_keys(session, index, keys=body.keys, paste=body.paste, bracketed=True)
    if not ok:
        raise HTTPException(status_code=404, detail="pane not found")
    return {"ok": True}


@router.post("/rename")
def post_rename(session: str, index: int, body: RenameBody) -> dict[str, object]:
    ok = tmux.rename_window(session, index, body.name)
    if not ok:
        raise HTTPException(status_code=404, detail="window not found")
    return {"ok": True, "name": body.name}


@router.delete("/window")
def delete_window(session: str, index: int) -> dict[str, bool]:
    ok = tmux.kill_window(session, index)
    if not ok:
        raise HTTPException(status_code=404, detail="window not found")
    return {"ok": True}


@router.delete("/session")
def delete_session(session: str) -> dict[str, bool]:
    ok = tmux.kill_session(session)
    if not ok:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@router.post("/rename-session")
def post_rename_session(session: str, body: RenameBody) -> dict[str, object]:
    ok = tmux.rename_session(session, body.name)
    if not ok:
        # Could be missing source or duplicate target name; either way tmux
        # rejected the rename and there's no separate code worth distinguishing.
        raise HTTPException(status_code=404, detail="session not found or name in use")
    return {"ok": True, "name": body.name}


@router.post("/window")
def post_window(session: str, name: TmuxName) -> dict[str, object]:
    index = tmux.new_window(session, name)
    if index is None:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True, "index": index, "id": f"{session}:{index}"}


@router.post("/session")
def post_session(name: TmuxName) -> dict[str, object]:
    # tmux's own duplicate-name guard does the existence check; we only need
    # to translate the boolean back into 409 so the UI can surface the
    # name-in-use case distinctly from a transport error.
    if not tmux.new_session(name):
        raise HTTPException(status_code=409, detail="session name in use or invalid")
    return {"ok": True, "name": name}


@router.post("/detach")
def post_detach(tty: str) -> dict[str, bool]:
    ok = tmux.detach_client(tty)
    if not ok:
        raise HTTPException(status_code=404, detail="client not found")
    return {"ok": True}


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
async def post_paste_image(session: str, index: int, request: Request) -> dict[str, object]:
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
        raise HTTPException(status_code=409, detail="image paste is only supported for agent panes")
    _sweep_old_paste_images()
    path = Path(tempfile.gettempdir()) / f"{_PASTE_PREFIX}{uuid.uuid4().hex}.{ext}"
    try:
        path.write_bytes(body)
    except OSError:
        raise HTTPException(status_code=500, detail="failed to write temp file") from None
    # Claude Code's file-attach syntax: `@<path> ` (trailing space).
    if not tmux.deliver_text(session, index, f"@{path} ", bracketed=True):
        raise HTTPException(status_code=404, detail="pane not found")
    return {"ok": True, "path": str(path), "bytes": len(body)}


# --- open file in IDE (THI-146 PR 3) ---------------------------------------
#
# Security model:
#  * `ide_cmd` MUST be a member of `settings.IDE_ALLOWLIST` (a frozenset of
#    known GUI editor binaries). An unset / unknown value disables the route.
#  * Path resolution depends on whether the input is absolute or relative:
#    - Absolute paths (after `expanduser`) are trusted. The user reads the
#      full path in the pane output before clicking; the agent can't hide
#      an absolute path behind a relative-looking reference. Common case:
#      monorepo where the pane is in `backend/` and the agent prints an
#      absolute path inside `frontend/`. Realpath is still followed (so
#      symlinks resolve), but the cwd-containment check is skipped.
#    - Relative paths are constrained to the pane's cwd. `../../etc/passwd`
#      style traversal and symlinks pointing outside the cwd are rejected
#      via `os.path.realpath` + `os.path.commonpath`.
#  * The file must exist and be a regular file (not a dir, FIFO, device).
#  * Dispatch is `subprocess.Popen([ide_cmd, "--", real_path], shell=False)`.
#    The `--` separator ensures a path like `--version` can't be reinterpreted
#    as an editor flag. `shell=False` prevents shell metacharacter expansion.
#  * Existing CSRF + loopback Host middleware applies — no extra checks here.


def _open_file_in_ide(
    session: str, index: int, raw_path: str, ide_override: str | None = None
) -> str:
    """Validate `raw_path` against the pane's cwd, spawn the IDE if allowed,
    and return the absolute path that was opened. Raises HTTPException with
    a precise status code on any failure so the route's response is uniform.

    `ide_override` is the optional `ide=` query param from /api/open. It must
    still be on `IDE_ALLOWLIST` — defense in depth against a hand-crafted
    request escaping the allowlist that the frontend dropdown enforces.
    """
    # Validate the explicit override first so a bad `ide=` parameter never
    # accidentally falls through to the default IDE and looks like it worked.
    if ide_override is not None:
        if ide_override not in settings.IDE_ALLOWLIST:
            raise HTTPException(
                status_code=400,
                detail=f"ide `{ide_override}` is not in the editor allowlist",
            )
        ide_cmd = ide_override
    else:
        if not settings.ide_enabled:
            raise HTTPException(
                status_code=400,
                detail=(
                    "SWITCHBOARD_IDE_CMD is unset or not in the known editor "
                    "allowlist; the /api/open route is disabled."
                ),
            )
        ide_cmd = settings.ide_cmd

    cwd = tmux.pane_cwd(session, index)
    if not cwd:
        raise HTTPException(status_code=404, detail="pane not found or has no cwd")

    if not raw_path or "\x00" in raw_path:
        raise HTTPException(status_code=422, detail="invalid path")

    # `expanduser` lets a `~/notes.md` link from a Claude footer resolve to
    # the user's home — common in agent output. The result is absolute and
    # follows the absolute-path trust path below.
    expanded = os.path.expanduser(raw_path)
    is_absolute = os.path.isabs(expanded)
    candidate = expanded if is_absolute else os.path.join(cwd, expanded)
    real_file = os.path.realpath(candidate)

    if not is_absolute:
        # Relative paths are constrained to the pane's cwd. This catches
        # `../../etc/passwd`-style traversal AND symlinks that point outside
        # the cwd (because realpath chases links). Absolute paths skip this
        # check — the user typed/saw the full path before clicking.
        real_cwd = os.path.realpath(cwd)
        try:
            common = os.path.commonpath([real_cwd, real_file])
        except ValueError:
            # Different drives / mixed separators (Windows). Treat as escape.
            raise HTTPException(status_code=422, detail="path escapes pane cwd") from None
        if common != real_cwd:
            raise HTTPException(status_code=422, detail="path escapes pane cwd")

    if not os.path.isfile(real_file):
        raise HTTPException(status_code=404, detail="file not found")

    # List form + `--` separator: argv[0] is the trusted binary name, argv[1]
    # is the literal separator, argv[2] is the (cwd-contained) absolute path.
    # No path on this argv can become a flag, and no shell parses the string.
    try:
        subprocess.Popen(
            [ide_cmd, "--", real_file],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"IDE binary `{ide_cmd}` not on PATH",
        ) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"failed to spawn IDE: {exc}") from exc

    return real_file


@router.post("/open")
def post_open(session: str, index: int, path: str, ide: str | None = None) -> dict[str, object]:
    """Open `path` in the configured IDE. When `ide` is provided, that binary
    is used instead of `settings.ide_cmd` (subject to the same allowlist).
    The Settings dropdown sends this so a per-user choice overrides the
    server-side env-var default without losing the security gate."""
    real_file = _open_file_in_ide(session, index, path, ide)
    return {"ok": True, "path": real_file}


@router.get("/ide-config")
def get_ide_config() -> dict[str, object]:
    """Read-only knobs for the frontend's file-path linkifier and the
    Settings "Open in IDE" dropdown. `available` (THI-146 PR 4) is the
    probed subset of `KNOWN_IDES` actually installed on the host. `default`
    is what /api/open uses when no `ide` param is sent — preserved for
    backward compat as `command`."""
    from switchboard.services.ide_probe import probe_available_ides

    available = probe_available_ides()
    default = settings.ide_cmd if settings.ide_enabled else None
    return {
        "enabled": settings.ide_enabled,
        "command": default,
        "default": default,
        "available": available,
        "allowed": sorted(settings.IDE_ALLOWLIST),
    }
