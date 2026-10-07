# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
