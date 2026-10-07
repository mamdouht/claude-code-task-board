# Task Board for Claude Code (VS Code extension)

A VS Code sidebar view and status bar item showing Claude Code's per-session task lists — and
each running subagent's, nested — written by the [`task-tracker`](../plugins/task-tracker)
plugin. **Requires `task-tracker` to be installed**; this extension only reads its output, it
produces none of its own.

Part of the [Claude Code Task Board](../README.md) suite. See the root README for the full
picture, including the terminal/Desktop-app mod this complements.

Note: this file is not shipped inside the published `.vsix` — `npm run package` uses
[`media/vsix-readme.md`](media/vsix-readme.md) instead, since `vsce` can't resolve this file's
relative links once it's packaged. This one is for the GitHub repo.

## What it does

- **Claude Tasks** activity-bar view: every session with an active task list, the one matching
  your focused Claude chat tab on top and expanded, the rest newest-first and collapsed. Each
  shows `done/total · relative time`; expanding it shows the task rows (✅ done, ⏳ in progress,
  ⬜ pending) and any running subagent, nested and labeled `<type> (subagent)`, expanded by
  default while it's active.
- A **status bar item** mirroring whichever list is currently focused — the session's own, or a
  running subagent's if the session has none of its own right now — with a small robot icon when
  it's following a subagent.
- The view's badge shows how many sessions still have unfinished work.
- Commands (Command Palette): **Claude Tasks: Refresh**, **Claude Tasks: Show Task List**,
  **Claude Tasks: Toggle: Current Workspace Only**.
- Live updates via a filesystem watch (debounced) plus a 10-second poll, so it stays current even
  if a watch event is missed.
- Closed sessions are removed within about 10 seconds by cross-checking Claude Code's own session
  registry; see [`docs/how-it-works.md`](../docs/how-it-works.md) for exactly how that's decided
  and the fallbacks when the registry itself is unavailable.

## Install

Not on the VS Code Marketplace yet — build the `.vsix` locally:

```bash
cd vscode-extension
npm run package                       # → dist/task-board-vscode.vsix
code --install-extension dist/task-board-vscode.vsix
```

Then run **Developer: Reload Window** in VS Code (reloads only that window). You'll also need
`task-tracker` installed as a Claude Code plugin — see the [root README](../README.md#install).

## Settings

`Settings → Extensions → Claude Tasks`, or `claudeTasks.*` in `settings.json`:

| Setting | Default | Meaning |
|---|---|---|
| `claudeTasks.currentWorkspaceOnly` | `true` | Only show sessions whose working directory is inside a currently open workspace folder. |
| `claudeTasks.maxAgeHours` | `24` | Hide a session once its task list has gone this many hours without an update. `0` = never hide. |
| `claudeTasks.stateDir` | `""` | Where to read `task-tracker`'s files from. Empty means `~/.claude/task-tracker`. |

## Limits

- Needs `task-tracker` installed and producing files; this extension has no other data source.
- Session titles come from scraping the transcript's `ai-title` rows and matching against the
  active VS Code tab label — if a tab label is truncated or renamed, matching falls back to "the
  newest unfinished session" rather than failing.
- Closed-session detection leans on Claude Code's undocumented `~/.claude/sessions` registry; see
  the Limitations section of the [root README](../README.md#limitations--caveats) for the honest
  list of what this depends on and what can go wrong.
- Tested on macOS and Linux; Windows is untested.

## Development

```bash
npm test   # node --test test/
```

`lib/model.js` is the entire data layer and has no `vscode` import, so it's plain-Node testable;
`extension.js` is just VS Code glue on top of it.
