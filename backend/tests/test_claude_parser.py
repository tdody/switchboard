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


def test_parse_prompt_numbered_prose_without_cursor_rejected() -> None:
    # Regression: chat messages with sequential numbered lists were classified
    # as menus (cursor was optional), and lines containing a mid-sentence
    # `(y/n)` / `[Y/n]` were classified as yn prompts. Both fired on this
    # repo's own assistant messages. The fixture mirrors a real Switchboard
    # PR-review chat: numbered prose, a `❯` inside one item's label (to verify
    # the cursor regex anchor is "before the number", not "anywhere on line"),
    # and `(y/n)` / `[Y/n]` mid-sentence (to verify the end-of-line anchor).
    assert claude_parser.parse_prompt(_load("claude_numbered_prose.txt")) is None


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
    assert prompt.question is not None
    assert "press enter" in prompt.question.lower()


def test_menu_prompt_makes_parse_pane_waiting() -> None:
    # A menu pane flows through parse_pane → parse_prompt and reports "waiting".
    status, pending, agent = claude_parser.parse_pane(_load("claude_menu.txt"), cwd=None)
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action == "Do you want to proceed?"


# THI-121: spinner detection missed star glyphs (✽ ✶ ✷ …) and any verb outside
# the hardcoded allowlist (Kneading, Asking, Philosophising, …). Real Claude
# panes were sliding through to status=idle. Discriminator is the trailing
# `(duration · tokens · …)` payload, which only active spinners carry.
def test_running_spinner_heavy_star_glyph_kneading() -> None:
    status, pending, agent = claude_parser.parse_pane(
        _load("claude_running_kneading.txt"), cwd=None
    )
    assert status == "running"
    assert pending is False
    assert agent is not None
    assert agent.spinner is not None and "kneading" in agent.spinner.lower()
    assert agent.duration == "1m"


def test_running_spinner_middle_dot_glyph_philosophising() -> None:
    status, pending, agent = claude_parser.parse_pane(
        _load("claude_running_philosophising.txt"), cwd=None
    )
    assert status == "running"
    assert pending is False
    assert agent is not None
    assert agent.spinner is not None and "philosophising" in agent.spinner.lower()
    assert agent.duration == "21s"


def test_spinner_without_payload_is_not_active() -> None:
    # `✻ Churned for 14s` is a one-off status note Claude shows after a tool
    # call completes — no `(time · tokens)` payload, so not an active spinner.
    lines = ["● Done. Refactor complete.", "", "✻ Churned for 14s", ""]
    status, pending, agent = claude_parser.parse_pane(lines, cwd=None)
    assert status == "idle"
    assert pending is False
    assert agent is not None
    assert agent.spinner is None


# THI-121: modern Claude menus have multi-line per-choice descriptions and a
# blank-line gap before the final choices ("Type something." / "Chat about
# this"). The contiguous-run scan collected only the bottom-most choice and
# rejected the menu, so status stayed at idle (no highlight on interaction).
def test_menu_with_multiline_descriptions_and_gaps() -> None:
    prompt = claude_parser.parse_prompt(_load("claude_menu_multiline.txt"))
    assert prompt is not None
    assert prompt.kind == "menu"
    assert [c.index for c in prompt.choices] == [1, 2, 3, 4]
    assert [c.selected for c in prompt.choices] == [True, False, False, False]
    # Choice 1's label is the first line; the indented description below is
    # NOT folded into the label.
    assert prompt.choices[0].label.startswith("Skip the partition gate entirely")
    assert prompt.choices[3].label == "Chat about this"


def test_menu_multiline_makes_parse_pane_waiting() -> None:
    status, pending, agent = claude_parser.parse_pane(_load("claude_menu_multiline.txt"), cwd=None)
    assert status == "waiting"
    assert pending is True
    assert agent is not None


# THI-126: the branch chip in the dashboard froze on the old branch for up to
# 30s after `git checkout` because the branch cache shared the PR cache's TTL.
# Split them, and pin the constants so a future tuning lands deliberately.
def test_branch_ttl_is_short_enough_for_checkout_to_feel_live() -> None:
    # 2s upper bound — within "one user-noticeable beat" after a checkout.
    # If this fails, double-check the subprocess load math (~N / TTL git
    # invocations per second under modal-open polling at 100 ms).
    assert claude_parser._BRANCH_TTL_SECONDS <= 2.0


def test_pr_ttl_stays_at_30s_to_amortize_gh_rtt() -> None:
    # PR state rarely changes and gh shells out ~1s per call. The PR cache
    # also re-keys on branch, so it adapts naturally when the user switches
    # — no reason to shorten this.
    assert claude_parser._PR_TTL_SECONDS == 30.0


def test_git_branch_cache_re_queries_after_ttl(monkeypatch) -> None:
    # End-to-end TTL boundary: a cached call within TTL stays, the next call
    # past TTL re-queries. Catches an accidental wiring of the wrong constant.
    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(list(args))
        # Return the branch baked into the side-channel (mutated below).
        from types import SimpleNamespace

        return SimpleNamespace(returncode=0, stdout=fake_run.branch + "\n", stderr="")

    fake_run.branch = "first"
    monkeypatch.setattr(claude_parser.subprocess, "run", fake_run)

    fake_clock = {"t": 0.0}
    monkeypatch.setattr(claude_parser.time, "monotonic", lambda: fake_clock["t"])

    # Isolate cache state for this test.
    claude_parser._BRANCH_CACHE.clear()

    cwd = "/tmp/repo-x"
    assert claude_parser._git_branch(cwd) == "first"
    assert len(calls) == 1
    # Within TTL: cache hit, no second subprocess.
    fake_clock["t"] = claude_parser._BRANCH_TTL_SECONDS - 0.01
    assert claude_parser._git_branch(cwd) == "first"
    assert len(calls) == 1
    # Past TTL: cache miss, re-query, observe the branch change.
    fake_run.branch = "second"
    fake_clock["t"] = claude_parser._BRANCH_TTL_SECONDS + 0.01
    assert claude_parser._git_branch(cwd) == "second"
    assert len(calls) == 2
