# task-tracker

A Claude Code plugin of classic settings hooks that records every session's task lists to disk,
so something outside the `claude` process — like a VS Code sidebar — can read them.

Part of the [Claude Code Task Board](../../README.md) suite. It has no UI of its own; see the
root README for how it's meant to be used, and [`vscode-extension`](../../vscode-extension/README.md)
for the viewer this was built for.

## What it does

Three hooks (`hooks/hooks.json`):

- **`PostToolUse`**, matched on `TodoWrite|TaskCreate|TaskUpdate` — writes (or updates) the
  calling session's task list. A subagent's calls are keyed apart by its own `agent_id`, with its
  `agent_type` recorded alongside so a viewer can label it.
- **`SubagentStop`** — removes that subagent's list; the session's own list is untouched.
- **`SessionEnd`** — deletes the whole session's file (covers exit, `/clear`, logout). A session
  whose tab was simply killed won't fire this — viewers compensate by checking Claude Code's own
  session registry (see [`docs/how-it-works.md`](../../docs/how-it-works.md)).

State lands at `~/.claude/task-tracker/<session_id>.json` (override with the `TASK_TRACKER_DIR`
environment variable), written atomically (tmp file + rename) so a reader never sees a half-written
file. Files untouched for 7+ days get pruned, probabilistically, on later hook runs.

This plugin never blocks or fails the session it's attached to: every hook invocation swallows its
own errors and always exits 0 with no output, and if no `node` binary can be found on `PATH` (or
the usual Homebrew/Volta/nvm locations), it silently does nothing at all.

## Install

```bash
claude plugin marketplace add /path/to/claude-code-task-board   # or OWNER/claude-code-task-board once pushed
claude plugin install task-tracker@task-board-suite
```

Run `/reload-plugins` if you installed into an already-open session.

## Requirements

A `node` binary reachable from `run.sh` (PATH, Homebrew, Volta, or nvm's default alias) — without
one, the hook no-ops and no state files appear. On Claude 5 models, also make sure Claude Code's
`TodoWrite` tool is turned on (`../../scripts/enable-todo-tool.sh` from the repo root).

## Limits

- `TaskCreate`/`TaskUpdate` payload field names were never confirmed against a real transcript —
  they're parsed defensively, trying several plausible field names. `TodoWrite`'s shape is fully
  confirmed and is the reliable path.
- Writes files to disk under your home directory; nothing is sent anywhere, but the task text you
  (or Claude) write is sitting there in plain JSON for as long as the session lives (or up to 7
  days after, until pruning catches it).
- This plugin produces data only. Without a viewer — the `vscode-extension` here, or something
  you build yourself against the state file contract in
  [`docs/how-it-works.md`](../../docs/how-it-works.md) — nothing reads it.

## Development

```bash
node --test test/
```

`../../scripts/test-all.sh` runs this along with everything else in the repo; CI
(`.github/workflows/test.yml`) runs it on every push and pull request.
