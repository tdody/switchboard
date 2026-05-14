# Handoff: Switchboard — Live tmux Session Dashboard

## Overview

**Switchboard** is a live browser dashboard for tmux sessions. Every tmux window becomes a card; clicking a card opens a live xterm-style modal bridged to the pane over WebSocket. It parses Claude Code agent panes specifically to surface git branch, PR number, CI status, spinner activity, and a recap of what the agent did last — and flags any agent that is waiting on the user's input. It's built for the "I have 30 tmux windows across 5 sessions running various Claude Code agents — I need a single pane of glass" workflow.

Original inspiration: <https://github.com/tomplex/periscope>. This is an **original design** — not a clone — with its own brand (Switchboard), visual language, and interaction model.

## About the Design Files

The files in this bundle are **design references created in HTML** — interactive prototypes showing intended look, behavior, and state transitions, not production code to ship as-is. Your task is to **recreate these designs in the target codebase's existing environment** (React + a real WebSocket backend in Python, or whichever framework + language fits the project) using its established patterns and libraries.

The HTML prototype loads React 18 via UMD + `@babel/standalone`. In a real implementation use a normal React build with Vite/Next/etc.; the structure and component breakdown will map directly.

## Fidelity

**High-fidelity.** Pixel-perfect mockups with final colors, typography, spacing, layout, interactions, and motion. Recreate the UI pixel-perfectly. The Tweaks panel is a prototype-only affordance for exploring theme/density/layout variations — keep its outputs (theme, accent, density, layout) as user preferences (e.g. in localStorage) but the panel itself is not part of the production UI.

## Stack guidance

- **Backend:** Python (Periscope inspiration uses FastAPI). Endpoints documented under "Backend contract" below.
- **Frontend:** React 18 + TypeScript recommended. xterm.js for the live terminal modal. Plain CSS variables for theming (no Tailwind needed; tokens are listed below).

## Screens / Views

### 1. Default Dashboard
**Purpose:** Glance over all tmux windows; spot any agent waiting on input.

**Layout (CSS grid):** `grid-template-rows: auto auto auto 1fr` — Header / NeedsStrip (conditional) / Subhead / Main. Height: 100vh. Body has `overflow: hidden`.

**Components:**
- **Header (top, ~48px tall):** Switchboard mark (26px) + wordmark + `127.0.0.1:8765` muted text + compact stats line (`19 windows · 2 waiting · 6 running · 9 idle`, single line, mono font, status counts inline) + spacer + `?` help button + settings gear.
- **NeedsStrip (conditional, ~46px tall):** Amber-tinted strip showing every pending-input window as a clickable pill: `session/window-name › action-prompt`. "Broadcast" button on the right (opens command palette in broadcast mode). Dismissable.
- **Subhead (~44px tall):** Search field with `/` shortcut + segmented status filter (All/Waiting/Running/Idle, each with count) + optional layout-suggestion chip + layout switcher (kanban/grid/list icon trio).
- **Main:** Layout-dependent — see below.

### 2. Kanban Layout (default)
- Horizontal scroll of session columns. Each column is fixed `flex: 0 0 320px`, full available height, internal scroll.
- Column header: attached-dot + session name + count badge (turns amber when any pending) + sparkle (auto-rename) + plus (new window).
- Column body: vertical stack of WindowCards, `gap: 10px`, padding-bottom 28px.
- Each column has a **fade overlay** at its bottom (`::after`, 56px tall, gradient from transparent to column bg) so the bottom card visibly trails off, signalling scrollability.
- Hovering the column name shows an "attached client" tooltip (term, tty, since, created).

### 3. Grid Layout
- `display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px;` filling the canvas.
- Two modes via tweak: grouped by session (section headers + sub-grids) or flat (single grid).

### 4. List Layout
- Dense tabular row per window. Columns: status-dot, `session/window-name`, recap/cmd, resources, status pill, branch/PR chips, activity time, actions.

### 5. WindowCard (the core component)
A clickable card representing one tmux window. **Variants by status:** running / waiting / idle / done / error.

Anatomy, top to bottom:
1. **Card head:** kind icon (colored square, 20×20) + window name (mono, 12.5px, semibold, ellipsis) + index `:N` (muted) + status pill.
2. **Agent block** (agent kind only): branch+PR combined chip with CI status dot prefix + spinner chip with duration + recap line (2-line clamp) + pending-input action box (amber, only when `pendingInput=true`).
3. **Preview** (only when density=preview): last ~6 lines of pane content, mono 11px, fade-out on bottom.
4. **Resource meta** (only when CPU ≥ 60% or mem ≥ 1 GB): `38.4% cpu · 1.2 GB mem`. Colors amber at warn, red at danger.
5. **Card foot:** focus icon-button + rename icon + send-keys icon + spacer + activity time `38s`.

