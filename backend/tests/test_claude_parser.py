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


def test_parse_prompt_typed_numbered_list_in_input_box_rejected() -> None:
    # Regression: when the user types a numbered list (`1. AAAA`, `2. BBB`,
    # `3. CCC`) into Claude Code's input box, the input prompt `>` on the
    # first line satisfied the "at least one cursor" guard from THI-104 and
    # the parser misfired the menu overlay. The candidate menu sits inside
    # the input box, surrounded by a horizontal `────` separator below and
    # the `? for shortcuts` footer — neither appears around a real menu.
    assert claude_parser.parse_prompt(_load("claude_typing_numbered_list.txt")) is None


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


# THI-126 follow-up: Window.branch is a top-level field so shell panes — not
# just agents — can show a branch chip. The schema lets the field carry
# independently of `agent`, which is None for shell panes.
def test_window_branch_can_carry_without_agent() -> None:
    from switchboard.schemas import Window

    w = Window(
        id="main:0",
        session="main",
        index=0,
        name="zsh",
        kind="shell",
        status="idle",
        last_activity=0,
        branch="thibaultdody/feature-x",
        agent=None,
    )
    assert w.branch == "thibaultdody/feature-x"
    assert w.agent is None


# THI-115 lift: `pr` + `ci` are top-level Window fields (not Agent), so shell
# panes sitting on a branch with an open PR get the CI-tinted chip too —
# symmetric to `branch` post-THI-126. Pin both the schema shape and that the
# fields default to None.
def test_window_pr_ci_can_carry_on_shell_pane() -> None:
    from switchboard.schemas import Window

    w = Window(
        id="main:0",
        session="main",
        index=0,
        name="zsh",
        kind="shell",
        status="idle",
        last_activity=0,
        branch="thibaultdody/feature-x",
        pr=42,
        ci="passing",
        agent=None,
    )
    assert w.pr == 42
    assert w.ci == "passing"
    assert w.agent is None


def test_window_pr_ci_default_to_none() -> None:
    from switchboard.schemas import Window

    w = Window(
        id="main:0",
        session="main",
        index=0,
        name="zsh",
        kind="shell",
        status="idle",
        last_activity=0,
    )
    assert w.pr is None
    assert w.ci is None


# Parse-pane no longer reaches out to gh — pr/ci are populated by tmux.py at
# the Window level. The Agent it returns is purely terminal-content derived,
# so it must not carry `pr` / `ci` attributes at all (would mean the lift
# didn't actually move them off Agent).
def test_parse_pane_agent_has_no_pr_or_ci_fields() -> None:
    from switchboard.schemas import Agent

    assert "pr" not in Agent.model_fields
    assert "ci" not in Agent.model_fields


def test_git_branch_returns_none_for_empty_cwd() -> None:
    # The tmux.py loop passes `cwd` straight through; an empty pane cwd must
    # short-circuit to None rather than shelling out with no -C.
    assert claude_parser._git_branch(None) is None
    assert claude_parser._git_branch("") is None


# Regression guard: `gh pr view` takes the branch as a positional. An earlier
# version passed it via `--head` and gh exited "unknown flag" on every call,
# silently caching (None, None) — the modal-header chip never got its CI tint.
def test_gh_pr_passes_branch_as_positional_and_parses_passing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, list[str]] = {}

    class FakeProc:
        returncode = 0
        stdout = (
            '{"number": 32, '
            '"url": "https://github.com/tdody/switchboard/pull/32", '
            '"statusCheckRollup": ['
            '{"name": "Backend", "conclusion": "SUCCESS"}, '
            '{"name": "Frontend", "conclusion": "SUCCESS"}'
            "]}"
        )

    def fake_run(argv: list[str], **_kwargs: object) -> FakeProc:
        captured["argv"] = argv
        return FakeProc()

    monkeypatch.setattr(claude_parser.subprocess, "run", fake_run)
    monkeypatch.setattr(claude_parser, "_PR_CACHE", {})

    pr, ci, url = claude_parser._gh_pr("/some/repo", "thibaultdody/feature-x")

    # Pin the argv shape — `gh pr view <branch>`, NOT `--head <branch>`.
    assert captured["argv"][:3] == ["gh", "pr", "view"]
    assert "thibaultdody/feature-x" in captured["argv"]
    assert "--head" not in captured["argv"]
    # `url` must be in the `--json` field list so the frontend can light up
    # the PR chip as a link (THI-146 PR 2).
    json_idx = captured["argv"].index("--json")
    assert "url" in captured["argv"][json_idx + 1]
    assert pr == 32
    assert ci == "passing"
    assert url == "https://github.com/tdody/switchboard/pull/32"


