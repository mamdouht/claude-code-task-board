#!/bin/bash
# Install the task status line for Claude Code.
#
#   ./install.sh              copy the script to ~/.claude/statusline/ and set it as your statusLine
#   ./install.sh --force      same, replacing a statusLine you already have (backup kept)
#   ./install.sh --uninstall  remove it (only if it is still the configured statusLine)
#
# Edits ~/.claude/settings.json with python3 (or jq). With neither, it prints the snippet to add.
# Honours CLAUDE_CONFIG_DIR. Independent of the rest of this repo: no plugin, no node needed.

set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DEST_DIR="$CONFIG/statusline"
DEST="$DEST_DIR/task-statusline.sh"
SETTINGS="$CONFIG/settings.json"
MODE="${1:-install}"
COMMAND="bash \"$DEST\""

edit_settings() { # $1 = install | force | uninstall
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d-%H%M%S)"
  if command -v python3 >/dev/null 2>&1; then
    ACTION="$1" SETTINGS="$SETTINGS" COMMAND="$COMMAND" python3 - <<'PY'
import json, os
path, action, command = os.environ["SETTINGS"], os.environ["ACTION"], os.environ["COMMAND"]
with open(path) as f:
    s = json.load(f)
current = (s.get("statusLine") or {}).get("command")
if action == "uninstall":
    if current == command:
        del s["statusLine"]; print("Removed the task status line from", path)
    else:
        print("statusLine is not ours; left it alone.")
elif current and current != command and action != "force":
    print("You already have a statusLine:", current)
    print("Re-run with --force to replace it (a backup of settings.json is kept).")
    raise SystemExit(3)
else:
    s["statusLine"] = {"type": "command", "command": command, "padding": 0}
    print("statusLine set in", path)
with open(path, "w") as f:
    json.dump(s, f, indent=2, ensure_ascii=False); f.write("\n")
PY
  elif command -v jq >/dev/null 2>&1; then
    tmp="$(mktemp)"
    case "$1" in
      uninstall) jq --arg c "$COMMAND" 'if .statusLine.command == $c then del(.statusLine) else . end' "$SETTINGS" > "$tmp" ;;
      install) if [ "$(jq -r '.statusLine.command // ""' "$SETTINGS")" != "" ] &&
                  [ "$(jq -r '.statusLine.command' "$SETTINGS")" != "$COMMAND" ]; then
                 echo "You already have a statusLine; re-run with --force to replace it."; rm -f "$tmp"; exit 3
               fi
               jq --arg c "$COMMAND" '.statusLine = {type: "command", command: $c, padding: 0}' "$SETTINGS" > "$tmp" ;;
      force) jq --arg c "$COMMAND" '.statusLine = {type: "command", command: $c, padding: 0}' "$SETTINGS" > "$tmp" ;;
    esac
    mv "$tmp" "$SETTINGS"; echo "Updated $SETTINGS"
  else
    echo "Neither python3 nor jq found. Add this to $SETTINGS yourself:"
    echo "  \"statusLine\": { \"type\": \"command\", \"command\": \"bash $DEST\", \"padding\": 0 }"
  fi
}

case "$MODE" in
  --uninstall)
    edit_settings uninstall
    rm -f "$DEST"; rmdir "$DEST_DIR" 2>/dev/null || true
    echo "Removed $DEST" ;;
  install|--force)
    mkdir -p "$DEST_DIR"
    cp "$SRC/task-statusline.sh" "$DEST"; chmod +x "$DEST"
    echo "Copied the script to $DEST"
    if [ "$MODE" = "--force" ]; then edit_settings force; else edit_settings install; fi
    echo "Takes effect on the next status refresh (send a message, or restart Claude Code)." ;;
  *) echo "usage: install.sh [--force | --uninstall]" >&2; exit 2 ;;
esac
