from switchboard.schemas import Window

_BASE = {
    "id": "main:0",
    "session": "main",
    "index": 0,
    "name": "shell",
    "kind": "shell",
    "status": "idle",
    "last_activity": 0,
}


def test_window_pane_id_serializes_as_camelcase():
    w = Window(**_BASE, pane_id="%5")
    dumped = w.model_dump(by_alias=True)
    assert dumped["paneId"] == "%5"
    assert dumped["id"] == "main:0"


def test_window_pane_id_defaults_empty():
    w = Window(**_BASE)
    assert w.pane_id == ""
