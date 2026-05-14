# Switchboard

Live browser dashboard for tmux sessions. Every tmux window becomes a card; clicking a card opens a live xterm-style modal bridged over WebSocket. Parses Claude Code agent panes to surface git branch, PR, CI status, spinner, recap, and pending-input prompts.

## Quickstart

```bash
# 1. Install backend deps
cd backend && uv sync && cd ..

# 2. Install frontend deps
cd frontend && npm install && cd ..

# 3. (one-time, per clone) Enable the pre-push hook
git config core.hooksPath scripts/hooks

# 4. Run both servers (backend :8765, frontend :5173)
./scripts/dev.sh

# 5. (optional) Seed a multi-session/multi-window tmux server for local testing
./scripts/seed-tmux.sh
```

Open <http://localhost:5173>.

The pre-push hook runs the same checks as CI (ruff format/check, ty, pytest,
tsc, vite build) before any `git push`. Skip with `git push --no-verify` for
emergencies.

## Layout

```
backend/                    FastAPI + libtmux service
frontend/                   React 18 + TypeScript + Vite SPA
scripts/                    dev.sh + seed-tmux.sh
docs/design-reference/      Original design handoff (prototype JSX + styles.css)
```

## Security model

Switchboard can read your panes and inject keystrokes — treat the endpoint
like a shell.

**Loopback mode (default).** Bound to `127.0.0.1`, so only processes on your
machine can reach it. No token required — zero friction. Two protections still
apply: the `Host` header must match a loopback allowlist (defeats DNS-rebinding
from a malicious web page), and mutating requests need a double-submit CSRF
cookie+header.

**Exposed mode.** If you bind to a non-loopback host (`SWITCHBOARD_HOST=0.0.0.0`,
a LAN IP, etc.) auth turns on automatically. A random token is generated on
first run and stored at `~/.switchboard/token` (mode `0600`). On startup the
console prints a bootstrap URL — `http://host:port/?token=…` — open it once and
the backend swaps the token for an `HttpOnly` session cookie. API clients can
alternatively send `Authorization: Bearer <token>`.

Override the auto-detection with `SWITCHBOARD_AUTH_REQUIRED=true|false`.
Rotate the token via `POST /api/auth/regenerate` (this invalidates existing
session cookies).
