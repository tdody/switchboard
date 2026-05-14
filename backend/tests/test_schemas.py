from switchboard.schemas import Window, Prompt, PromptChoice

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
