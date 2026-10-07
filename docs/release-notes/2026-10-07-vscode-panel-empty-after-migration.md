# VS Code panel: why it went empty after moving to plugins, and a 0/0 label fix

## Release notes

- The Task Board VS Code panel showed nothing after the switch to the plugin-based install. Open
  Claude sessions stop recording until they reload plugins, and VS Code windows keep the old
  extension until reloaded. Fix: `/reload-plugins` in open sessions, **Developer: Reload Window**.
- Extension 0.3.1: a session whose only list is a subagent's now shows that progress instead of
  `0/0`.

## Details

- Reported: "the new VS Code extension doesn't show any tasks anymore".
- Diagnosis: `~/.claude/task-tracker/` held only the Desktop session's file; none of the seven
  open VS Code/CLI sessions had one. The migration removed the settings-file hooks and installed
  task-tracker as a plugin; already-open sessions load plugin hooks only on `/reload-plugins` or
  restart, so they recorded nothing in between. Confirmed by a TodoWrite in a reloaded session,
  whose file appeared immediately, after which `lib/model.js` lists the b2b sessions again. The
  extension id also changed (`claude-task-panel` → `task-board-vscode`), which needs a window
  reload. No extension logic bug was involved.
- Code: `extension.js` session row uses `model.primaryList(session)?.summary` (the subagent's
  list when the session has none). Test added in `test/model.test.js`; README troubleshooting
  gains the reload note.
- Verified: extension tests 15/15; packaged and installed as 0.3.1. Not verified: the panel
  visually after reload.
