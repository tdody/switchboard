"""Routes for the session-templates feature (THI-99)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from switchboard.services import templates

router = APIRouter(prefix="/api")


class _CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class TemplateSummary(_CamelModel):
    """One row in `GET /api/templates`. Light enough for the modal's list
    view — full window payload is recomputed at instantiation time."""

    name: str
    window_count: int
    variables: list[str]


class TemplatesResponse(_CamelModel):
    templates: list[TemplateSummary]


class InstantiateBody(_CamelModel):
    name: str
    variables: dict[str, str] = Field(default_factory=dict)


@router.get("/templates")
def list_templates() -> TemplatesResponse:
    items: list[TemplateSummary] = []
    for t in templates.list_templates():
        items.append(
            TemplateSummary(
                name=t.name,
                window_count=len(t.windows),
                variables=templates.extract_variables(t),
            )
        )
    return TemplatesResponse(templates=items)


@router.post("/templates/instantiate")
def instantiate_template(body: InstantiateBody) -> dict[str, object]:
    t = templates.find_template(body.name)
    if t is None:
        raise HTTPException(status_code=404, detail=f"unknown template {body.name!r}")
    ok, session = templates.instantiate(t, body.variables)
    if not ok:
        raise HTTPException(
            status_code=500,
            detail=f"failed to create session {session!r} (name collision? tmux down?)",
        )
    return {"ok": True, "session": session}
