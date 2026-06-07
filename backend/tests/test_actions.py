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
        ("post", "/api/paste-image?session=x&index=0"),
        ("post", "/api/rename-session?session=x"),
        ("post", "/api/session?name=y"),
        ("post", "/api/open?session=x&index=0&path=foo.py"),
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


def test_post_rename_session_404_on_missing(client: TestClient) -> None:
    r = client.post(
        "/api/rename-session?session=__nope__",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"name": "new"},
    )
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
    monkeypatch.setattr("switchboard.services.tmux.new_window", lambda s, n, cwd=None: 4)
    r = client.post("/api/window?session=dev&name=tests", headers=_csrf(client))
    assert r.status_code == 200
    assert r.json() == {"ok": True, "index": 4, "id": "dev:4"}


def test_post_session_ok(client: TestClient, monkeypatch) -> None:
    seen: list[tuple[str, str | None]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.new_session",
        lambda name, cwd=None: seen.append((name, cwd)) or True,
    )
    r = client.post("/api/session?name=feat", headers=_csrf(client))
    assert r.status_code == 200
    assert r.json() == {"ok": True, "name": "feat"}
    assert seen == [("feat", None)]


def test_post_session_409_on_duplicate(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.new_session", lambda name, cwd=None: False)
    r = client.post("/api/session?name=dev", headers=_csrf(client))
    assert r.status_code == 409


# THI-244: clients can supply a cwd for new-session / new-window. Backend
# validates it as an existing absolute directory; invalid paths fall back to
# None so the user never has to debug a bad setting through 4xx noise.
def test_post_session_threads_resolved_cwd(client: TestClient, monkeypatch, tmp_path) -> None:
    seen: list[tuple[str, str | None]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.new_session",
        lambda name, cwd=None: seen.append((name, cwd)) or True,
    )
    real_dir = str(tmp_path)
    r = client.post(
        "/api/session?name=feat",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"cwd": real_dir},
    )
    assert r.status_code == 200
    assert seen == [("feat", real_dir)]


def test_post_session_drops_invalid_cwd(client: TestClient, monkeypatch) -> None:
    seen: list[tuple[str, str | None]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.new_session",
        lambda name, cwd=None: seen.append((name, cwd)) or True,
    )
    r = client.post(
        "/api/session?name=feat",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"cwd": "/this/path/does/not/exist/123"},
    )
    assert r.status_code == 200
    # Backend resolved → None silently; tmux uses its own default.
    assert seen == [("feat", None)]


def test_post_session_drops_relative_cwd(client: TestClient, monkeypatch) -> None:
    seen: list[tuple[str, str | None]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.new_session",
        lambda name, cwd=None: seen.append((name, cwd)) or True,
    )
    r = client.post(
        "/api/session?name=feat",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"cwd": "relative/dir"},
    )
    assert r.status_code == 200
    # Relative paths would land in switchboard's launch directory — reject.
    assert seen == [("feat", None)]


def test_post_session_expands_tilde(client: TestClient, monkeypatch, tmp_path) -> None:
    seen: list[tuple[str, str | None]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.new_session",
        lambda name, cwd=None: seen.append((name, cwd)) or True,
    )
    # Pretend HOME is tmp_path so `~` expands to a real directory.
    monkeypatch.setenv("HOME", str(tmp_path))
    r = client.post(
        "/api/session?name=feat",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"cwd": "~"},
    )
    assert r.status_code == 200
    assert seen == [("feat", str(tmp_path))]


def test_post_window_threads_resolved_cwd(client: TestClient, monkeypatch, tmp_path) -> None:
    seen: list[tuple[str, str, str | None]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.new_window",
        lambda s, n, cwd=None: seen.append((s, n, cwd)) or 7,
    )
    r = client.post(
        "/api/window?session=dev&name=tests",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"cwd": str(tmp_path)},
    )
    assert r.status_code == 200
    assert seen == [("dev", "tests", str(tmp_path))]


