import pytest
from pydantic import BaseModel, ValidationError

from switchboard.schemas import Prompt, PromptChoice, TmuxName, Window

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


# ---------------------------------------------------------------------------
# THI-170 / sec:M7 — TmuxName accepts realistic names, rejects flag injection
# ---------------------------------------------------------------------------


class _TmuxNameModel(BaseModel):
    name: TmuxName


@pytest.mark.parametrize(
    "name",
    [
        "dev",
        "feature-123",
        "api / web",
        "test_v2",
        "switchboard",
        "a" * 64,  # at max length
    ],
)
def test_tmux_name_accepts_realistic(name):
    assert _TmuxNameModel(name=name).name == name


@pytest.mark.parametrize(
    "name",
    [
        "-Xkill-server",  # leading dash (flag injection)
        "--help",
        "-F",
        "",  # empty
        "a" * 65,  # over max length
        "foo\nbar",  # newline
        "foo\x00bar",  # NUL
        "foo\x1bbar",  # ESC (terminal escape)
    ],
)
def test_tmux_name_rejects_dangerous(name):
    with pytest.raises(ValidationError):
        _TmuxNameModel(name=name)
