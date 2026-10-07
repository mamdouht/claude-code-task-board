#!/bin/bash
# Launcher for the task-tracker hook. Hooks run with a minimal PATH, so find a node binary
# explicitly: PATH first, then the usual install locations (Homebrew, nvm's default, Volta).
# No node: stay silent and succeed, so the session never breaks.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE=""
for candidate in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node \
  "$HOME/.volta/bin/node" "$HOME/.nvm/alias/default/bin/node" /usr/bin/node; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then NODE="$candidate"; break; fi
done
[ -n "$NODE" ] || { cat >/dev/null; exit 0; }

case "$1" in
  hook) exec "$NODE" "$DIR/hook/task-tracker-hook.mjs" ;;
  *) cat >/dev/null; exit 0 ;;
esac
