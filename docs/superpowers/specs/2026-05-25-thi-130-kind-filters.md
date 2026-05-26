# THI-130 — Clickable kind filters (Agent / Shell)

**Linear:** [THI-130](https://linear.app/thibault-dody/issue/THI-130/add-clickable-filters-for-agents-and-bash)
**Date:** 2026-05-25
**Status:** Draft

## Summary

Today users can filter by kind only via the search-box token syntax
(`kind:agent`, `kind:shell`) parsed in `lib/filter.ts:18-22`. The capability
is real but undiscoverable. Add two toggle chips to the subhead — **Agent**
and **Shell** — that drive the same filter through clicks instead of typing.

Behaves like a small radio group with an "off" state:

* No chip selected → all kinds visible (today's default).
* Agent selected → only `kind === "agent"` cards.
* Shell selected → only `kind === "shell"` cards.

The chips coexist with the existing status-filter tabs (`All / Waiting /
Running / Idle`) and the free-text search; all three filters AND together,
matching the behavior already in `applyFilter` (`filter.ts:28-46`).

## Background

`applyFilter` already supports a `kind` token (`filter.ts:35`). The
`parseQuery` parser strips `kind:value` out of the search input and stores it
on `tokens.kind` (`filter.ts:18-22`). Wiring chip clicks through the same
path means no change to filter semantics — only a new UI surface.

The user explicitly scoped chips to **Agent** and **Shell** only. Other
kinds in the system (`editor`, `server`, `logs`, from
`backend/src/switchboard/schemas.py:7`) remain reachable only via the
search-box `kind:editor` syntax, the same as today. When a chip is active,
those other kinds are filtered out (literal match, no implicit grouping).

## Non-goals

* **More chips.** Editor / Server / Logs chips are out of scope per the
  user's answer.
* **Multi-select chips.** The chip group is single-select with an "off"
  state, not a multi-select (would require a different data model and
  contradicts the radio-style tab UX already used for status).
* **Persistence.** The status filter today is URL-synced
  (`App.tsx:64-67`) and not localStorage-backed. The kind chip follows the
  same convention — URL param, not localStorage — for back/forward
  compatibility and shareable links.
* **Composability with search-box `kind:` token.** When both are set, the
  search box wins (it's lower in `applyFilter`'s precedence and the user is
  actively typing). Spec keeps this simple: clicking a chip overwrites the
  search-box `kind:` token; typing `kind:…` overwrites the chip. Both paths
  funnel into the same URL state — see below.

## Architecture

### URL state

Add a new URL param `kind` accepted as `agent` | `shell` | (empty/missing
= all). Driven by `useURLParam`, matching the existing pattern at
`App.tsx:64,70,71`:

```ts
const [kindParam, setKindParam] = useURLParam("kind", "");
const kindFilter: KindFilter = (
  KIND_FILTERS.includes(kindParam as KindFilter) ? kindParam : ""
) as KindFilter;
const setKindFilter = (v: KindFilter) => setKindParam(v);
```

where:

```ts
// in lib/filter.ts
export type KindFilter = "" | "agent" | "shell";
export const KIND_FILTERS: KindFilter[] = ["", "agent", "shell"];
```

### `applyFilter` extension

One new precondition, AND-composed with the existing checks:

```ts
// lib/filter.ts, after the existing `filter !== "all"` line
if (kindFilter && w.kind !== kindFilter) return false;
```

Signature becomes:

```ts
export function applyFilter(
  windows: Window[],
  filter: StatusFilter,
  kindFilter: KindFilter,
  parsed: ParsedQuery,
): Window[]
```

Wiring at `App.tsx:127` updates to pass `kindFilter` through.

### Reconciling chip and `kind:` search-box token

The two paths now reach the same precondition through different signals
(chip → `kindFilter` URL param, search token → `parsed.tokens.kind`).
Decision: **search-box token takes precedence when both are set**, mirroring
the existing AND composition. In practice this is rare; the visible chip
state should always reflect "what's active." To avoid two competing visual
states, the chip-click handler clears any conflicting `kind:` token from the
search box before setting the URL param:

```ts
const onChipClick = (next: KindFilter) => {
  if (parsed.tokens.kind && parsed.tokens.kind !== next) {
    // strip kind:X from the search box, keep the rest
    setQuery(stripKindToken(query));
  }
  setKindFilter(kindFilter === next ? "" : next);
};
```

`stripKindToken` is a tiny utility in `lib/filter.ts`:

```ts
export function stripKindToken(q: string): string {
  return q.replace(/\bkind:\S+\s*/gi, "").trim();
}
```

### Chip rendering

In `Subhead.tsx`, add a third toggle group next to the status tabs at
line 64, using the existing `.tab` button class for visual parity:

```tsx
<span className="kind-tabs" style={{ display: "inline-flex", gap: 2 }}>
  <button
    className={`tab ${kindFilter === "agent" ? "is-active" : ""}`}
    onClick={() => onChipClick("agent")}
  >
    <Icon name="agent" size={11} />
    <span>Agent</span>
  </button>
  <button
    className={`tab ${kindFilter === "shell" ? "is-active" : ""}`}
    onClick={() => onChipClick("shell")}
  >
    <Icon name="shell" size={11} />
    <span>Shell</span>
  </button>
</span>
```

Icons re-use the existing `agent` / `shell` glyphs from `kindIcon()`
(`status.ts:35-50`), so the chip and the per-card kind glyph stay visually
identical.

No new CSS class needed; `.tab` and `.tab.is-active` already exist at
`styles.css` (verified against the status-tab usage).

## Files touched

| File | Change |
|---|---|
| `frontend/src/lib/filter.ts` | Add `KindFilter` type + `KIND_FILTERS`; add `kindFilter` param to `applyFilter`; add `stripKindToken` |
| `frontend/src/lib/filter.test.ts` | Extend coverage: kind filter alone, with status, with search token |
| `frontend/src/App.tsx` | Wire `kind` URL param; pass through to `Subhead` and `applyFilter` |
| `frontend/src/components/Subhead.tsx` | Add the two chips; `onChipClick` handler |
| `frontend/src/components/Header.tsx` | No change — `HeaderCounts` is unchanged |

## Testing

**Unit — `filter.test.ts`:**

| Inputs | Visible? |
|---|---|
| `kindFilter=""`, mixed `agent` + `shell` + `editor` windows | all three |
| `kindFilter="agent"`, mixed | only `agent` |
| `kindFilter="shell"`, mixed | only `shell` |
| `kindFilter="agent"` + `status filter="waiting"` | `agent` AND `waiting` |
| `kindFilter="agent"` + search `kind:shell` | empty (AND of conflicting) |
| `kindFilter="agent"` + search `kind:agent` | same as agent only (redundant, fine) |
| `stripKindToken("foo kind:agent bar")` | `"foo bar"` |
| `stripKindToken("kind:agent kind:shell")` | `""` |

**Integration / manual:**

* Default load → no chip selected; all cards visible.
* Click Agent → URL gains `?kind=agent`; cards filter; chip shows
  `is-active`.
* Click Agent again → URL drops `kind=…`; cards return.
* Click Shell while Agent is active → Agent deselects, Shell selects (radio
  semantics); cards switch.
* Type `kind:editor` in the search → no chip lights up; editor cards shown.
* Type `kind:agent` in the search → no chip lights up; type same as chip;
  AND of redundant filters still works.
* Click Agent chip while `kind:shell` is in the search box → search box has
  `kind:shell` stripped; chip lights up Agent; only agent cards shown.
* Reload page with `?kind=agent` in URL → chip pre-selected; matches.

## Open questions / future work

* **More kinds later.** If we ever need filters for `editor` / `server` /
  `logs`, the easy add is more chips behind a `+` overflow menu. The
  underlying state model already supports arbitrary kinds.
* **Saved combinations.** "Pin a filter set as a workspace" is the obvious
  next iteration (see deferred ticket THI-98); the URL-param shape here
  already serializes cleanly into such a snapshot.
