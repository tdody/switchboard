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
    pr: int | None = None
    ci: CIState | None = None
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
    agent: Agent | None = None
    preview: list[str] = []


class StateResponse(_CamelModel):
    sessions: list[Session]
    windows: list[Window]
    server_running: bool


class RenameSuggestion(_CamelModel):
    """One row of the auto-rename modal: the LLM's suggested name for a window,
    paired with the old name for diff rendering (THI-67)."""

    index: int
    old: str
    suggested: str


class Usage(_CamelModel):
    """Token + cost breakdown for one auto-rename call, surfaced in the modal
    footer so the user can see what they spent (THI-67)."""

    input_tokens: int
    output_tokens: int
    est_cost_usd: float


class AutoRenameResponse(_CamelModel):
    """Preview-only response — the user accepts/skips per row and the frontend
    calls the existing `/api/rename` per accepted row. Never applies a rename
    on the backend (THI-67)."""

    suggestions: list[RenameSuggestion]
    usage: Usage


AiKeySource = Literal["env", "config", "none"]


class AiStatus(_CamelModel):
    """Lightweight capability probe for the frontend: `enabled=false` hides
    the ✨ button entirely; `enabled=true` shows it.

    `source` tells the Settings panel where the key was picked up from so
    the user knows which file to edit. `masked` is a short safe-to-show
    fingerprint (first prefix + last 4 chars) — never the full key."""

    enabled: bool
    model: str
    source: AiKeySource = "none"
    masked: str | None = None
