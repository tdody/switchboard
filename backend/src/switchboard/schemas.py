from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Status = Literal["running", "waiting", "idle", "done", "error"]
Kind = Literal["shell", "editor", "server", "agent", "logs"]
CIState = Literal["passing", "failing", "running"]
PromptKind = Literal["menu", "yn", "enter"]


class _CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class Client(_CamelModel):
    tty: str
    term: str
    since: int  # ms epoch


class Session(_CamelModel):
    id: str
    name: str
    attached: bool
    created: int  # ms epoch
    clients: list[Client] = []


class Agent(_CamelModel):
    branch: str | None = None
    spinner: str | None = None
    duration: str | None = None
    recap: str | None = None
    action: str | None = None


class PromptChoice(_CamelModel):
    index: int  # 1-based, as Claude Code numbers the menu
    label: str
    selected: bool  # the choice currently bearing the ❯ cursor


class Prompt(_CamelModel):
    kind: PromptKind
    question: str | None = None
    choices: list[PromptChoice] = []  # empty for "enter"


class Window(_CamelModel):
    id: str  # "{session}:{index}" — addressing label; changes on rename/move
    pane_id: str = ""  # tmux %N — stable for the life of the tmux server
    session: str
    index: int
    name: str
    kind: Kind
    status: Status
    last_activity: int
    cpu: float = 0.0
    mem: int = 0
    cmd: str = ""
    cwd: str = ""
    pending_input: bool = False
    # The current git branch for the pane's cwd, if it is inside a repo. Shown
    # as a chip on every pane — not just agent ones — so shell users can see at
    # a glance which branch a terminal is sitting on (THI-126 follow-up). For
    # agent panes this is the same value mirrored on `agent.branch`.
    branch: str | None = None
    # PR number + CI rollup for the pane's `branch`, looked up via `gh pr view`
    # in tmux.py. Lifted out of Agent (previously THI-115) so shell panes
    # sitting on a branch with an open PR also get the CI-tinted chip — same
    # symmetry as `branch` after THI-126. None for panes without a branch or
    # whose branch has no PR.
    pr: int | None = None
    ci: CIState | None = None
    agent: Agent | None = None
    preview: list[str] = []


class StateResponse(_CamelModel):
    sessions: list[Session]
    windows: list[Window]
    server_running: bool


class ClaudeUsage(_CamelModel):
    """Token totals scraped from the rolling window of `~/.claude/projects/*.jsonl`
    session logs. The plan's 5 h reset fires `window_hours` after the *earliest*
    in-window message — see `services/claude_usage.compute_claude_usage` for the
    aggregation contract (THI-110)."""

    available: bool
    window_hours: float = 5.0
    messages: int = 0
    input_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    reset_at: int | None = None  # unix epoch seconds; None when no in-window record


class UsageMeter(_CamelModel):
    """One row of the `claude /usage` TUI screen — session / week-all / week-Sonnet.
    Populated only when the optional scrape is enabled (THI-110, deferred to commit 2)."""

    label: str
    percent: int
    resets: str  # human string carried verbatim from the TUI, e.g. "in 3h 22m"


class UsageScrape(_CamelModel):
    """Plan percentages scraped from `claude /usage`. Optional, opt-in."""

    available: bool
    meters: dict[str, UsageMeter] = {}


class UsageResponse(_CamelModel):
    tokens: ClaudeUsage
    scrape: UsageScrape | None = None


class UsageConfig(_CamelModel):
    """Read-only knobs the Settings panel surfaces for the Claude usage pill
    (THI-110 commit 3). Both TTL knobs are server-startup config — toggling
    them at runtime would force-clear caches, which isn't worth the
    complexity for a personal dev tool."""

    scrape_enabled: bool
    scrape_ttl_s: float
    token_ttl_s: float
