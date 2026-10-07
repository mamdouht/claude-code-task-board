# task-board: pane command renamed to /task-board (/tasks is Claude Code's own)

## Release notes

- The task-board pane now opens with **`/task-board`**. `/tasks` is Claude Code's built-in
  "View and manage everything running in the background" command, which always won, so the mod's
  pane could never be opened.
- README: why a new session shows no band (it appears once Claude writes a task list) and how to
  check the mod loaded.

## Details

- Reported with a terminal screenshot (Claude Code 2.1.292): typing `/task` offered the built-in
  `/tasks` with its own description; no task-board pane.
- Change: `register.tsx` registers and answers `task-board`; the "… N more" hint and all docs say
  `/task-board`. The band's behaviour is unchanged: it draws nothing until a list exists, which is
  what a fresh session (as in the screenshot) shows.
- Verified on 2.1.292: `claude plugin validate` lists `command.run{command=task-board}` and passes;
  `claude plugin test` 6/6; `tsc` clean. Not verified: the band/pane drawing in a live terminal
  session (needs the user's session; `/plugin` shows "1 mod active · task-board" when loaded).