def test_gh_pr_failing_when_any_check_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeProc:
        returncode = 0
        stdout = (
            '{"number": 7, '
            '"url": "https://github.com/o/r/pull/7", '
            '"statusCheckRollup": ['
            '{"name": "A", "conclusion": "SUCCESS"}, '
            '{"name": "B", "conclusion": "FAILURE"}'
            "]}"
        )

    monkeypatch.setattr(claude_parser.subprocess, "run", lambda *_a, **_k: FakeProc())
    monkeypatch.setattr(claude_parser, "_PR_CACHE", {})

    pr, ci, url = claude_parser._gh_pr("/some/repo", "branch-y")
    assert (pr, ci, url) == (7, "failing", "https://github.com/o/r/pull/7")


def test_gh_pr_returns_none_on_gh_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeProc:
        returncode = 1
        stdout = ""

    monkeypatch.setattr(claude_parser.subprocess, "run", lambda *_a, **_k: FakeProc())
    monkeypatch.setattr(claude_parser, "_PR_CACHE", {})

    assert claude_parser._gh_pr("/some/repo", "no-pr-branch") == (None, None, None)


# ---------------------------------------------------------------------------
# THI-171 / sec:M8 — reject dash-prefixed branches; use -- separator on gh
# ---------------------------------------------------------------------------


def test_gh_pr_rejects_dash_prefixed_branch_without_shelling_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`gh pr view -R evil/repo` would be interpreted as a flag. A branch
    literally named `-R evil/repo` (or `--help`) must never reach gh."""
    calls: list[list[str]] = []

    def fake_run(argv: list[str], **_kwargs: object) -> object:
        calls.append(argv)
        raise AssertionError("subprocess should not have been called")

    monkeypatch.setattr(claude_parser.subprocess, "run", fake_run)
    monkeypatch.setattr(claude_parser, "_PR_CACHE", {})

    assert claude_parser._gh_pr("/some/repo", "-R evil/repo") == (None, None, None)
    assert claude_parser._gh_pr("/some/repo", "--help") == (None, None, None)
    assert calls == []


def test_gh_pr_argv_uses_dash_dash_separator_before_branch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defense in depth — even after the leading-dash filter, the branch is
    passed after `--` so a legitimate branch like `--foo-feature` (unusual
    but legal) can't be misparsed as a flag."""
    captured: dict[str, list[str]] = {}

    class FakeProc:
        returncode = 1
        stdout = ""

    def fake_run(argv: list[str], **_kwargs: object) -> FakeProc:
        captured["argv"] = argv
        return FakeProc()

    monkeypatch.setattr(claude_parser.subprocess, "run", fake_run)
    monkeypatch.setattr(claude_parser, "_PR_CACHE", {})

    claude_parser._gh_pr("/some/repo", "thibaultdody/feature-x")
    argv = captured["argv"]
    # The branch must appear AFTER `--`.
    assert "--" in argv
    sep_idx = argv.index("--")
    assert argv[sep_idx + 1] == "thibaultdody/feature-x"


def test_git_branch_drops_dash_prefixed_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    """If `git rev-parse` reports a branch named `-X`, _git_branch returns
    None rather than propagating it to downstream callers (e.g. _gh_pr)."""

    class FakeProc:
        returncode = 0
        stdout = "-Xkill-server\n"

    monkeypatch.setattr(claude_parser.subprocess, "run", lambda *_a, **_k: FakeProc())
    monkeypatch.setattr(claude_parser, "_BRANCH_CACHE", {})

    assert claude_parser._git_branch("/some/repo") is None


