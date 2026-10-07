# Subagent Task-tool lists: take the task id from the result text when needed

## Release notes

- More reliable nesting for subagents in the Desktop app: when a subagent's new task comes back
  only as text ("Task #5 created successfully"), the board and the tracker now still pick up its id.
- The mod's own test suite runs again (6/6) now that mods are enabled on the test machine.

## Details

- Evidence (Desktop app, Claude Code 2.1.289, session 32a2f50e…): the subagent called TaskCreate ×3
  and TaskUpdate ×6. Its transcript records the create result only as the text
  `"Task #5 created successfully: <subject>"` — no structured `toolUseResult.task.id`, unlike the
  main loop. Task ids are numbered per session: the subagent's first task was #5, after the main
  session's #1–#4.
- Change: `register.tsx` falls back to `createdIdFromText(ran.text)`; task-tracker's `pickTaskId`
  tries `idFromText(tool_response)` before the input fields. If the structured id is present (the
  likely case for live hook payloads) nothing changes.
- The Desktop app's built-in "Plan → Tasks" pane shows the main session's tasks only; subagent
  tasks can appear in the task-board band (Desktop 2.1.286+) and the VS Code extension, not there.
- Verified: task-tracker 12/12 (new text-id case); `claude plugin test` 6/6 and `plugin validate`
  on Claude Code 2.1.292; `tsc` clean. Not verified: the band drawing in a live Desktop or
  terminal session.
