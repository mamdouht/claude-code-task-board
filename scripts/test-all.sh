#!/bin/bash
# Runs every test suite in the repo. The mod's suite and the plugin validation need the
# `claude` CLI, version 2.1.287 or newer (mods support); they are skipped when it is missing/older.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== task-tracker (node --test)";      node --test plugins/task-tracker/test/
echo "== vscode-extension (node --test)";  node --test vscode-extension/test/
echo "== statusline (bash)";                statusline/test/run.sh

CLAUDE_BIN="${CLAUDE_BIN:-claude}"
version="$("$CLAUDE_BIN" --version 2>/dev/null | awk '{print $1}' || true)"
if [ -n "$version" ] && [ "$(printf '%s\n2.1.287\n' "$version" | sort -V | head -1)" = "2.1.287" ]; then
  echo "== plugin validate ($version)"
  for d in . plugins/task-board plugins/task-tracker; do "$CLAUDE_BIN" plugin validate "$d"; done
  echo "== task-board (claude plugin test)"; "$CLAUDE_BIN" plugin test plugins/task-board
else
  echo "== SKIPPED mod tests and plugin validation: need claude >= 2.1.287 (found: ${version:-none}); set CLAUDE_BIN to another binary"
fi
