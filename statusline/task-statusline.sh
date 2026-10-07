#!/bin/bash
# Claude Code status line: model · folder · ✓ done/total ▸ current step
#
#   Opus 5.5 · my-repo · ✓ 3/7 ▸ Writing the hook
#
# Standalone: it needs no plugin and no node — only bash 3.2+, grep, tail, awk. It reads the
# session's own transcript (Claude Code passes its path on stdin) and shows its task list, from
# whichever tool family wrote last: TodoWrite (whole list per call) or TaskCreate/TaskUpdate (one
# task per call — the Desktop app, and the terminal when the Task tools are on).
# Subagents keep separate transcripts, so this shows the session's own plan only.
#
# Claude Code runs this on every status refresh with the session JSON on stdin; it prints one line.
# Set TASK_STATUSLINE_TAIL_BYTES to change how much of the transcript's end is scanned (default 4 MB).

MAX_STEP_CHARS=60
TAIL_BYTES="${TASK_STATUSLINE_TAIL_BYTES:-4000000}"

input="$(cat)"

# Pull one string field out of a JSON blob (first occurrence). Good enough for Claude Code's flat
# keys; returns the raw JSON-escaped text.
json_field() {
  printf '%s' "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -1 |
    sed -E "s/^\"$2\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//"
}

# Minimal JSON string unescape: \" \\ \/ \n \t. (\uXXXX is left as-is.)
unescape() {
  printf '%s' "$1" | sed -e 's/\\"/"/g' -e 's#\\/#/#g' -e 's/\\n/ /g' -e 's/\\t/ /g' -e 's/\\\\/\\/g'
}

model="$(unescape "$(json_field "$input" display_name)")"
dir="$(unescape "$(json_field "$input" current_dir)")"
[ -n "$dir" ] || dir="$(unescape "$(json_field "$input" cwd)")"
transcript="$(unescape "$(json_field "$input" transcript_path)")"

parts=()
[ -n "$model" ] && parts+=("$model")
[ -n "$dir" ] && parts+=("${dir##*/}")

# Prints "done<TAB>total<TAB>current step" for the session's latest task list, or nothing.
todowrite_summary() { # $1 = the newest TodoWrite tool_use line
  local rest list items item total=0 done_count=0 current=""
  rest="${1#*\"todos\":[}"   # after the FIRST "todos":[ (the call's input, not its echoed result)
  list="${rest%%\}]*}"       # up to the end of that array
  items="$(printf '%s}' "$list" |
    grep -oE '"content":"([^"\\]|\\.)*","status":"(pending|in_progress|completed)","activeForm":"([^"\\]|\\.)*"')"
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    total=$((total + 1))
    case "$item" in
      *'"status":"completed"'*) done_count=$((done_count + 1)) ;;
      *'"status":"in_progress"'*)
        if [ -z "$current" ]; then
          current="$(json_field "$item" activeForm)"
          [ -n "$current" ] || current="$(json_field "$item" content)"
        fi ;;
    esac
  done <<< "$items"
  [ "$total" -gt 0 ] && printf '%s\t%s\t%s' "$done_count" "$total" "$current"
}

# Replays TaskCreate (id from the result line's "toolUseResult":{"task":{"id":..}}) and TaskUpdate
# ({taskId,status,...}; status "deleted" drops the task) over the transcript, in order.
tasktools_summary() { # stdin = transcript lines
  awk '
    function field(s, key,   m) {
      if (match(s, "\"" key "\":\"([^\"\\\\]|\\\\.)*\"")) {
        m = substr(s, RSTART + length(key) + 4, RLENGTH - length(key) - 5); return m
      }
      return ""
    }
    {
      line = $0
      while (match(line, /"type":"tool_use","id":"[^"]*","name":"Task(Create|Update)","input":\{[^}]*\}/)) {
        blk = substr(line, RSTART, RLENGTH); line = substr(line, RSTART + RLENGTH)
        tuid = field(blk, "id")
        if (blk ~ /"name":"TaskCreate"/) {
          subj = field(blk, "subject"); act = field(blk, "activeForm")
          pending[tuid] = subj "\t" (act != "" ? act : subj)
        } else {
          id = field(blk, "taskId"); st = field(blk, "status")
          if (!(id in state)) continue
          if (st == "deleted") { deleted[id] = 1; continue }
          if (st != "") state[id] = st
          a = field(blk, "activeForm"); if (a != "") act_of[id] = a
        }
      }
      if ($0 ~ /"toolUseResult":\{"task":\{"id":"/ && match($0, /"tool_use_id":"[^"]*"/)) {
        tuid = substr($0, RSTART + 15, RLENGTH - 16)
        if (tuid in pending) {
          match($0, /"toolUseResult":\{"task":\{"id":"[^"]*"/)
          id = substr($0, RSTART + 31, RLENGTH - 32)
          split(pending[tuid], p, "\t")
          if (!(id in state)) order[++n] = id
          state[id] = "pending"; act_of[id] = p[2]; delete deleted[id]
          delete pending[tuid]
        }
      }
    }
    END {
      for (i = 1; i <= n; i++) {
        id = order[i]; if (id in deleted) continue
        total++
        if (state[id] == "completed") done++
        else if (state[id] == "in_progress" && cur == "") cur = act_of[id]
      }
      if (total > 0) printf "%d\t%d\t%s", done, total, cur
    }'
}

tasks=""
if [ -n "$transcript" ] && [ -r "$transcript" ]; then
  tail_text="$(tail -c "$TAIL_BYTES" "$transcript" 2>/dev/null)"
  # Whichever family wrote last decides (a session may switch, e.g. after an upgrade).
  todo_at="$(printf '%s\n' "$tail_text" | grep -n '"name":"TodoWrite"' | grep '"type":"tool_use"' | tail -1 | cut -d: -f1)"
  task_at="$(printf '%s\n' "$tail_text" | grep -n -E '"name":"Task(Create|Update)"' | grep '"type":"tool_use"' | tail -1 | cut -d: -f1)"
  summary=""
  if [ -n "$task_at" ] && [ "${task_at:-0}" -gt "${todo_at:-0}" ]; then
    summary="$(printf '%s\n' "$tail_text" | tasktools_summary)"
  elif [ -n "$todo_at" ]; then
    summary="$(todowrite_summary "$(printf '%s\n' "$tail_text" | sed -n "${todo_at}p")")"
  fi
  if [ -n "$summary" ]; then
    done_count="${summary%%$'\t'*}"; rest="${summary#*$'\t'}"
    total="${rest%%$'\t'*}"; current="$(unescape "${rest#*$'\t'}")"
    tasks="✓ $done_count/$total"
    if [ "$done_count" -eq "$total" ]; then
      tasks="$tasks all done"
    elif [ -n "$current" ]; then
      [ "${#current}" -gt "$MAX_STEP_CHARS" ] && current="${current:0:$((MAX_STEP_CHARS - 1))}…"
      tasks="$tasks ▸ $current"
    fi
  fi
fi
[ -n "$tasks" ] && parts+=("$tasks")

out=""
for p in "${parts[@]}"; do
  if [ -z "$out" ]; then out="$p"; else out="$out · $p"; fi
done
printf '%s' "$out"