# THI-146 PR 2: `_normalize_git_remote` powers the in-pane `PR #N` linkifier.
# It maps the common origin URL shapes onto a canonical `https://host/owner/repo`
# string the frontend can append `/pull/N` to.
@pytest.mark.parametrize(
    "remote,expected",
    [
        ("git@github.com:tdody/switchboard.git", "https://github.com/tdody/switchboard"),
        ("git@github.com:tdody/switchboard", "https://github.com/tdody/switchboard"),
        ("https://github.com/tdody/switchboard.git", "https://github.com/tdody/switchboard"),
        ("https://github.com/tdody/switchboard", "https://github.com/tdody/switchboard"),
        ("ssh://git@github.com/tdody/switchboard.git", "https://github.com/tdody/switchboard"),
        # GHE-style host
        ("git@ghe.github.com:org/repo.git", "https://ghe.github.com/org/repo"),
        # Not github — gitlab uses /-/merge_requests/N, opening /pull/N would 404.
        ("git@gitlab.com:owner/repo.git", None),
        ("https://bitbucket.org/owner/repo.git", None),
        # Junk
        ("", None),
        ("not-a-remote", None),
        ("git@github.com:onlyone.git", None),
    ],
)
def test_normalize_git_remote(remote: str, expected: str | None) -> None:
    assert claude_parser._normalize_git_remote(remote) == expected


def test_git_repo_url_runs_git_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    class FakeProc:
        returncode = 0
        stdout = "git@github.com:tdody/switchboard.git\n"

    def fake_run(argv: list[str], **_kwargs: object) -> FakeProc:
        calls.append(argv)
        return FakeProc()

    monkeypatch.setattr(claude_parser.subprocess, "run", fake_run)
    monkeypatch.setattr(claude_parser, "_REPO_URL_CACHE", {})

    first = claude_parser._git_repo_url("/some/repo")
    second = claude_parser._git_repo_url("/some/repo")

    assert first == "https://github.com/tdody/switchboard"
    assert second == first
    # The 5-min cache means the second call must not shell out again.
    assert len(calls) == 1
    assert calls[0][:5] == ["git", "-C", "/some/repo", "remote", "get-url"]


def test_git_repo_url_returns_none_on_git_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeProc:
        returncode = 128
        stdout = ""

    monkeypatch.setattr(claude_parser.subprocess, "run", lambda *_a, **_k: FakeProc())
    monkeypatch.setattr(claude_parser, "_REPO_URL_CACHE", {})

    assert claude_parser._git_repo_url("/not/a/repo") is None


# THI-131: per-agent context% accent. `_scan_context_pct` reads the Claude Code
# TUI footer in three phrasings (brain-emoji status bar, `Context: NN%` text,
# `context window used: NN%` legacy) bottom-up so the freshest reading wins.
# parse_pane threads the result into Agent.contextPct.
def test_scan_context_pct_brain_emoji_phrasing() -> None:
    # Modern Claude Code status bar: brain emoji + Block Elements bar + percent.
    # Captured from a real `tmux capture-pane` while debugging THI-131.
    line = (
        "📁 frontend 🌿 thibaultdody/thi-131-usage-coloring  |  "
        "🧠 █░░░░░░░░░ 16% 📨 6 📤 542 | session: 155.4k in / 542 out "
        "💰 $8.33 🤖 opus  ⏵⏵ auto mode on (shift+tab to cycle) · PR #42"
    )
    assert claude_parser._scan_context_pct([line]) == 16


def test_scan_context_pct_brain_emoji_full_bar() -> None:
    # All-full bar (10x █) at high context. Confirms the bar-char class covers
    # the full Block Elements range, not just the partial-fill characters.
    assert claude_parser._scan_context_pct(["🧠 ██████████ 97%"]) == 97


def test_scan_context_pct_modern_phrasing() -> None:
    assert claude_parser._scan_context_pct(["Context: 73% (~144k / 200k tokens)"]) == 73


