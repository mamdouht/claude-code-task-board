# VS Code panel: show the session's own plan even when only the subagent's was recorded

## Release notes

- Fixed: a session could show only its subagent's tasks and not its own plan. The panel now
  rebuilds the session's plan from its transcript when the tracker has no copy of it.

## Details

- Reported with a screenshot: "Customer feedback adjustments…" showed `database-postgres
  (subagent)` with 7 tasks, but no main list.
- Cause: that session's plan (3 TodoWrite calls) was written before the task-tracker plugin's
  hooks were loaded into it; the tracker file was first created later by the subagent's TodoWrite,
  so `lists.main` was empty. Any session where the hook missed the main writes (late install,
  node missing, a hook error) ends up the same way.
- Fix (`vscode-extension/lib/model.js`, 0.3.2): `readPlanFromTranscript(transcriptPath)` reads the
  last 4 MB of the transcript, skips subagent lines (`isSidechain`), and returns the latest
  TodoWrite list or the TaskCreate/TaskUpdate replay (id from `toolUseResult.task.id` or the
  result text "Task #N created"), whichever family wrote last; cached by file size. Used only
  when the tracker file's main list is empty — a recorded list always wins.
- Verified: extension tests 18/18 (TodoWrite rebuild ignoring sidechain lines, Task-tool replay
  with both id sources, recorded list wins); against the real files the session now reads
  `main 3/13 | database-postgres 1/7`; 0.3.2 packaged and installed. Not verified: the panel
  visually after reload.
