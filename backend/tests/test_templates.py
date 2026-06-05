"""Tests for the THI-99 session templates service + route.

Templates are JSON files at `~/.switchboard/templates/*.json` plus a small set
of built-ins. Instantiation creates a tmux session with N windows, optionally
each with a cwd and a startup command.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app
from switchboard.services import templates


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "token_file", tmp_path / "token")
    monkeypatch.setattr(auth_mod.auth_state, "token", "")
    monkeypatch.setattr(auth_mod.auth_state, "csrf_secret", "")
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as c:
        c.get("/api/state")  # warm CSRF
        yield c


def _csrf(client: TestClient) -> dict[str, str]:
    return {"x-csrf-token": client.cookies.get("sb_csrf") or ""}


# ---------------------------------------------------------------------------
# services.templates — pure helpers
# ---------------------------------------------------------------------------


def test_extract_variables_walks_session_name_and_every_window_field() -> None:
    t = templates.Template(
        name="x",
        session="${REPO_NAME}",
        windows=[
            templates.TemplateWindow(name="dev", cwd="${REPO_PATH}", cmd="${RUNNER} dev"),
            templates.TemplateWindow(name="shell", cwd="${REPO_PATH}"),
        ],
    )
    vars = templates.extract_variables(t)
    # Deduped, stable order (sorted alphabetically for predictability).
    assert vars == ["REPO_NAME", "REPO_PATH", "RUNNER"]


def test_substitute_replaces_dollar_brace_var_with_value() -> None:
    out = templates.substitute(
        "cd ${REPO_PATH} && ${RUNNER} dev",
        {"REPO_PATH": "/x/y", "RUNNER": "pnpm"},
    )
    assert out == "cd /x/y && pnpm dev"


def test_substitute_leaves_unknown_vars_untouched() -> None:
    # A template referencing an unknown var should not crash; the var pattern
    # passes through and the user sees the literal `${VAR}` in their shell.
    assert templates.substitute("hi ${UNKNOWN}", {}) == "hi ${UNKNOWN}"


def test_load_user_templates_reads_json_files_in_user_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tdir = tmp_path / "templates"
    tdir.mkdir()
    (tdir / "mine.json").write_text(
        json.dumps(
            {
                "name": "mine",
                "session": "${X}",
                "windows": [{"name": "a"}],
            }
        )
    )
    monkeypatch.setattr(templates, "_user_templates_dir", lambda: tdir)
    found = templates.load_user_templates()
    assert [t.name for t in found] == ["mine"]


def test_load_user_templates_skips_invalid_json_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tdir = tmp_path / "templates"
    tdir.mkdir()
    (tdir / "good.json").write_text(
        json.dumps({"name": "good", "session": "g", "windows": [{"name": "x"}]})
    )
    (tdir / "broken.json").write_text("{not valid json")
    (tdir / "missing-fields.json").write_text(json.dumps({"name": "bad"}))
    monkeypatch.setattr(templates, "_user_templates_dir", lambda: tdir)
    found = templates.load_user_templates()
    assert [t.name for t in found] == ["good"]


def test_list_templates_returns_builtins_when_user_dir_is_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(templates, "_user_templates_dir", lambda: tmp_path / "x")
    names = [t.name for t in templates.list_templates()]
    # At least one built-in must ship; specific names are pinned in the
    # built-in definition so a future addition lands deliberately.
    assert "web-project" in names
    assert "agent-grid" in names


# ---------------------------------------------------------------------------
# services.templates.instantiate — drives libtmux
# ---------------------------------------------------------------------------


def test_instantiate_creates_session_then_extra_windows_with_substitution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 3-window template should call new_session once (for the first window)
    and new_window twice. Each call should see substituted vars."""
    new_session_calls: list[dict] = []
    new_window_calls: list[dict] = []
    send_keys_calls: list[dict] = []

    def fake_new_session(name, *, window_name=None, cwd=None):
        new_session_calls.append({"name": name, "window_name": window_name, "cwd": cwd})
        return True

    def fake_new_window(session, name, *, cwd=None):
        new_window_calls.append({"session": session, "name": name, "cwd": cwd})
        return len(new_window_calls)  # index 1, 2, ...

    def fake_send_keys(session, index, *, paste=None, keys=None, bracketed=False):
        send_keys_calls.append({"session": session, "index": index, "paste": paste, "keys": keys})
        return True

    monkeypatch.setattr(templates.tmux, "new_session", fake_new_session)
    monkeypatch.setattr(templates.tmux, "new_window", fake_new_window)
    monkeypatch.setattr(templates.tmux, "send_keys", fake_send_keys)

    t = templates.Template(
        name="x",
        session="${REPO_NAME}",
        windows=[
            templates.TemplateWindow(name="dev", cwd="${PATH_}", cmd="pnpm dev"),
            templates.TemplateWindow(name="tests", cwd="${PATH_}", cmd="pnpm test"),
            templates.TemplateWindow(name="shell", cwd="${PATH_}"),
        ],
    )
    ok, session = templates.instantiate(t, {"REPO_NAME": "switchboard", "PATH_": "/home/me/repo"})

    assert ok is True
    assert session == "switchboard"

    assert new_session_calls == [
        {"name": "switchboard", "window_name": "dev", "cwd": "/home/me/repo"}
    ]
    assert new_window_calls == [
        {"session": "switchboard", "name": "tests", "cwd": "/home/me/repo"},
        {"session": "switchboard", "name": "shell", "cwd": "/home/me/repo"},
    ]
    # `dev` and `tests` ran a command; `shell` did not.
    assert send_keys_calls == [
        {"session": "switchboard", "index": 0, "paste": "pnpm dev", "keys": ["Enter"]},
        {"session": "switchboard", "index": 1, "paste": "pnpm test", "keys": ["Enter"]},
    ]


def test_instantiate_returns_false_when_new_session_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(templates.tmux, "new_session", lambda *a, **k: False)
    t = templates.Template(name="x", session="x", windows=[templates.TemplateWindow(name="w")])
    ok, _ = templates.instantiate(t, {})
    assert ok is False


# ---------------------------------------------------------------------------
# router — wire the service to /api
# ---------------------------------------------------------------------------


def test_get_templates_returns_at_least_the_builtins(client: TestClient) -> None:
    r = client.get("/api/templates")
    assert r.status_code == 200
    body = r.json()
    names = [t["name"] for t in body["templates"]]
    assert "web-project" in names
    # camelCase wire format: `windowCount` (alias for window_count).
    web = next(t for t in body["templates"] if t["name"] == "web-project")
    assert isinstance(web["windowCount"], int)
    assert "variables" in web


def test_post_instantiate_calls_service_and_returns_session_name(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        templates,
        "instantiate",
        lambda template, vars: (True, vars.get("REPO_NAME", "x")),
    )
    r = client.post(
        "/api/templates/instantiate",
        json={
            "name": "web-project",
            "variables": {"REPO_NAME": "switchboard", "REPO_PATH": "/r"},
        },
        headers=_csrf(client),
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "session": "switchboard"}


def test_post_instantiate_404_when_template_not_found(
    client: TestClient,
) -> None:
    r = client.post(
        "/api/templates/instantiate",
        json={"name": "does-not-exist", "variables": {}},
        headers=_csrf(client),
    )
    assert r.status_code == 404