def test_scan_context_pct_legacy_phrasing() -> None:
    assert claude_parser._scan_context_pct(["(200k context window used: 12%)"]) == 12


def test_scan_context_pct_zero_is_valid() -> None:
    # 0% must be treated as a real reading, not as "missing" — the band helper
    # maps 0 to ctx-low. Test a tail with a recap-style line above it so the
    # scanner has to walk past non-matching content first.
    assert claude_parser._scan_context_pct(["⏵⏵ accept edits", "Context: 0%"]) == 0


def test_scan_context_pct_out_of_range_returns_none() -> None:
    # Corrupt capture: `101%` is impossible. Guard rejects it, and with no
    # other Context line in the tail, the scanner returns None.
    assert claude_parser._scan_context_pct(["Context: 101%"]) is None


def test_scan_context_pct_no_match_returns_none() -> None:
    assert claude_parser._scan_context_pct(["no context line here"]) is None


def test_scan_context_pct_most_recent_wins() -> None:
    # Bottom-up scan: the freshest `Context:` line — the one closest to the
    # tail — wins over a stale reading that scrolled up earlier.
    lines = ["Context: 50%", *(["padding"] * 80), "Context: 22%"]
    # Only the last 30 lines are scanned; pad with "Context: 22%" near the tail.
    tail = ["Context: 50%", *(["padding"] * 28), "Context: 22%"]
    assert claude_parser._scan_context_pct(tail) == 22
    # Sanity: the long-tail variant also resolves to 22 (it sits inside the
    # 30-line window because it's the very last line).
    assert claude_parser._scan_context_pct(lines) == 22


def test_scan_context_pct_strips_ansi() -> None:
    # ANSI color codes wrap the Context footer in real captures. The scanner
    # strips them before applying the regex.
    assert claude_parser._scan_context_pct(["\x1b[2mContext: 41%\x1b[0m"]) == 41


def test_parse_pane_threads_context_pct_into_agent() -> None:
    # End-to-end: parse_pane includes context_pct on the Agent payload, and the
    # `to_camel` alias generator serializes it as `contextPct` over the wire.
    lines = [
        "● Done. Refactor complete.",
        "Context: 64% (~128k / 200k tokens)",
    ]
    _, _, agent = claude_parser.parse_pane(lines, cwd=None)
    assert agent is not None
    assert agent.context_pct == 64
    # Pin the wire shape — Agent serializes the field as `contextPct`.
    assert agent.model_dump(by_alias=True)["contextPct"] == 64


def test_parse_pane_context_pct_none_when_absent() -> None:
    _, _, agent = claude_parser.parse_pane(["● Done."], cwd=None)
    assert agent is not None
    assert agent.context_pct is None


# THI-139: per-agent session cost. `_scan_session_cost` reads the `💰 $X.XX`
# marker from the Claude Code TUI status line (the same figure Claude shows
# inside each pane) and the frontend sums these across visible agent panes
# for the header usage pill.
def test_scan_session_cost_modern_status_line() -> None:
    # Real captured status line: 💰 lives between session counters and the
    # model name. Scanner returns it as a float regardless of surrounding
    # emojis / counters.
    line = (
        "📁 frontend 🌿 thibaultdody/thi-139  |  "
        "🧠 █░░░░░░░░░ 16% 📨 6 📤 542 | session: 155.4k in / 542 out "
        "💰 $8.33 🤖 opus  ⏵⏵ auto mode on"
    )
    assert claude_parser._scan_session_cost([line]) == 8.33


def test_scan_session_cost_no_decimal() -> None:
    # A round number is rare but should parse cleanly.
    assert claude_parser._scan_session_cost(["💰 $42"]) == 42.0


def test_scan_session_cost_with_thousands_comma() -> None:
    # Defensive: if Claude ever uses thousands separators (some locales /
    # future versions might), parse them too rather than silently truncating.
    assert claude_parser._scan_session_cost(["💰 $1,234.56"]) == 1234.56


