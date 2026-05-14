#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

cleanup() {
  trap - INT TERM
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$ROOT/backend" && uv run uvicorn switchboard.main:app --reload --host 127.0.0.1 --port 8765) &
BACKEND_PID=$!

(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

echo "backend pid=$BACKEND_PID  frontend pid=$FRONTEND_PID"
echo "open http://localhost:5173"

wait "$BACKEND_PID" "$FRONTEND_PID"