States:
- `waiting` + `pendingInput`: 2.2s amber outer pulse, amber action box visible.
- `running` status pill: cyan dot 1.2s pulse.
- `focused` (after focus click): 900ms accent flash via keyframes, then opens terminal modal.

Density variants (data-attribute `data-density` on root):
- `compact`: hide preview, hide recap second line, tighter padding.
- `comfy` (default): hide preview, full recap.
- `preview`: include preview block.

### 6. Terminal Modal
**Trigger:** click any card.
**Layout:** Fullscreen scrim (rgba(0,0,0,0.55) + backdrop-blur 6px), centered modal `min(1200px, 96vw) × min(82vh, 820px)`, dark `#050608` background with subtle radial accent.
**Chrome:**
- Header (40px): three traffic-light buttons (red = close, others decorative), breadcrumb `session › index : name` + branch+PR chips + status pill + focus/rename/copy-id buttons + close-X.
- Body: scrollable terminal output, mono 13px, ANSI-tinted (green=ok, cyan=info, amber=warn, red=err, lilac=branch, accent=prompt). Synthetic backlog per kind (agent/server/shell/logs/editor each have plausible session history). Blinking caret on input line.
- Footer (40px): "WS · live · 18ms" connection pill, cwd, input field for send-keys + `Esc close` hint.

Close: red traffic light, Esc key, or scrim click.

### 7. Command Palette
**Trigger:** ⌘K from anywhere, or send-keys icon on a card, or broadcast button.
**Layout:** Centered `min(640px, 92vw)` modal.
**Body:** Sections — "Recent commands" (`ls -la`, `git status`, `pnpm test --watch`, Send Ctrl+C, re-run last) and "Agent prompts" (`y`, `n`, `continue`, `look more carefully and try again`). Each item: icon + label + hint. Arrow-key navigation; Enter sends.
**Broadcast mode:** target is `{ broadcast: true, targets: WindowsArray }`. Header shows amber "broadcast" pill instead of send icon, target chips render as a wrap-row at the top of the body, footer shows `target: N panes`.

### 8. Auto-rename Modal
**Trigger:** sparkle (✨) icon on any session column header.
**Layout:** Centered `min(680px, 94vw)` modal.
**Header:** amber sparkle icon + `Auto-rename windows in <session>` title + subtitle `Suggestions from claude-haiku-4-5 based on what each pane is doing right now.`
**Body:** One rename row per window in the session. **Each row is a 3-column grid:** `[index, 28px right-aligned] [stacked from/to block, flex-grow] [skip toggle, 28px]`.
- The stacked block has two lines:
  - `from  <old-name>` — muted, mono 11.5px, ellipsis
  - `to    <new-name-input>` — full-width input, mono 12.5px, accent border on focus
- "from" / "to" tags are tiny uppercase 9.5px labels.
- Skipped rows: both lines strikethrough, dimmed, can be restored with the + button.

**Critical layout rule:** old and new names must never overlap or share a row. Assume names can be 60+ chars long. The stacked design above accomplishes this — each name gets a full row width, with controlled ellipsis on the "from" line and a true text input on the "to" line.

**Footer:** `N of M accepted` + `~$0.0021 · 2.4k tokens` cost preview + Cancel/Apply buttons.

### 9. Settings Modal
- Connection (server URL, poll interval slider, ws stream toggle)
- Auto-rename (Anthropic API key masked, model display)
- Notifications (pending badge toggle, native browser notification toggle)

### 10. Shortcuts Sheet
- Triggered by `?` key or `?` button.
- Lists nav, card, and modal hotkeys with kbd chips.

### 11. Empty State
- When no tmux server is found.
- Shows Switchboard mark + amber "no tmux server" pill + headline + the two shell commands to spin one up + Retry button.

### 12. Toast (Focus action confirmation)
- Pill, bottom-center, mono 12.5px: `[focus-icon] session:N name → [terminal-app-name]`. Auto-dismiss ~2s.

## Interactions & Behavior

### Sorting and grouping
- Inside any group, sort: `pendingInput` first, then `error`, `running`, `done`, others. Use this for kanban columns and the flat list.

