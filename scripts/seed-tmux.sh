#!/usr/bin/env bash
# Seed a multi-session/multi-window tmux server for local dashboard testing.
set -euo pipefail

tmux kill-server 2>/dev/null || true
sleep 0.1

tmux new -d -s main -n nvim 'nvim README.md 2>/dev/null || sleep 999'
tmux neww  -t main -n dev   'sleep 999'
tmux neww  -t main -n claude/dashboard-kanban 'cat'
tmux neww  -t main -n shell 'zsh -i'

tmux new -d -s agents -n claude/migrate-orm   'cat'
tmux neww  -t agents -n claude/flaky-tests    'cat'
tmux neww  -t agents -n claude/landing-copy   'cat'

tmux new -d -s ops -n deploy 'tail -f /var/log/system.log 2>/dev/null || sleep 999'
tmux neww  -t ops -n k9s    'sleep 999'

echo "Seeded:"
tmux list-sessions
echo
tmux list-windows -a
