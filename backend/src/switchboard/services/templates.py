"""Session templates (THI-99).

A template describes one tmux session, its windows, and what to start in
each window. Users put JSON files in `~/.switchboard/templates/*.json`;
a small set of built-ins ships in this module so the feature has value out
of the box.

`${VAR}` substitution lets templates be parameterized — the dashboard
collects values from the user at instantiation time.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel

from switchboard.services import tmux

log = logging.getLogger(__name__)

_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class TemplateWindow(BaseModel):
    """One window in a template. `cwd` becomes `tmux -c`; `cmd` is sent to
    the pane as keys + Enter after the window is created."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    name: str
    cwd: str | None = None
    cmd: str | None = None


class Template(BaseModel):
    """A bootstrap recipe for a single tmux session."""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    name: str
    session: str
    windows: list[TemplateWindow] = Field(default_factory=list)


def _user_templates_dir() -> Path:
    """Path holding user JSON templates. Wrapped in a function so tests can
    monkeypatch the location."""
    return Path.home() / ".switchboard" / "templates"


def extract_variables(template: Template) -> list[str]:
    """Find every `${VAR}` referenced by a template's session name or any
    window's name/cwd/cmd. Returned deduped + sorted for a stable form UI."""
    found: set[str] = set()

    def scan(s: str | None) -> None:
        if not s:
            return
        found.update(_VAR_RE.findall(s))

    scan(template.session)
    for w in template.windows:
        scan(w.name)
        scan(w.cwd)
        scan(w.cmd)
    return sorted(found)


def substitute(s: str, variables: dict[str, str]) -> str:
    """Replace `${VAR}` with `variables[VAR]`. Unknown vars pass through —
    the user sees the literal `${...}` in their shell, which is louder than
    a silent empty string."""

    def repl(m: re.Match[str]) -> str:
        return variables.get(m.group(1), m.group(0))

    return _VAR_RE.sub(repl, s)


def _substitute_window(w: TemplateWindow, variables: dict[str, str]) -> TemplateWindow:
    return TemplateWindow(
        name=substitute(w.name, variables),
        cwd=substitute(w.cwd, variables) if w.cwd else None,
        cmd=substitute(w.cmd, variables) if w.cmd else None,
    )


def load_user_templates() -> list[Template]:
    """Walk the user's templates dir, parse each `*.json` file as a
    Template. Skip (with a warning) anything malformed."""
    tdir = _user_templates_dir()
    if not tdir.exists():
        return []
    out: list[Template] = []
    for path in sorted(tdir.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            out.append(Template(**data))
        except (OSError, json.JSONDecodeError, ValidationError) as e:
            log.warning("ignoring invalid template %s: %s", path.name, e)
    return out


# Built-ins. Keep the list small and opinionated — users who want
# something else can drop their own JSON in `~/.switchboard/templates/`.
BUILTINS: list[Template] = [
    Template(
        name="web-project",
        session="${REPO_NAME}",
        windows=[
            TemplateWindow(name="dev", cwd="${REPO_PATH}", cmd="pnpm dev"),
            TemplateWindow(name="tests", cwd="${REPO_PATH}", cmd="pnpm test --watch"),
            TemplateWindow(name="editor", cwd="${REPO_PATH}", cmd="nvim ."),
            TemplateWindow(name="shell", cwd="${REPO_PATH}"),
        ],
    ),
    Template(
        name="agent-grid",
        session="${SESSION}",
        windows=[
            TemplateWindow(name="claude-1", cwd="${CWD}", cmd="claude"),
            TemplateWindow(name="claude-2", cwd="${CWD}", cmd="claude"),
            TemplateWindow(name="claude-3", cwd="${CWD}", cmd="claude"),
            TemplateWindow(name="claude-4", cwd="${CWD}", cmd="claude"),
        ],
    ),
]


def list_templates() -> list[Template]:
    """All templates available to the dashboard: built-ins first, then user."""
    return [*BUILTINS, *load_user_templates()]


def find_template(name: str) -> Template | None:
    """Lookup by name across built-ins and user templates."""
    return next((t for t in list_templates() if t.name == name), None)


def instantiate(template: Template, variables: dict[str, str]) -> tuple[bool, str]:
    """Create the tmux session described by `template`, with variables
    substituted into every name/cwd/cmd. Returns `(ok, session_name)` —
    `session_name` is the literal name after substitution so the caller
    can surface it in a toast or jump to it in the kanban."""
    session = substitute(template.session, variables)
    windows = [_substitute_window(w, variables) for w in template.windows]
    if not windows:
        log.warning("template %r has no windows; refusing to instantiate", template.name)
        return False, session

    first = windows[0]
    if not tmux.new_session(session, window_name=first.name, cwd=first.cwd):
        return False, session
    if first.cmd:
        tmux.send_keys(session, 0, paste=first.cmd, keys=["Enter"])

    for i, w in enumerate(windows[1:], start=1):
        idx = tmux.new_window(session, w.name, cwd=w.cwd)
        if idx is None:
            log.warning("template %r: new_window failed at index %d", template.name, i)
            continue
        if w.cmd:
            tmux.send_keys(session, idx, paste=w.cmd, keys=["Enter"])

    return True, session
