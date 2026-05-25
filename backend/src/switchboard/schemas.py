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
