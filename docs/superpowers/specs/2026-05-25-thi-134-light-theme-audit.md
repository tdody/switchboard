# THI-134 — Light theme audit

**Linear:** [THI-134](https://linear.app/thibault-dody/issue/THI-134/review-all-window-with-light-theme-for-ux)
**Date:** 2026-05-25
**Status:** Draft

## Summary

Switchboard already supports a `light` theme via the `theme: "dark" | "light"
| "contrast" | "phosphor"` setting (`settings.ts:13,63`), applied as
`<html data-theme="light">` (`App.tsx:330`). What does **not** exist is
confidence that every UI surface looks good in light mode — the project has
shipped almost exclusively against the dark default. This ticket is an
**audit**, not a fix-all: produce a per-surface checklist with screenshots
and pass/fail; each fail spawns its own follow-up ticket.

Deliverable: `docs/audits/2026-05-25-light-theme-audit.md` + a screenshot
folder + a set of Linear sub-tickets keyed by surface name.

## Background

Existing theme infrastructure (already in place — no work required here):

* Type definition and four named themes in `settings.ts:13`.
* `<html data-theme="…">` attribute set by `App.tsx:330`.
* Settings → Appearance modal has a theme selector
  (`SettingsModal.tsx`, lines around the density selector at 221-228).
* CSS variables (`--bg`, `--bg-elev`, `--text`, `--text-mute`, `--hairline`,
  `--tone-*`, etc.) are presumed to be themed under `[data-theme="…"]`
  selectors in `styles.css`. The audit will confirm coverage and identify
  any rule that hardcodes a dark color.

The other three themes (`contrast`, `phosphor`) are **out of scope** for
this audit — same approach can be reused later if needed, but v0.1 only
promises dark and light. Document any dark-mode hard-codings discovered
along the way; whether they break the other two themes is a separate
question.

## Non-goals

* **Fix the audit findings.** Each finding becomes its own follow-up
  ticket; this ticket closes when the audit document is committed and the
  sub-tickets exist.
* **Add a UI theme toggle outside Settings.** The settings-modal selector
  is sufficient for v0.1.
* **Auto-theme via `prefers-color-scheme`.** Existing code respects the
  user-chosen value only; matching the OS at first load is a follow-up.
* **Contrast theme.** Same audit could be re-run with theme=contrast
  later; not in this ticket.

## Architecture

### Surface inventory

The audit walks each of these surfaces in light mode and records a verdict.
Grouped by where they live in the source:

**Chrome:**
* `Header.tsx` — logo, title, pending-input strip toggle, usage pill
  (THI-110), settings/help/shortcut buttons
* `Subhead.tsx` — search box, status tabs, status legend popover (THI-96),
  layout switcher, chip controls being added by THI-128 / THI-130
* `Kanban.tsx` — column header (session name + drag handle + +claude /
  +shell + auto-rename ✨), column body, empty-column placeholder

**Cards:**
* `WindowCard.tsx` — head row (kind icon + name + status pill), `.card-agent`
  block (branch/PR/CI chip + spinner chip + recap + pending block),
  `.preview` lines, `.card-meta` (cpu/mem), `.card-foot` (actions)
* Card hover, focused, highlighted, and pending states (each is a
  different visual)

**Modals:**
* `TerminalModal.tsx` — header chips (branch/PR/CI/context%/spinner from
  THI-115), xterm body, footer, **xterm theme** (currently hardcoded
  Tomorrow Night at `TerminalModal.tsx:130-152` — almost certainly fails
  in light mode)
* `SettingsModal.tsx` — sections, form controls, kbd chips
* `ShortcutsSheet` (THI-69) — kbd chips, row striping
* `StatusLegend` popover (THI-96) — dot tones, descriptions
* `Tour` (THI-96) — cutout overlay, popover, step buttons
* `AutoRenameModal` (THI-67) — stacked rows, skip toggle, cost preview
* `NewWindowOverlay` — form fields
* `ConfirmDialog` — destructive-action button
* `CommandPalette` — search input, list rows, recent badge
* `RenameModal` / `RenameSessionModal`

**Other UI:**
* `Tooltip` (THI-96) — dark fill currently; needs a light variant
* `Toast` — color tones for success/error/info
* `NeedsStrip` (the amber strip listing pending-input windows)
* `EmptyState` (when no tmux server)

### Audit method (per surface)

For each surface above:

1. Force theme via Settings → Appearance → "light".
2. Reproduce each known visual state (default, hover, focus, active,
   disabled, error, empty).
3. Screenshot at 1× display.
4. Record verdict in the audit doc as one of:
   - `pass` — readable, contrasts well, consistent with light mode.
   - `minor` — readable but uses hardcoded dark color or off-palette
     accent; file a follow-up.
   - `broken` — illegible, missing border, washed-out text, or otherwise
     functionally degraded; file a follow-up tagged `priority: medium`.
5. For each non-pass, note the **specific** CSS rule (selector + property)
   responsible if it can be identified by a quick devtools poke.

Known up-front candidates for `broken`:

* **xterm theme** — `TerminalModal.tsx:130-152` sets dark bg (`#282c34`) +
  white fg unconditionally. In light mode the modal background is light
  but xterm shows a dark rectangle. Almost certainly the largest single
  finding.
* **CI dot colors** — `--tone-cyan` running animation may be hard to see
  on a light background.
* **`.recap` text-mute** — `var(--text-mute)` could be too light against
  light-mode `--bg-elev`.

### Output

Single audit document at
`docs/audits/2026-05-25-light-theme-audit.md`, structure:

```
# Light-theme audit (THI-134)

## Methodology
- Forced theme via Settings → Appearance → "light".
- Screenshots at 1× via Cmd-Shift-4 on macOS.
- All screenshots committed alongside this doc under `screenshots/light-theme/`.

## Surfaces

### Header
- **Verdict:** pass / minor / broken
- **Screenshot:** ![](screenshots/light-theme/header.png)
- **Notes:** [if non-pass]
- **Follow-up:** [Linear ticket link, if filed]

### Subhead
…

### TerminalModal — xterm body
- **Verdict:** broken
- **Notes:** Hardcoded dark theme in TerminalModal.tsx:130-152 ignores
  data-theme. Need a theme map { dark, light, contrast, phosphor } -> xterm theme.
- **Follow-up:** THI-XXX
```

## Files touched

| File | Change |
|---|---|
| `docs/audits/2026-05-25-light-theme-audit.md` | **New** — the audit doc |
| `docs/audits/screenshots/light-theme/*.png` | Screenshots referenced by the doc |
| Linear | One sub-ticket per non-pass surface, milestone v0.1 if "broken", deferred if "minor" |

**No code changes.** That's intentional — see Non-goals.

## Testing

The audit itself is the deliverable; "testing" reduces to:

* The audit doc enumerates every surface in the inventory (no gaps).
* Every surface has a screenshot.
* Every non-pass has either a quoted CSS culprit or a clear written
  observation.
* Every non-pass has a Linear follow-up linked.

A second pair of eyes should be able to take the audit doc and the
follow-up tickets and act on them without re-running the audit.

## Open questions / future work

* **Contrast / phosphor themes.** Same audit could be re-run for either
  theme after the light-mode fixes land. Cheaper the second time because
  the broken patterns are mostly shared.
* **Audit automation.** A future iteration could automate per-surface
  screenshots via Playwright + visual diff. Heavy lift for a single
  audit; revisit if light-mode regressions become routine.
* **`prefers-color-scheme` honored at first load.** Currently the user
  must explicitly pick a theme. After the audit, consider defaulting to
  the OS preference on a fresh install — separate ticket.