def test_post_window_falls_back_to_first_window_cwd_when_body_empty(
    client: TestClient, monkeypatch
) -> None:
    """No body → backend looks up the launching session's first window cwd and
    passes that to new_window. Mirrors the user's expectation that "+" in a
    session lands next to its peers."""
    monkeypatch.setattr(
        "switchboard.routers.actions._first_window_cwd",
        lambda session: "/Users/me/dev/foo",
    )
    seen: list[tuple[str, str, str | None]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.new_window",
        lambda s, n, cwd=None: seen.append((s, n, cwd)) or 1,
    )
    r = client.post("/api/window?session=dev&name=x", headers=_csrf(client))
    assert r.status_code == 200
    assert seen == [("dev", "x", "/Users/me/dev/foo")]


def test_post_detach_ok(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.detach_client", lambda tty: True)
    r = client.post("/api/detach?tty=/dev/ttys001", headers=_csrf(client))
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_post_rename_session_ok(client: TestClient, monkeypatch) -> None:
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "switchboard.services.tmux.rename_session",
        lambda old, new: seen.append((old, new)) or True,
    )
    r = client.post(
        "/api/rename-session?session=dev",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"name": "feat"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "name": "feat"}
    assert seen == [("dev", "feat")]


def test_post_send_uses_bracketed_paste(client: TestClient, monkeypatch) -> None:
    seen: dict = {}

    def fake_send_keys(session, index, *, keys=None, paste=None, bracketed=False):
        seen.update(session=session, index=index, keys=keys, paste=paste, bracketed=bracketed)
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


# THI-177 (sec:L5): per-element keys cap. A list of 512 short strings is fine,
# but a single 100 MiB string slipping through would be a DoS in itself.
def test_post_send_rejects_oversized_key_element(client: TestClient) -> None:
    huge_key = "x" * (4096 + 1)  # one over the per-element cap
    r = client.post(
        "/api/send?session=dev&index=1",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"keys": [huge_key]},
    )
    assert r.status_code == 422


def test_post_send_accepts_realistic_keys(client: TestClient, monkeypatch) -> None:
    """Sanity check: normal key chords still validate fine."""
    monkeypatch.setattr(
        "switchboard.services.tmux.send_keys",
        lambda *_a, **_kw: True,
    )
    r = client.post(
        "/api/send?session=dev&index=1",
        headers={**_csrf(client), "content-type": "application/json"},
        json={"keys": ["C-c", "Enter", "C-a C-x"]},
    )
    assert r.status_code == 200


# The endpoint validates the Content-Type header and the byte length, not PNG
# structure — arbitrary bytes with an image/* content type are sufficient here.
FAKE_IMAGE = b"\x89PNG\r\n\x1a\n" + b"fake-image-data" * 8  # ~128 bytes


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
        lambda s, i, text, *, bracketed: delivered.append((s, i, text, bracketed)) or True,
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


def test_paste_image_500_when_write_fails(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.pane_kind", lambda s, i: "agent")

    def fail_write(self, data):
        raise OSError("disk full")

    monkeypatch.setattr("pathlib.Path.write_bytes", fail_write)
    r = client.post(
        "/api/paste-image?session=dev&index=0",
        content=FAKE_IMAGE,
        headers={**_csrf(client), "content-type": "image/png"},
    )
    assert r.status_code == 500


def test_paste_image_404_when_deliver_text_fails(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr("switchboard.services.tmux.pane_kind", lambda s, i: "agent")
    monkeypatch.setattr("switchboard.services.tmux.deliver_text", lambda *a, **k: False)
    # Stub the write to a no-op so no real temp file is created. The endpoint
    # only cares that the path exists logically (it passes the path string to
    # deliver_text); we don't need on-disk content for this test.
    monkeypatch.setattr("pathlib.Path.write_bytes", lambda self, data: None)
    r = client.post(
        "/api/paste-image?session=dev&index=0",
        content=FAKE_IMAGE,
        headers={**_csrf(client), "content-type": "image/png"},
    )
    assert r.status_code == 404