def test_scan_session_cost_most_recent_wins() -> None:
    # Bottom-up scan: the freshest 💰 line wins over an earlier reading.
    lines = ["💰 $1.00", "(filler)", "💰 $7.42"]
    assert claude_parser._scan_session_cost(lines) == 7.42


def test_scan_session_cost_strips_ansi() -> None:
    # Real captures wrap the status line in dim/colour ANSI sequences.
    assert claude_parser._scan_session_cost(["\x1b[2m💰 $5.25\x1b[0m"]) == 5.25


def test_scan_session_cost_returns_none_when_absent() -> None:
    # Fresh session before the first billed turn — no 💰 marker yet.
    assert claude_parser._scan_session_cost(["just a chat line"]) is None


def test_parse_pane_threads_session_cost_into_agent() -> None:
    # End-to-end: parse_pane includes session_cost_usd on the Agent payload
    # and the `to_camel` alias generator serializes it as `sessionCostUsd`.
    lines = [
        "● Done.",
        "💰 $3.27 🤖 opus",
    ]
    _, _, agent = claude_parser.parse_pane(lines, cwd=None)
    assert agent is not None
    assert agent.session_cost_usd == 3.27
    assert agent.model_dump(by_alias=True)["sessionCostUsd"] == 3.27


def test_parse_pane_session_cost_none_when_absent() -> None:
    _, _, agent = claude_parser.parse_pane(["● Done."], cwd=None)
    assert agent is not None
    assert agent.session_cost_usd is None


# THI-148: free-form question detection. The pre-148 parser only flagged the
# three structured shapes (menu, y/n, press-enter). Real Claude often ends a
# turn with a plain `?` question or an imperative "let me know" — the user
# was waiting on the model with no notification firing (THI-78 keys off
# pendingInput). `_scan_open_question` covers both gaps.
def test_open_question_simple_qmark_makes_pane_waiting() -> None:
    status, pending, agent = claude_parser.parse_pane(_load("claude_open_question.txt"), cwd=None)
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action is not None
    assert agent.action.lower().endswith("?")
    assert "prefer" in agent.action.lower()


def test_open_question_multiline_picks_last_line_not_recap() -> None:
    # The recap (first `●` line) is "I checked the logs and noticed …"; the
    # actual question lives on the LAST narration line. _scan_open_question
    # must walk to the visible bottom of the block, not stop at the marker.
    status, pending, agent = claude_parser.parse_pane(
        _load("claude_open_question_multiline.txt"), cwd=None
    )
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action is not None
    assert "approach would you prefer" in agent.action.lower()


def test_open_question_trailing_quote_is_detected() -> None:
    # `did you mean "make faster"?` — the `?` is followed by no other char,
    # but quoted phrases earlier on the line should not confuse the regex.
    status, pending, agent = claude_parser.parse_pane(
        _load("claude_open_question_quoted.txt"), cwd=None
    )
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action is not None
    assert "make faster" in agent.action.lower()


def test_open_question_letmeknow_phrase_makes_pane_waiting() -> None:
    # Imperative ask without `?` — Claude defers to the user via "let me
    # know". The phrase whitelist must catch this.
    status, pending, agent = claude_parser.parse_pane(
        _load("claude_open_question_letmeknow.txt"), cwd=None
    )
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action is not None
    assert "let me know" in agent.action.lower()


def test_open_question_skips_tool_output_qmark() -> None:
    # The visible last line is `⎿  Did not find any relation named "users?"`
    # — ends in `?` but is tool output, not Claude prose. Must stay idle.
    status, pending, _ = claude_parser.parse_pane(_load("claude_tool_output_qmark.txt"), cwd=None)
    assert status == "idle"
    assert pending is False


def test_open_question_skips_tool_call_qmark() -> None:
    # A bare `Bash(...)` ending in `?` (no `⎿` output yet) is a tool call,
    # not a question. Stay idle.
    lines = [
        "● Let me check.",
        "",
        '  Bash(grep -r "TODO?" src)',
        "",
        "────────────────────────────",
        ">",
        "────────────────────────────",
    ]
    status, pending, _ = claude_parser.parse_pane(lines, cwd=None)
    assert status == "idle"
    assert pending is False


