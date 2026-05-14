from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Status = Literal["running", "waiting", "idle", "done", "error"]
Kind = Literal["shell", "editor", "server", "agent", "logs"]
CIState = Literal["passing", "failing", "running"]


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


class Window(_CamelModel):
    id: str  # "{session}:{index}"
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
