# statusline

A Claude Code status line that shows the session's task list:

```
Opus 5.5 · my-repo · ✓ 3/7 ▸ Writing the hook
```

Standalone: no plugin, no node. Bash 3.2+ (macOS's default works), `grep`, `tail`, `awk`. It reads
the session's own transcript, whose path Claude Code passes on stdin, and shows the latest list
written there by either `TodoWrite` or `TaskCreate`/`TaskUpdate`, whichever wrote last.

## Install

```bash
./install.sh              # copies task-statusline.sh to ~/.claude/statusline/, sets "statusLine"
./install.sh --force      # replace an existing status line (settings.json backup kept)
./install.sh --uninstall  # remove it (only if it is still the configured status line)
```

`install.sh` edits `~/.claude/settings.json` with `python3` or `jq`; with neither it prints the
snippet to add by hand. It honours `CLAUDE_CONFIG_DIR`. Takes effect on the next status refresh.

## Notes

- Shows the session's own plan. Subagents keep separate transcripts, so their lists are not here
  (the task-board band and the VS Code extension show those nested).
- Scans only the last 4 MB of the transcript (`TASK_STATUSLINE_TAIL_BYTES` to change), so a plan
  written very early in a very long session may scroll out of reach.
- JSON is parsed with grep/awk, relying on Claude Code's field order for todo items. Unicode
  escapes (`\uXXXX`) in task text are shown as-is.

Tests: `test/run.sh` (18 cases: TodoWrite, Task tools, escapes, clipping, installer).
