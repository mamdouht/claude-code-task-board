#!/bin/bash
# Tests for task-statusline.sh and install.sh. Plain bash; run: statusline/test/run.sh
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
fail=0; pass=0
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then pass=$((pass + 1)); echo "ok   $1"
  else fail=$((fail + 1)); echo "FAIL $1"; echo "     expected: $2"; echo "     actual:   $3"; fi
}
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
run() { printf '%s' "$1" | /bin/bash ./task-statusline.sh; }
session() { printf '{"session_id":"s","transcript_path":"%s","model":{"display_name":"Opus 5.5"},"workspace":{"current_dir":"/r/my-repo"}}' "$1"; }

todo_line() { # one assistant transcript line calling TodoWrite, plus a tool_result echoing it
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[%s]}}]}}\n' "$1"
  printf '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]},"toolUseResult":{"newTodos":[%s]}}\n' "$1"
}
item() { printf '{"content":"%s","status":"%s","activeForm":"%s"}' "$1" "$2" "$3"; }

# 1. no transcript → model · folder only
check "no transcript" "Opus 5.5 · my-repo" "$(run "$(session /nonexistent)")"

# 2. latest TodoWrite wins; in-progress step shown by activeForm
t="$tmp/a.jsonl"
todo_line "$(item P1 pending 'Doing P1')" > "$t"
todo_line "$(item P1 completed 'Doing P1'),$(item P2 in_progress 'Writing the hook'),$(item P3 pending 'Docs')" >> "$t"
check "progress + current step" "Opus 5.5 · my-repo · ✓ 1/3 ▸ Writing the hook" "$(run "$(session "$t")")"

# 3. all done
t="$tmp/b.jsonl"; todo_line "$(item P1 completed x),$(item P2 completed y)" > "$t"
check "all done" "Opus 5.5 · my-repo · ✓ 2/2 all done" "$(run "$(session "$t")")"

# 4. escaped quotes and brackets inside content do not break parsing
t="$tmp/c.jsonl"; todo_line "$(item 'Fix \"quoted\" [a] thing' in_progress 'Fixing \"quoted\" [a]')" > "$t"
check "escapes" 'Opus 5.5 · my-repo · ✓ 0/1 ▸ Fixing "quoted" [a]' "$(run "$(session "$t")")"

# 5. long step is clipped to 60 chars
long="$(printf 'x%.0s' $(seq 1 80))"
t="$tmp/d.jsonl"; todo_line "$(item L in_progress "$long")" > "$t"
out="$(run "$(session "$t")")"; step="${out##*▸ }"
check "clipped step length" "60" "${#step}"

# 6. transcript with no TodoWrite → no task part
t="$tmp/e.jsonl"; echo '{"type":"user","message":{"content":"hi"}}' > "$t"
check "no todo list" "Opus 5.5 · my-repo" "$(run "$(session "$t")")"

# 7. garbage stdin never errors
check "garbage input" "" "$(printf 'not json' | /bin/bash ./task-statusline.sh)"

# Task tools: TaskCreate (id comes back in the result line) and TaskUpdate, as in a real
# Desktop-app transcript (Claude Code 2.1.280).
create() { # tool_use_id, subject, activeForm, id
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"%s","name":"TaskCreate","input":{"subject":"%s","description":"d","activeForm":"%s"}}]}}\n' "$1" "$2" "$3"
  printf '{"type":"user","message":{"content":[{"tool_use_id":"%s","type":"tool_result","content":"Task #%s created"}]},"toolUseResult":{"task":{"id":"%s","subject":"%s"}}}\n' "$1" "$4" "$4" "$2"
}
upd() { # tool_use_id, taskId, status
  printf '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"%s","name":"TaskUpdate","input":{"taskId":"%s","status":"%s"}}]}}\n' "$1" "$2" "$3"
  printf '{"type":"user","message":{"content":[{"tool_use_id":"%s","type":"tool_result","content":"Updated"}]},"toolUseResult":{"success":true}}\n' "$1"
}
t="$tmp/f.jsonl"
{ create u1 Survey Surveying 1; create u2 Delegate Delegating 2; create u3 Wrap Wrapping 3
  upd u4 1 in_progress; upd u5 1 completed; upd u6 2 in_progress; } > "$t"
check "task tools: progress + current" "Opus 5.5 · my-repo · ✓ 1/3 ▸ Delegating" "$(run "$(session "$t")")"
upd u7 3 deleted >> "$t"; upd u8 2 completed >> "$t"
check "task tools: deleted task drops out" "Opus 5.5 · my-repo · ✓ 2/2 all done" "$(run "$(session "$t")")"
upd u9 99 completed >> "$t"
check "task tools: update for unknown id ignored" "Opus 5.5 · my-repo · ✓ 2/2 all done" "$(run "$(session "$t")")"

# Newest family wins: a TodoWrite after Task tools takes over, and vice versa.
todo_line "$(item Z in_progress 'Zapping')" >> "$t"
check "todowrite after task tools wins" "Opus 5.5 · my-repo · ✓ 0/1 ▸ Zapping" "$(run "$(session "$t")")"
create u10 Again Againing 4 >> "$t"
check "task tools after todowrite win" "Opus 5.5 · my-repo · ✓ 2/3" "$(run "$(session "$t")")"

# 8. installer: sets, refuses to clobber, --force, --uninstall (in a throwaway config dir)
export CLAUDE_CONFIG_DIR="$tmp/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"
echo '{"model":"opus"}' > "$CLAUDE_CONFIG_DIR/settings.json"
./install.sh >/dev/null
check "install sets statusLine" "bash \"$CLAUDE_CONFIG_DIR/statusline/task-statusline.sh\"" \
  "$(python3 -c "import json;print(json.load(open('$CLAUDE_CONFIG_DIR/settings.json'))['statusLine']['command'])")"
check "install keeps other keys" "opus" "$(python3 -c "import json;print(json.load(open('$CLAUDE_CONFIG_DIR/settings.json'))['model'])")"
python3 -c "import json;p='$CLAUDE_CONFIG_DIR/settings.json';s=json.load(open(p));s['statusLine']={'type':'command','command':'mine.sh'};json.dump(s,open(p,'w'))"
./install.sh >/dev/null 2>&1; code=$?
check "refuses to replace someone else's statusLine" "3" "$code"
./install.sh --force >/dev/null
check "--force replaces it" "bash \"$CLAUDE_CONFIG_DIR/statusline/task-statusline.sh\"" \
  "$(python3 -c "import json;print(json.load(open('$CLAUDE_CONFIG_DIR/settings.json'))['statusLine']['command'])")"
./install.sh --uninstall >/dev/null
check "--uninstall removes it" "absent" "$(python3 -c "import json;print(json.load(open('$CLAUDE_CONFIG_DIR/settings.json')).get('statusLine','absent'))")"
check "--uninstall removes the script" "no" "$([ -e "$CLAUDE_CONFIG_DIR/statusline/task-statusline.sh" ] && echo yes || echo no)"

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
