import logging

from fastapi.testclient import TestClient

from switchboard import logconfig
from switchboard.config import settings
from switchboard.main import create_app

BASE_URL = "http://127.0.0.1:8765"


def _record(msg: str = "hello", **kw) -> logging.LogRecord:
    return logging.LogRecord(
        name=kw.get("name", "switchboard.test"),
        level=kw.get("level", logging.INFO),
        pathname=__file__,
        lineno=1,
        msg=msg,
        args=(),
        exc_info=kw.get("exc_info"),
    )


def test_new_request_id_is_8_hex_and_unique():
    a, b = logconfig.new_request_id(), logconfig.new_request_id()
    assert len(a) == 8 and len(b) == 8
    assert all(c in "0123456789abcdef" for c in a)
    assert a != b


def test_formatter_basic_fields():
    out = logconfig.KeyValueFormatter().format(_record("a thing happened"))
    assert "level=INFO" in out
    assert "logger=switchboard.test" in out
    assert "msg='a thing happened'" in out
    # no request scope → no req=/scope= keys
    assert "req=" not in out
    assert "scope=" not in out


def test_formatter_includes_request_id_and_scope():
    rid_token = logconfig.request_id.set("abcd1234")
    tag_token = logconfig.scope_tag.set("ws main:0")
    try:
        rec = _record("streaming")
        logconfig.ContextFilter().filter(rec)
        out = logconfig.KeyValueFormatter().format(rec)
        assert "req=abcd1234" in out
        assert "scope='ws main:0'" in out
    finally:
        logconfig.request_id.reset(rid_token)
        logconfig.scope_tag.reset(tag_token)


def test_formatter_appends_exception():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        rec = _record("failed", exc_info=sys.exc_info())
    out = logconfig.KeyValueFormatter().format(rec)
    assert "msg='failed'" in out
    assert "ValueError: boom" in out
    assert "Traceback" in out


def test_context_filter_attaches_empty_defaults():
    rec = _record()
    logconfig.ContextFilter().filter(rec)
    assert rec.request_id == ""
    assert rec.scope_tag == ""


def test_request_id_header_present(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "host", "127.0.0.1")
    monkeypatch.setattr(settings, "auth_required", None)
    monkeypatch.setattr(settings, "token_file", tmp_path / "token")
    with TestClient(create_app(), base_url=BASE_URL) as client:
        r = client.get("/healthz")
        assert r.status_code == 200
        rid = r.headers.get("x-request-id")
        assert rid and len(rid) == 8
        # a second request gets a distinct id
        r2 = client.get("/healthz")
        assert r2.headers.get("x-request-id") != rid
