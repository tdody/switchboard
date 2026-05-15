"""Route tests for the window-management endpoints (THI-83).

CSRF and the tmux 404 path are exercised against the real middleware/service;
the success path monkeypatches the tmux service so it's deterministic without
a live tmux server.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app

# TestClient defaults to Host: testserver, rejected by the loopback allowlist.
BASE_URL = "http://127.0.0.1:8765"


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Loopback-mode TestClient with the sb_csrf cookie already primed."""
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "token_file", tmp_path / "token")
    monkeypatch.setattr(auth_mod.auth_state, "token", "")
    monkeypatch.setattr(auth_mod.auth_state, "csrf_secret", "")
    with TestClient(create_app(), base_url=BASE_URL) as c:
        c.get("/api/state")  # issues the sb_csrf cookie
        yield c


def _csrf(client: TestClient) -> dict[str, str]:
    return {"x-csrf-token": client.cookies.get("sb_csrf") or ""}


# --- CSRF: mutating verbs are blocked without the double-submit header -------


@pytest.mark.parametrize(
    "method,path",
    [
        ("delete", "/api/window?session=x&index=0"),
        ("delete", "/api/session?session=x"),
        ("post", "/api/window?session=x&name=y"),
        ("post", "/api/detach?tty=/dev/ttys000"),
        ("post", "/api/send?session=x&index=0"),
    ],
)
def test_mutations_require_csrf(client: TestClient, method: str, path: str) -> None:
    assert getattr(client, method)(path).status_code == 403


# --- 404 path: real tmux service, clearly-nonexistent targets ---------------


def test_delete_window_404_on_missing(client: TestClient) -> None:
    r = client.delete("/api/window?session=__nope__&index=0", headers=_csrf(client))
    assert r.status_code == 404


def test_delete_session_404_on_missing(client: TestClient) -> None:
    r = client.delete("/api/session?session=__nope__", headers=_csrf(client))
    assert r.status_code == 404


def test_post_window_404_on_missing_session(client: TestClient) -> None:
    r = client.post("/api/window?session=__nope__&name=dev", headers=_csrf(client))
    assert r.status_code == 404


def test_post_detach_404_on_missing_client(client: TestClient) -> None:
    r = client.post("/api/detach?tty=/dev/ttys999", headers=_csrf(client))
    assert r.status_code == 404


# --- success path: tmux service monkeypatched -------------------------------


def test_delete_window_ok(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.kill_window", lambda s, i: True)
    r = client.delete("/api/window?session=dev&index=2", headers=_csrf(client))
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_delete_session_ok(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.kill_session", lambda s: True)
    r = client.delete("/api/session?session=dev", headers=_csrf(client))
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_post_window_ok_returns_new_id(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.new_window", lambda s, n: 4)
    r = client.post("/api/window?session=dev&name=tests", headers=_csrf(client))
    assert r.status_code == 200
    assert r.json() == {"ok": True, "index": 4, "id": "dev:4"}


def test_post_detach_ok(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.detach_client", lambda tty: True)
    r = client.post("/api/detach?tty=/dev/ttys001", headers=_csrf(client))
    assert r.status_code == 200
    assert r.json() == {"ok": True}


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
