from pathlib import Path

import pytest

from switchboard.services import claude_parser

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> list[str]:
    return (FIXTURES / name).read_text().splitlines()


def test_waiting_yn_prompt() -> None:
    status, pending, agent = claude_parser.parse_pane(_load("claude_waiting.txt"), cwd=None)
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.recap is not None
    assert "test" in agent.recap.lower() or "migration" in agent.recap.lower()
    assert agent.action is not None
    assert "(y/n)" in agent.action.lower() or "investigate" in agent.action.lower()


def test_running_with_spinner() -> None:
    status, pending, agent = claude_parser.parse_pane(_load("claude_running.txt"), cwd=None)
    assert status == "running"
    assert pending is False
    assert agent is not None
    assert agent.spinner is not None
    assert "synthesizing" in agent.spinner.lower()
    assert agent.duration == "2m"


def test_idle_with_recap() -> None:
    status, pending, agent = claude_parser.parse_pane(_load("claude_idle.txt"), cwd=None)
    assert status == "idle"
    assert pending is False
    assert agent is not None
    assert agent.recap is not None
    assert "done" in agent.recap.lower() or "refactor" in agent.recap.lower()


def test_press_enter_prompt_is_waiting() -> None:
    status, pending, agent = claude_parser.parse_pane(_load("claude_pressenter.txt"), cwd=None)
    assert status == "waiting"
    assert pending is True
    assert agent is not None


def test_empty_lines_returns_idle() -> None:
    status, pending, agent = claude_parser.parse_pane([], cwd=None)
    assert status == "idle"
    assert pending is False
    assert agent is not None  # branch/PR/etc may still be None, but the dict exists


@pytest.mark.parametrize(
    "duration_str,expected",
    [("1m 56s", "1m"), ("47s", "47s"), ("3h 12m", "3h"), ("2m 14s", "2m")],
)
def test_duration_parsing(duration_str: str, expected: str) -> None:
    # Build a synthetic spinner line.
    line = f"✻ Thinking… ({duration_str} · ↓ 1.2k tokens)"
    _, _, agent = claude_parser.parse_pane([line], cwd=None)
    assert agent is not None
    assert agent.duration == expected


def test_parse_prompt_menu_cursor_on_first() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_menu.txt"))
    assert prompt is not None
    assert prompt.kind == "menu"
    assert prompt.question == "Do you want to proceed?"
    assert [c.index for c in prompt.choices] == [1, 2, 3]
    assert [c.label for c in prompt.choices] == [
        "Yes",
        "Yes, and don't ask again for rm commands in this project",
        "No, and tell Claude what to do differently (esc)",
    ]
    assert [c.selected for c in prompt.choices] == [True, False, False]


def test_parse_prompt_menu_cursor_on_second() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_menu_cursor2.txt"))
    assert prompt is not None
    assert prompt.kind == "menu"
    assert [c.selected for c in prompt.choices] == [False, True, False]


def test_parse_prompt_menu_redraw_rejected() -> None:
    # Non-sequential numbering (1. not yet drawn) must not be treated as a menu.
    assert claude_parser.parse_prompt(_load("claude_menu_redraw.txt")) is None


def test_parse_prompt_no_prompt_returns_none() -> None:
    assert claude_parser.parse_prompt(_load("claude_idle.txt")) is None


def test_parse_prompt_menu_no_question() -> None:
    # A menu with no question line above the choices: question degrades to None,
    # not the box border line.
    prompt = claude_parser.parse_prompt(_load("claude_menu_no_question.txt"))
    assert prompt is not None
    assert prompt.kind == "menu"
    assert prompt.question is None
    assert [c.index for c in prompt.choices] == [1, 2]
    assert [c.selected for c in prompt.choices] == [True, False]


def test_parse_prompt_yn() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_waiting.txt"))
    assert prompt is not None
    assert prompt.kind == "yn"
    assert prompt.choices == []
    assert prompt.question is not None
    assert "(y/n)" in prompt.question.lower()


def test_parse_prompt_enter() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_pressenter.txt"))
    assert prompt is not None
    assert prompt.kind == "enter"
    assert prompt.choices == []
