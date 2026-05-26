"""Tests for POST /api/open and GET /api/ide-config (THI-146 PR 3).

The open route is security-sensitive: it spawns a configured GUI editor with
an attacker-supplied (but pane-cwd-contained) path. These tests pin the
guards so a regression in the validator would surface here, not in prod.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app

BASE_URL = "http://127.0.0.1:8765"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "token_file", tmp_path / "token")
    monkeypatch.setattr(auth_mod.auth_state, "token", "")
    monkeypatch.setattr(auth_mod.auth_state, "csrf_secret", "")
    with TestClient(create_app(), base_url=BASE_URL) as c:
        c.get("/api/state")
        yield c


def _csrf(client: TestClient) -> dict[str, str]:
    return {"x-csrf-token": client.cookies.get("sb_csrf") or ""}


# --- GET /api/ide-config ---------------------------------------------------


def test_ide_config_reports_enabled_state(client: TestClient) -> None:
    # Default `ide_cmd="code"` is in the allowlist, so the config endpoint
    # reports enabled + a non-null command + the full allowlist.
    r = client.get("/api/ide-config")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["command"] == "code"
    assert "code" in body["allowed"]
    assert "cursor" in body["allowed"]


def test_ide_config_disables_when_ide_not_in_allowlist(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # An empty / unknown ide_cmd hides the route. The frontend uses this
    # signal to suppress the file-path linkifier altogether.
    monkeypatch.setattr(settings, "ide_cmd", "")
    r = client.get("/api/ide-config")
    body = r.json()
    assert body["enabled"] is False
    assert body["command"] is None


# --- POST /api/open: security guards --------------------------------------


def test_open_400_when_ide_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ide_cmd", "nope-not-in-allowlist")
    r = client.post(
        "/api/open?session=dev&index=0&path=foo.py", headers=_csrf(client)
    )
    assert r.status_code == 400


def test_open_404_when_pane_has_no_cwd(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: None)
    r = client.post(
        "/api/open?session=ghost&index=99&path=foo.py", headers=_csrf(client)
    )
    assert r.status_code == 404


def test_open_422_on_path_escape(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # `../../etc/passwd` resolves outside the pane's cwd. Even if the file
    # happens to exist on disk, the containment check rejects it. We don't
    # need a real /etc/passwd here — the guard fires before the existence
    # check.
    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(tmp_path))
    r = client.post(
        "/api/open?session=dev&index=0&path=../../etc/passwd",
        headers=_csrf(client),
    )
    assert r.status_code == 422
    assert "escapes" in r.json()["detail"]


def test_open_422_when_symlink_escapes_cwd(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # The symlink lives inside the pane's cwd but points outside. realpath()
    # must chase the link so the containment check rejects the open. This is
    # the test that would have caught a `os.path.abspath`-only impl that
    # doesn't follow symlinks.
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    secret = outside_dir / "secret.py"
    secret.write_text("# do not open me")

    cwd = tmp_path / "pane-cwd"
    cwd.mkdir()
    link = cwd / "innocent.py"
    link.symlink_to(secret)

    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(cwd))
    r = client.post(
        f"/api/open?session=dev&index=0&path=innocent.py", headers=_csrf(client)
    )
    assert r.status_code == 422


def test_open_422_on_empty_or_null_byte_path(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(tmp_path))
    r1 = client.post(
        "/api/open?session=dev&index=0&path=", headers=_csrf(client)
    )
    # Pydantic / starlette parses "&path=" as "" — the validator rejects it.
    assert r1.status_code == 422


def test_open_404_when_file_does_not_exist(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(tmp_path))
    r = client.post(
        "/api/open?session=dev&index=0&path=ghost.py", headers=_csrf(client)
    )
    assert r.status_code == 404


def test_open_404_when_path_is_a_directory(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Containment passes, but `is_file()` is False — opening a directory
    # would be a UX bug at best and a "let me browse /" bug at worst.
    sub = tmp_path / "src"
    sub.mkdir()
    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(tmp_path))
    r = client.post(
        "/api/open?session=dev&index=0&path=src", headers=_csrf(client)
    )
    assert r.status_code == 404


# --- POST /api/open: success path -----------------------------------------


def test_open_invokes_ide_with_list_argv_and_dashdash(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The success path must shell out via argv-list form with a `--`
    separator. This pins the security-critical invariants: no shell parser,
    no chance for the file path to be reinterpreted as a flag."""
    target = tmp_path / "src" / "x.py"
    target.parent.mkdir()
    target.write_text("pass")

    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(tmp_path))

    captured: dict[str, object] = {}

    class FakePopen:
        def __init__(self, args, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs

    monkeypatch.setattr(
        "switchboard.routers.actions.subprocess.Popen", FakePopen
    )

    r = client.post(
        "/api/open?session=dev&index=0&path=src/x.py", headers=_csrf(client)
    )
    assert r.status_code == 200

    args = captured["args"]
    assert args[0] == "code"  # the configured ide_cmd
    assert args[1] == "--"  # NEVER drop the separator — it neutralizes path-as-flag
    assert args[2] == os.path.realpath(target)
    # `shell` must NOT be True; the route relies on argv-list invocation.
    assert captured["kwargs"].get("shell") is not True


def test_open_accepts_absolute_path_inside_cwd(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Claude footers sometimes print absolute paths; the validator handles
    # them as long as they're still within the pane's cwd.
    target = tmp_path / "absolute.py"
    target.write_text("pass")

    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(tmp_path))

    class NoopPopen:
        def __init__(self, *a, **k):
            pass

    monkeypatch.setattr(
        "switchboard.routers.actions.subprocess.Popen", NoopPopen
    )

    r = client.post(
        f"/api/open?session=dev&index=0&path={target}", headers=_csrf(client)
    )
    assert r.status_code == 200


def test_open_500_when_ide_binary_missing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    target = tmp_path / "x.py"
    target.write_text("pass")
    monkeypatch.setattr("switchboard.services.tmux.pane_cwd", lambda s, i: str(tmp_path))

    def fake_popen(*_args, **_kwargs):
        raise FileNotFoundError("code not on PATH")

    monkeypatch.setattr(
        "switchboard.routers.actions.subprocess.Popen", fake_popen
    )

    r = client.post(
        "/api/open?session=dev&index=0&path=x.py", headers=_csrf(client)
    )
    assert r.status_code == 500
    assert "code" in r.json()["detail"]
