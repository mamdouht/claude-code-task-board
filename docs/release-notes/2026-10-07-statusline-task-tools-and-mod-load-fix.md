# Standalone status line, Task-tool support, and a mod load fix

## Release notes

- **New: a standalone status line.** `statusline/install.sh` sets Claude Code's status line to
  `Model · folder · ✓ 3/7 ▸ current step`. It needs no plugin and no node — just bash.
- **The Desktop app's task lists now show.** The Desktop app writes tasks with `TaskCreate` /
  `TaskUpdate` instead of `TodoWrite`; the task-board band and the status line now read both.
- **Fixed:** task-board could fail to load with "`session.end` is not an event". It now uses an
  event every engine knows.

## Details

- Reported: (1) a terminal session printed `task-board: hooks module did not load ...
  "session.end" is not an event`; (2) in the Desktop app the subagent's tasks did not appear nested.
- (1) Cause: that terminal ran Claude Code 2.1.273, which predates mods (2.1.287+). It also rejects
  the mod's `$.state` helpers, so the mod cannot load there at all — the fix for the user is
  `claude update`. Independently, `session.end` was replaced with `classic.SessionEnd` (same
  `/clear`/exit signal, `reason` field), which is the more widely supported event.
- (2) From the Desktop session's transcript (`entrypoint: claude-desktop`, version 2.1.280):
  - The mod could not load — Desktop needs 2.1.286+ for mods. The "Plan → Tasks" pane in the
    screenshots is the Desktop app's own, which shows the main list only.
  - The main loop used `TaskCreate` ×4 / `TaskUpdate` ×8 and no `TodoWrite`, so even a loaded mod
    would have shown nothing. Fixed: `register.tsx` handles both families (create recorded after
    the call, id from `result.task.id`; update by `taskId`; `deleted` drops). Real payload shapes
    are now recorded in `docs/how-it-works.md`, replacing the earlier "never observed" note.
  - The subagent called `ToolSearch` for `TaskCreate,TaskUpdate` and for "todo task list" and got
    neither, so it had no list to report. Not fixable here; documented in README Troubleshooting.
- Status line (`statusline/`): bash 3.2-safe; picks whichever tool family wrote last in the last
  4 MB of the transcript; TodoWrite via the first `"todos":[` of the newest call; Task tools
  replayed in awk (associative arrays bash 3.2 lacks). Installer edits settings with python3 or
  jq, refuses to replace another status line without `--force`, keeps a backup. Replaces the
  node status line dropped from the suite earlier the same day.
- Verified: task-tracker 11/11, extension 15/15, status line 18/18 (incl. Task tools, deleted
  tasks, unknown ids, family switching, installer clobber protection); replaying the real Desktop
  transcript call by call gives 0/1 → 0/4 → 2/4 → 4/4 all done; `claude plugin validate` (2.1.289)
  passes for the marketplace and both plugins; `tsc` strict clean for the mod including new tests.
- Not verified: the mod's own suite — `claude plugin test` still reports mods "turned off ...
  rollout switch saved off by an earlier session". The band in a 2.1.286+ Desktop app, and
  nesting in any setup where subagents have no task tool.
