"""Tests for the THI-100 pane history search route.

The route iterates every libtmux pane, grep'd for a substring, and returns
a flat list of `{paneId, session, windowName, windowIndex, lineNumber, context}`.
We stub libtmux + `capture_pane` so the test runs without a tmux server.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from switchboard import auth as auth_mod
from switchboard.config import settings
from switchboard.main import create_app
from switchboard.services import tmux


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "token_file", tmp_path / "token")
    monkeypatch.setattr(auth_mod.auth_state, "token", "")
    monkeypatch.setattr(auth_mod.auth_state, "csrf_secret", "")
    with TestClient(create_app(), base_url="http://127.0.0.1:8765") as c:
        yield c


def _make_fake_server(panes: dict[tuple[str, int], dict[str, object]]):
    """Build a libtmux-shaped fake. `panes` maps (session, index) to:
    {"pane_id": "%N", "window_name": "...", "lines": ["..."]}
    """
    from types import SimpleNamespace

    by_session: dict[str, list[tuple[int, dict[str, object]]]] = {}
    for (sess, idx), meta in panes.items():
        by_session.setdefault(sess, []).append((idx, meta))

    sessions = []
    for sess_name, entries in by_session.items():
        windows = []
        for idx, meta in entries:
            pane = SimpleNamespace(pane_id=meta["pane_id"])
            windows.append(
                SimpleNamespace(
                    window_index=str(idx),
                    window_name=meta["window_name"],
                    active_pane=pane,
                )
            )
        sessions.append(SimpleNamespace(session_name=sess_name, windows=windows))

    return SimpleNamespace(sessions=sessions)


def _stub_capture(panes: dict[tuple[str, int], dict[str, object]]):
    def fake_capture(session: str, index: int, lines: int = 500) -> list[str]:
        return list(panes[(session, index)]["lines"])  # type: ignore[index]

    return fake_capture


def test_search_returns_matches_with_one_line_context_above_and_below(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    panes = {
        ("main", 0): {
            "pane_id": "%1",
            "window_name": "shell",
            "lines": [
                "alpha",
                "beta NEEDLE here",
                "gamma",
                "no match",
            ],
        },
    }
    monkeypatch.setattr(tmux, "get_server", lambda: _make_fake_server(panes))
    monkeypatch.setattr(tmux, "capture_pane", _stub_capture(panes))

    r = client.get("/api/search", params={"q": "needle"})
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "needle"
    assert len(body["matches"]) == 1
    m = body["matches"][0]
    assert m["paneId"] == "%1"
    assert m["session"] == "main"
    assert m["windowName"] == "shell"
    assert m["windowIndex"] == 0
    assert m["lineNumber"] == 2  # 1-based
    assert m["context"] == ["alpha", "beta NEEDLE here", "gamma"]


def test_search_is_case_insensitive(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    panes = {
        ("main", 0): {
            "pane_id": "%1",
            "window_name": "x",
            "lines": ["HELLO world"],
        },
    }
    monkeypatch.setattr(tmux, "get_server", lambda: _make_fake_server(panes))
    monkeypatch.setattr(tmux, "capture_pane", _stub_capture(panes))

    r = client.get("/api/search", params={"q": "hello"})
    assert r.status_code == 200
    assert len(r.json()["matches"]) == 1


def test_search_strips_ansi_before_matching_so_color_codes_dont_break_grep(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # \x1b[31m...\x1b[0m wraps the match; the user typed "error" without the
    # color escape; the substring search must still hit.
    panes = {
        ("main", 0): {
            "pane_id": "%1",
            "window_name": "logs",
            "lines": ["\x1b[31merror:\x1b[0m something broke"],
        },
    }
    monkeypatch.setattr(tmux, "get_server", lambda: _make_fake_server(panes))
    monkeypatch.setattr(tmux, "capture_pane", _stub_capture(panes))

    r = client.get("/api/search", params={"q": "error"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["matches"]) == 1
    # Returned context should also be ANSI-stripped so the UI renders plain text.
    assert body["matches"][0]["context"][1] == "error: something broke"


def test_search_across_multiple_panes(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    panes = {
        ("main", 0): {
            "pane_id": "%1",
            "window_name": "shell",
            "lines": ["found FOO once"],
        },
        ("main", 1): {
            "pane_id": "%2",
            "window_name": "logs",
            "lines": ["nothing here", "FOO again"],
        },
        ("agents", 0): {
            "pane_id": "%3",
            "window_name": "claude",
            "lines": ["unrelated"],
        },
    }
    monkeypatch.setattr(tmux, "get_server", lambda: _make_fake_server(panes))
    monkeypatch.setattr(tmux, "capture_pane", _stub_capture(panes))

    r = client.get("/api/search", params={"q": "foo"})
    assert r.status_code == 200
    body = r.json()
    by_pane = {m["paneId"]: m for m in body["matches"]}
    assert set(by_pane) == {"%1", "%2"}
    assert by_pane["%2"]["lineNumber"] == 2


def test_search_returns_empty_for_no_matches(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    panes = {
        ("main", 0): {
            "pane_id": "%1",
            "window_name": "x",
            "lines": ["only quiet here"],
        },
    }
    monkeypatch.setattr(tmux, "get_server", lambda: _make_fake_server(panes))
    monkeypatch.setattr(tmux, "capture_pane", _stub_capture(panes))

    r = client.get("/api/search", params={"q": "missing"})
    assert r.status_code == 200
    assert r.json() == {"query": "missing", "matches": [], "truncated": False}


def test_search_rejects_empty_query_with_400(client: TestClient) -> None:
    # An empty query would return every line as a "match" — prevent the
    # accidental DoS by requiring something to search for.
    r = client.get("/api/search", params={"q": ""})
    assert r.status_code == 400


def test_search_returns_empty_when_tmux_is_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(tmux, "get_server", lambda: None)
    r = client.get("/api/search", params={"q": "anything"})
    assert r.status_code == 200
    assert r.json() == {"query": "anything", "matches": [], "truncated": False}


def test_search_caps_total_matches_and_sets_truncated_flag(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """THI-220: a noisy query that produces more than 200 matches across
    all panes must cap the flat list at 200 and set `truncated=True`.
    """
    # Build 5 panes with 50 lines each = 250 lines total, all containing the needle.
    # Per-pane cap is 50 so every line is reported; total is 250 > 200.
    panes: dict[tuple[str, int], dict[str, object]] = {
        ("main", idx): {
            "pane_id": f"%{idx}",
            "window_name": f"pane{idx}",
            "lines": [f"hit line {n}" for n in range(50)],
        }
        for idx in range(5)
    }
    monkeypatch.setattr(tmux, "get_server", lambda: _make_fake_server(panes))
    monkeypatch.setattr(tmux, "capture_pane", _stub_capture(panes))

    r = client.get("/api/search", params={"q": "hit"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["matches"]) == 200, "global cap should clamp to 200"
    assert body["truncated"] is True


def test_search_truncated_is_false_when_under_the_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The truncated flag must be False when the result list fits under
    the global cap (regression guard for off-by-one)."""
    # 200 matches exactly — exactly at the cap, not over.
    panes: dict[tuple[str, int], dict[str, object]] = {
        ("main", idx): {
            "pane_id": f"%{idx}",
            "window_name": f"pane{idx}",
            "lines": [f"hit {n}" for n in range(50)],
        }
        for idx in range(4)
    }
    monkeypatch.setattr(tmux, "get_server", lambda: _make_fake_server(panes))
    monkeypatch.setattr(tmux, "capture_pane", _stub_capture(panes))

    r = client.get("/api/search", params={"q": "hit"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["matches"]) == 200
    assert body["truncated"] is False
