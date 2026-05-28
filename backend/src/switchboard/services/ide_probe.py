"""Detect which GUI editors are installed on this machine.

Output drives the Settings dropdown for "Open in IDE" (THI-146 PR 4). We
only surface editors that are both (a) on `IDE_ALLOWLIST` (the security gate
in /api/open) and (b) on the user's PATH — so the dropdown never invites
the user to pick a binary that the next click would 500 on.

The list is intentionally short on day 1. Adding more editors is a one-line
change in KNOWN_IDES; the only constraint is that the `id` must also be in
`settings.IDE_ALLOWLIST`.
"""

from __future__ import annotations

import shutil
from typing import TypedDict


class KnownIde(TypedDict):
    id: str
    label: str


# Order here is the order the dropdown will render. Keep it stable — users
# build muscle memory for "the second one in the list."
KNOWN_IDES: list[KnownIde] = [
    {"id": "code", "label": "Visual Studio Code"},
    {"id": "cursor", "label": "Cursor"},
    {"id": "subl", "label": "Sublime Text"},
    {"id": "pycharm", "label": "PyCharm"},
]


_cache: list[KnownIde] | None = None


def probe_available_ides() -> list[KnownIde]:
    """Return the subset of KNOWN_IDES whose launcher binary is on PATH.

    Cached per-process: PATH won't change under the running server, and the
    only caller is /api/ide-config which is itself fetched once per app
    mount. The cache also defends against pathological clients polling the
    endpoint — `shutil.which` stats every PATH dir on a miss.
    """
    global _cache
    if _cache is not None:
        return _cache
    _cache = [entry for entry in KNOWN_IDES if shutil.which(entry["id"]) is not None]
    return _cache


def _reset_cache_for_tests() -> None:
    """Invalidate the probe cache. Tests that monkeypatch `shutil.which`
    must call this before invoking the probe; production code should not."""
    global _cache
    _cache = None