def test_open_question_substrings_do_not_false_positive() -> None:
    # "letting you know" / "prior knowledge" both contain substrings that
    # naively-anchored phrase regexes would catch. Word boundaries must
    # keep this idle.
    status, pending, _ = claude_parser.parse_pane(
        _load("claude_narration_substrings_false_positive.txt"), cwd=None
    )
    assert status == "idle"
    assert pending is False


def test_open_question_suppressed_by_active_spinner() -> None:
    # A `?`-ending narration line plus an active spinner means Claude is
    # still working — spinner override wins. status=running, pending=False.
    lines = [
        "● Should I keep the simpler path?",
        "",
        "✻ Reconsidering… (5s · ↓ 1k tokens)",
        "",
        "────────────────────────────",
        ">",
        "────────────────────────────",
    ]
    status, pending, agent = claude_parser.parse_pane(lines, cwd=None)
    assert status == "running"
    assert pending is False
    assert agent is not None
    assert agent.action is None  # spinner clears action


def test_open_question_not_emitted_via_parse_prompt() -> None:
    # parse_prompt drives the WS overlay (PromptOverlay.tsx). Open questions
    # have no overlay action — they belong in pending_input + agent.action
    # only. So parse_prompt must still return None for an open-question pane.
    assert claude_parser.parse_prompt(_load("claude_open_question.txt")) is None
    assert claude_parser.parse_prompt(_load("claude_open_question_letmeknow.txt")) is None


def test_yn_prompt_wins_over_open_question_detection() -> None:
    # `(y/n)` ends the same line that also ends with `?`. The structured
    # yn detector must still win — parse_prompt is checked before the open-
    # question scanner.
    status, pending, agent = claude_parser.parse_pane(_load("claude_waiting.txt"), cwd=None)
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action is not None
    # yn detector preserves the `(y/n)` marker in action; open-question scan
    # would have trimmed everything past the `?`.
    assert "(y/n)" in agent.action.lower()


# Modern Claude Code builds render the assistant-message bullet as ⏺
# (U+23FA, BLACK CIRCLE FOR RECORD) instead of the legacy ● (U+25CF).
# They also paint a status footer below the prompt box (`? for shortcuts
# ... Context: N%`) that the post-THI-148 scanner mistook for narration:
# the footer became block[0], displacing the actual question above the
# box, and pending_input stayed false — THI-78 notification, Kanban
# "Pending input" badge, and waiting chip all missed the event.
def test_open_question_modern_record_marker_with_footer() -> None:
    status, pending, agent = claude_parser.parse_pane(
        _load("claude_open_question_modern_marker_with_footer.txt"), cwd=None
    )
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action is not None
    assert agent.action.lower().endswith("?")
    assert "interesting problem" in agent.action.lower()


def test_recap_recognizes_modern_record_marker() -> None:
    # `_RECAP_RE` only recognised ●/✓/✗ before the modern-marker fix, so
    # recap silently returned None for every modern pane.
    _, _, agent = claude_parser.parse_pane(_load("claude_idle_modern_marker.txt"), cwd=None)
    assert agent is not None
    assert agent.recap is not None
    assert "refactor" in agent.recap.lower()


def test_open_question_skips_turn_timing_note() -> None:
    # Modern Claude Code prints `✻ Worked for 2s` (and `Churned`/`Pondered`
    # variants) below the assistant message after some turns end. Same
    # spinner-glyph family as a live spinner but with no `(N · …)` payload —
    # it's a one-off timing note, not prose. Without skipping it the note
    # became block[0] in `_scan_open_question` and displaced the actual `?`
    # question above it; pending_input stayed False and the THI-78 native
    # notification missed the canonical "Claude asks a free-form question"
    # manual test.
    status, pending, agent = claude_parser.parse_pane(
        _load("claude_open_question_with_turn_timing.txt"), cwd=None
    )
    assert status == "waiting"
    assert pending is True
    assert agent is not None
    assert agent.action is not None
    assert "should i commit" in agent.action.lower()