### Filter logic
- Two layers compose:
  1. **Status chip selection** (one of `all/waiting/running/idle`).
  2. **Search field** parses `key:value` tokens (`kind:agent`, `status:waiting`, `session:main`) and free-text against name/session/branch/recap/cmd.
- Tokens AND with chip selection AND free-text.

### Layout recommendation
- If kanban + status filter + ≤6 visible cards → suggest grid.
- If kanban + ≥18 visible cards → suggest list.
- If list + ≤4 visible cards → suggest grid.
- Render as a dashed accent chip next to the layout switcher; clicking switches.

### Focus action
- Click card's focus icon → flash card (900ms accent-color keyframe) → push toast → 280ms later open the terminal modal.
- In production: also call `POST /api/focus?session=…&index=…` so the user's attached tmux client jumps to that window.

### Live data
- Poll `/api/state` every 3s (configurable, 1–30s in settings).
- When the terminal modal is open: WebSocket to `/ws/pane?session=…&index=…` for bidirectional stream. Use xterm.js for rendering.

### Hotkeys
| Key | Action |
|---|---|
| `/` | Focus search input |
| `⌘K` | Open command palette (targets first pending agent if any) |
| `?` | Toggle shortcuts sheet |
| `Esc` | Close any open modal |
| `↑/↓` in palette | Navigate items |
| `⏎` in palette | Send |

### Themes
Four themes via `data-theme` attribute on `<html>`:
- `dark` (default), `light`, `contrast`, `phosphor` (green CRT — also swaps UI font to mono).
Plus five accent palettes — set CSS vars `--accent`, `--accent-soft`, `--accent-edge` via OKLCH:
- `aurora` (oklch 0.78 0.13 145)
- `amber`  (oklch 0.80 0.14  80)
- `sky`    (oklch 0.74 0.13 240)
- `magenta` (oklch 0.72 0.16 330)
- `lilac`  (oklch 0.74 0.12 295)

### Reduced motion
Honor `prefers-reduced-motion` and the in-app toggle (`data-reduced-motion="true"`). Disables: pending pulse, run-dot pulse, spinner spin, focus flash, toast slide-in, danger blink.

## State Management

Top-level state lives in the dashboard root:
- `filter: "all" | "waiting" | "running" | "idle"`
- `query: string`
- `openWindow: Window | null`
- `paletteTarget: Window | { broadcast: true, targets: Window[] } | null`
- `renameSession: string | null`
- `showSettings: boolean`
- `showShortcuts: boolean`
- `showNeedsStrip: boolean`
- `emptyState: boolean` (debug only)
- `focusedId: string | null` (for the flash)
- `toasts: Toast[]`

User prefs (persisted, e.g. localStorage):
- `theme`, `accent`, `layout`, `density`, `showPreviews`, `groupBy`, `reducedMotion`.

Data:
- `sessions: Session[]` (id, name, attached, created, clients[])
- `windows: Window[]` (id, session, index, name, kind, status, lastActivity, cpu, mem, cmd, cwd, pendingInput?, agent?, preview[])

## Design Tokens

### Type
- Sans: `Inter` (weights 400/500/600/700)
- Mono: `JetBrains Mono` (weights 400/500/600)

### Colors (CSS variables — dark theme)
```css
--bg:        #0b0c0f;
--bg-elev:   #111317;
--panel:     #15181e;
--panel-2:   #1a1e25;
--hairline:  rgba(255,255,255,.08);
--hairline-strong: rgba(255,255,255,.14);
--text:      #e7e9ee;
--text-mute: #9aa0ad;
--text-dim:  #6b7180;

--tone-cyan:    oklch(0.78 0.13 220);
--tone-amber:   oklch(0.80 0.14  80);
--tone-green:   oklch(0.78 0.13 145);
--tone-red:     oklch(0.72 0.16  25);
--tone-gray:    oklch(0.65 0.01 250);
--tone-magenta: oklch(0.72 0.16 330);
--tone-lilac:   oklch(0.74 0.12 295);
--tone-sky:     oklch(0.78 0.13 240);

--accent:        oklch(0.78 0.13 145);   /* aurora — settable */
--accent-soft:   oklch(0.78 0.13 145 / 0.16);
--accent-edge:   oklch(0.78 0.13 145 / 0.55);
```

Light, contrast, and phosphor variants override these — see `styles.css` for full definitions.

