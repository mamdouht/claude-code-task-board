#!/bin/bash
# One-time setup: turn on Claude Code's todo tool (TodoWrite) for Claude 5 models.
#
# Claude Code enables TodoWrite by default only for older models; on Claude 5 models it stays off
# unless CLAUDE_CODE_ENABLE_TODO_TOOLS is set. A plugin cannot set environment variables, so this
# script adds it to the "env" block of ~/.claude/settings.json (backup kept beside it).
#
# Usage: scripts/enable-todo-tool.sh [--undo]

set -euo pipefail
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d-%H%M%S)"

UNDO="${1:-}" SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os
path = os.environ["SETTINGS"]
with open(path) as f:
    s = json.load(f)
env = s.setdefault("env", {})
if os.environ["UNDO"] == "--undo":
    env.pop("CLAUDE_CODE_ENABLE_TODO_TOOLS", None)
    if not env:
        del s["env"]
    print("Removed CLAUDE_CODE_ENABLE_TODO_TOOLS from", path)
else:
    env["CLAUDE_CODE_ENABLE_TODO_TOOLS"] = "1"
    print("Set CLAUDE_CODE_ENABLE_TODO_TOOLS=1 in", path)
with open(path, "w") as f:
    json.dump(s, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY
echo "Restart open Claude Code sessions to pick it up."
