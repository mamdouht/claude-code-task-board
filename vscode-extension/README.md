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
  shows `done/total · Claude · relative time`; expanding it shows the task rows (✅ done, ⏳ in
  progress, ⬜ pending) and any running subagent, nested and labeled `<type> (subagent)`, expanded
  by default while it's active.
- Also shows plans from the **OpenAI Codex CLI** (`done/total · Codex · relative time`), read
  directly from Codex's own `~/.codex/sessions/**/rollout-*.jsonl` files — no plugin or hook
  needed on the Codex side. Codex plans are always flat (no subagent nesting). Turn this off with
  `claudeTasks.codexEnabled`. See [`docs/features/vscode-codex-plans.md`](../docs/features/vscode-codex-plans.md)
  for the schema this is read from and its known approximations.
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
| `claudeTasks.codexEnabled` | `true` | Also show plans from the OpenAI Codex CLI, read directly from its session rollout files. |
| `claudeTasks.codexSessionsDir` | `""` | Directory of Codex CLI rollout session files. Empty means `~/.codex/sessions`. |

## Limits

- Needs `task-tracker` installed and producing files; this extension has no other data source.
- Session titles come from scraping the transcript's `ai-title` rows and matching against the
  active VS Code tab label — if a tab label is truncated or renamed, matching falls back to "the
  newest unfinished session" rather than failing.
- Closed-session detection leans on Claude Code's undocumented `~/.claude/sessions` registry; see
  the Limitations section of the [root README](../README.md#limitations--caveats) for the honest
  list of what this depends on and what can go wrong.
- Tested on macOS and Linux; Windows is untested.
- Codex support reads an **undocumented, unversioned file format** reverse-engineered from real
  rollout files on one machine — it can change without notice. "Ended" is approximated from file
  idle time (no liveness registry like Claude Code's); a Plan Mode plan (the only plan source ever
  actually observed) carries no per-step status, so every step shows pending until Codex's
  `task_complete` for that plan arrives, then all of them flip to completed together. The
  `update_plan` tool (which would give real per-step status) has never been observed in practice —
  its parsing is implemented from Codex's tool schema, not a confirmed example. Full detail in
  [`docs/features/vscode-codex-plans.md`](../docs/features/vscode-codex-plans.md).

## Development

```bash
npm test           # node --test test/ (unit tests, no VS Code needed)
npm run test:e2e   # launches a real VS Code with the extension loaded (see below)
```

Running the e2e test: it downloads VS Code into `.vscode-test/` on first run (needs network),
then opens it against synthetic Claude/Codex fixtures in a temp dir (`test-e2e/`; your real
`~/.claude` and `~/.codex` are never read) and asserts what the Claude Tasks tree shows. It reads
the tree through the `getTreeSnapshot()` test hook that `activate()` returns. Not packaged in the
`.vsix`.

`lib/model.js` is the data layer for Claude/task-tracker sessions and `lib/codex.js` is the data
layer for Codex CLI sessions — neither has a `vscode` import, so both are plain-Node testable;
`extension.js` is just VS Code glue on top of them.
