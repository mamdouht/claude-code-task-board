# task-board

A Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview) — in-process function
hooks, not a classic settings-hook plugin — that draws Claude's current task list, and every
running subagent's nested underneath it, right above the prompt.

Part of the [Claude Code Task Board](../../README.md) suite. See the root README for the full
picture, including the VS Code sidebar companion.

## What it does

- A band above the prompt: `Tasks 3/7 ▸ <current step>`, with a nested line per running subagent:
  `↳ <agent-type> 1/2 ▸ <step>`.
- A **Show all** / **Collapse** toggle on that band that expands every task in every list
  (subagent tasks indented one level deeper than their header row).
- A `/tasks` command that opens the same nested outline in a pane beside the transcript, already
  fully expanded.

It needs nothing else to work — no settings, no config file. It reads the task tool calls
directly (`tool.call`): `TodoWrite` (whole list per call) and `TaskCreate`/`TaskUpdate` (one task
per call — what the Desktop app uses). It keys a subagent's list by its own `agentId` and keeps
everything in plugin state that survives a hot reload. A subagent's list is removed the moment
`classic.SubagentStop` fires for it; `/clear` or exit (`classic.SessionEnd`) clears the board.

## Install

```bash
claude plugin marketplace add /path/to/claude-code-task-board   # or OWNER/claude-code-task-board once pushed
claude plugin install task-board@task-board-suite
```

Run `/reload-plugins` if you installed into an already-open session.

## Requirements

Claude Code CLI **2.1.287+** in a terminal, or Claude Desktop **2.1.286+** for the Code tab — mods
are an early-access feature gated on version. On Claude 5 models, also make sure Claude Code's
`TodoWrite` tool is turned on (`../../scripts/enable-todo-tool.sh` from the repo root) — otherwise
there's no task list for this to show.

## Limits

- **Draws only in a terminal or the Claude Desktop app's Code tab.** The VS Code chat panel runs
  this mod's hooks but is a closed webview that can't be drawn into — nothing appears there. For
  VS Code, install `task-tracker` plus the `vscode-extension` instead.
- Lists only exist when Claude actually calls `TodoWrite` — it won't for every task. See the root
  README's Install section for a `CLAUDE.md` instruction that makes this reliable.
- The mod API this is built on is early access and may change upstream.

## Development

Tests live in `tests/task-board.test.tsx`, run via `claude plugin test plugins/task-board`
(needs the Claude Code CLI ≥ 2.1.287). `../../scripts/test-all.sh` runs this along with everything
else in the repo.
