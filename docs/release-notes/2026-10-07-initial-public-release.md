# Initial public release: task-board mod, task-tracker plugin, Task Board VS Code extension

## Release notes

- First release of Claude Code Task Board: see Claude's task list, and every subagent's nested
  under it, while it works.
- **task-board** (mod): a band above the prompt plus a `/tasks` pane, in the terminal and the
  Claude Desktop app.
- **task-tracker** (plugin): records each session's lists so other tools can show them.
- **Task Board for Claude Code** (VS Code extension): a sidebar view and status bar item beside
  the Claude chat panel. Needs task-tracker.
- One-time setup script turns on Claude Code's todo tool for Claude 5 models.

## Details

- Extracted from the author's private config repo, where it was built and used on 2026-10-06/07.
  Changes on extraction: task-tracker converted from an `install.sh` that edited `settings.json`
  into a real plugin (`hooks/hooks.json`, `${CLAUDE_PLUGIN_ROOT}`); its status-line script dropped
  (plugins cannot set `statusLine` or `env` — plugin `settings.json` honours only `agent` and
  `subagentStatusLine` — and the task-board band covers the terminal); `run.sh` looks for node in
  PATH, Homebrew, Volta, nvm; the extension renamed to `task-board-vscode` / "Task Board for
  Claude Code" (the old id was `claude-task-panel`); marketplace `task-board-suite` (names starting
  `claude-` are reserved). Added MIT LICENSE, CHANGELOG, `scripts/enable-todo-tool.sh`,
  `scripts/test-all.sh`, a node-only CI workflow, and the docs (README, `docs/how-it-works.md`,
  per-component READMEs).
- Verified: `node --test` task-tracker 11/11, extension 15/15; `claude plugin validate` (2.1.289)
  passes for the marketplace and both plugins; the extension packages (`vsce`) and installs; both
  plugins install from this folder and the hook writes state in a smoke test. The mod's suite
  (`claude plugin test`) passed 4/4 with this exact code earlier in the session.
- Not verified at commit time: re-running the mod's suite — the local CLI now reports mods
  "turned off ... rollout switch saved off by an earlier session"; it says to start `claude` once
  with network access and retry. Nothing in the repo or user settings disables mods. Also not
  verified: the band in a real terminal session, Windows, a pushed GitHub install (OWNER is a
  placeholder in the README), and Marketplace publishing (needs a PNG icon and repository URL).