### Status semantics
| Status | Tone | Glyph |
|---|---|---|
| running | cyan | filled circle, 1.2s pulse |
| waiting | amber | filled square |
| idle | gray | open ring |
| done | green | checkmark clip-path |
| error | red | triangle clip-path |

### Resource thresholds
- CPU: amber ≥ 60%, red ≥ 85%
- Mem: amber ≥ 1024 MB, red ≥ 2048 MB
- Only render the resource row at all when at least one is above warn.

### Spacing & radii
- Page padding: 18px H
- Card padding: 9–11px
- Border radii: `--r-sm: 6px`, `--r: 10px`, `--r-lg: 14px`
- Hairline borders: 1px, color `--hairline`

### Shadows
```css
--shadow-card: 0 1px 0 rgba(255,255,255,.03) inset, 0 1px 2px rgba(0,0,0,.4);
--shadow-lift: 0 1px 0 rgba(255,255,255,.04) inset, 0 8px 24px rgba(0,0,0,.45);
```

## Backend contract (Python / FastAPI suggested)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/state` | List every tmux window with parsed Claude status |
| GET  | `/api/pane?session=…&index=…&lines=200` | Capture last N lines (ANSI included) |
| POST | `/api/focus?session=…&index=…` | Switch every attached client to that window |
| POST | `/api/send?session=…&index=…` | Body `{keys:[…], paste:"…"}` — keystrokes / bracketed paste |
| POST | `/api/rename?session=…&index=…` | Body `{name:"…"}` |
| POST | `/api/auto-rename-session?session=…` | Haiku-driven batch rename suggestions |
| WS   | `/ws/pane?session=…&index=…` | Live bidirectional pane stream |

`/api/state` should return parsed agent metadata for windows whose pane content matches a Claude Code preamble — branch, PR number (from `gh pr view`), CI state (from `gh pr checks`), current spinner activity, recap (last assistant message), pending-input detection (heuristic: cursor on a `(y/n)` or similar prompt with no recent output).

## Assets

- **Switchboard logo:** patch-cord motif (two filled dots connected by a curved cable, on a faded grid of jack dots). Built from inline SVG using `currentColor`, sized 16/22/26/64. See `icons.jsx` / inline mark in `app.jsx`.
- **Icons:** a small inline SVG icon set (`icons.jsx`) — search, x, plus, settings, sparkle, focus, rename, send, term, git-branch, git-pr, check, alert, kanban, grid, list, etc. All 16×16 viewBox, stroke-based, `currentColor`. ~30 icons.
- **Fonts:** Inter + JetBrains Mono via Google Fonts (or self-hosted).
- No raster assets — everything is vector / CSS.

## Files in this bundle

- `Tmux Dashboard.html` — root prototype, loads all modules
- `app.jsx` — App shell, header, subhead, layout switcher, hotkeys, toast stack, layout suggestion logic
- `cards.jsx` — `WindowCard`, `ListRow`, `StatusPill`, threshold logic
- `terminal-modal.jsx` — fullscreen terminal modal + synthetic backlog builder
- `overlays.jsx` — Command palette, Auto-rename modal (the stacked-row layout you'll mirror), Settings, EmptyState
- `icons.jsx` — icon set + `SwitchboardMark` component
- `data.jsx` — mock SESSIONS + WINDOWS data
- `styles.css` — full design system tokens + component styles
- `tweaks-panel.jsx` — prototype-only tweaks panel (skip in production)

Read these for exact spacing, animation timing, and component composition. Treat `styles.css` as the source of truth for tokens.

## Notes & gotchas

- **Cards must not flex-shrink** inside a flex column. Set `flex-shrink: 0` on `.card`. Without it, columns with many cards will silently compress each card and hide their footers — a bug that took a round of debugging to find.
- **Grid template rows** on the app root needs four rows (`auto auto auto 1fr`) since the NeedsStrip is conditional but real when present — otherwise the Subhead steals the flex space and Main is pushed offscreen.
- **Long agent names** (e.g. `claude/dashboard-kanban`) must ellipsis cleanly in the card header and in the auto-rename modal. The auto-rename modal stacks old + new vertically — each gets a full row width — so they never collide regardless of name length.
- **CSS overflow vs scroll:** column bodies scroll, `.col` has `overflow: hidden` so the bottom fade is clipped to the column edge. The fade is a `::after` overlay matching the column background — *not* a `mask-image` (which would just make content transparent and break legibility).
