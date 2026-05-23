#!/usr/bin/env bash
set -euo pipefail
set -m

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

cleanup() {
  trap - INT TERM EXIT
  [[ -n "${BACKEND_PID:-}"  ]] && kill -TERM -- -"$BACKEND_PID"  2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill -TERM -- -"$FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$ROOT/backend" && exec uv run uvicorn switchboard.main:app --reload --host 127.0.0.1 --port 8765) &
BACKEND_PID=$!

(cd "$ROOT/frontend" && exec npm run dev) &
FRONTEND_PID=$!

echo "backend pid=$BACKEND_PID  frontend pid=$FRONTEND_PID"
echo "open http://localhost:5173"

wait "$BACKEND_PID" "$FRONTEND_PID"
