# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **statusline**: standalone status line (`statusline/task-statusline.sh`, bash 3.2+, no plugin or
  node) with `install.sh` (`--force`, `--uninstall`). Reads the session transcript directly.
- task-board mod and status line read `TaskCreate`/`TaskUpdate` (the Desktop app's task tools),
  not only `TodoWrite`.

### Fixed
- VS Code extension 0.3.1: a session whose only list is a subagent's showed `0/0`; it now shows
  the subagent's progress.
- task-board failed to load on engines that do not know the `session.end` event
  ("`session.end` is not an event"); it now clears on `classic.SessionEnd`.

## [0.1.0] - 2026-10-07

Initial public release.

### Added

- **task-board** (Claude Code mod, `v0.1.0`) — a band above the prompt and a `/tasks` pane
  showing Claude's task list, plus each running subagent's nested underneath. Draws in a
  terminal (including VS Code's and JetBrains' integrated terminals) and the Claude Desktop
  app's Code tab.
- **task-tracker** (Claude Code plugin, `v0.1.0`) — classic hooks (`PostToolUse`, `SubagentStop`,
  `SessionEnd`) that record every session's task lists to
  `~/.claude/task-tracker/<session_id>.json`, for viewers running outside the `claude` process.
- **vscode-extension**, "Task Board for Claude Code" (`v0.3.0` — versioned independently of the
  other two; it went through more internal iterations before this project's first public
  release) — a VS Code sidebar view ("Claude Tasks") and status bar item that read
  task-tracker's state files. Requires task-tracker to be installed alongside it. Not yet
  published to the VS Code Marketplace; install from a locally built `.vsix`.
