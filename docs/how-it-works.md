# How it works

A design reference for anyone extending this project. The [root README](../README.md) is the
user-facing entry point; this document is the contributor-facing one — the state file contract,
why each signal was chosen, and findings from building against undocumented Claude Code internals.

## The shared source event

Everything here starts from Claude Code's `TodoWrite` tool call (plus, for `task-tracker` only,
the still-unobserved `TaskCreate`/`TaskUpdate` tools — see [Open questions](#open-questions-and-known-gaps)
below). There is exactly one source of truth: the tool call itself. Neither component asks Claude
to report its own progress separately, so there's nothing to drift out of sync with the real plan.

Two independent consumers read that same event through two different mechanisms, because they run
in different processes with no shared memory:

| | task-board | task-tracker |
|---|---|---|
| Runs as | an in-process mod (function hooks, same Node process as `claude`) | a classic hook (a separate `node` subprocess per event) |
| Reads via | `on('tool.call', { tool: 'TodoWrite' }, ...)` — direct event payload | `PostToolUse` → JSON on stdin |
| Keeps state in | plugin state atoms (`$.state`, in-memory, survives hot reload) | a JSON file on disk (the subprocess exits after every call) |
| Draws | yes — a band/pane, inside the same process | no — it only writes data |

## The task-tracker state file contract

One file per Claude Code session: `~/.claude/task-tracker/<session_id>.json` (or
`$TASK_TRACKER_DIR/<session_id>.json` if that env var is set — see `plugins/task-tracker/lib/state.mjs`).
Session ids are sanitized to `[A-Za-z0-9_-]` before touching the filesystem; nothing untrusted
reaches a path.

```jsonc
{
  "version": 1,
  "sessionId": "abc123",
  "cwd": "/path/to/project",
  "transcriptPath": "/path/to/transcript.jsonl",  // used by viewers to read the session's title
  "pid": 4821,                                    // CLAUDE_PID, as seen by the hook
  "updatedAt": "2026-10-07T12:34:56.000Z",
  "lists": {
    "main": [ /* Task[] — the session's own plan */ ],
    "<agentId>": [ /* Task[] — one key per running/finished-but-not-yet-stopped subagent */ ]
  },
  "agents": {
    "<agentId>": { "type": "testing-playwright-jest" }   // from the TaskCreate/TodoWrite payload's agent_type
  }
}
```

`Task` = `{ id, content, activeForm?, status: "pending" | "in_progress" | "completed" }`.

Writes are atomic: `<file>.<pid>.tmp` is written, then `fs.renameSync`'d over the real path, so a
reader never sees a half-written file (`writeState` in `lib/state.mjs`). `readState` additionally
refuses anything whose `version` doesn't match `STATE_VERSION` (`1`), so a future format change
degrades to "no state" instead of a crash.

**Design note — why SessionEnd deletes the file instead of stamping it closed.** An earlier
revision (referenced as "0.2.0" in the vscode-extension's own test suite,
`vscode-extension/test/model.test.js`) stamped an `endedAt` timestamp on the file when a session
ended, and left the file for the viewer to garbage-collect. The current `task-tracker` just
deletes the file outright in `handleSessionEnd` — simpler, and it means a reader never has to care
whether a file it's looking at is current. `vscode-extension/lib/model.js` still *checks* for a
stray `endedAt` (`if (state.endedAt) return "closed"`) purely for backward compatibility with any
file written by that older version; nothing in the current hook ever sets it again. If you're
reading this to understand why that check exists and looks dead: that's why.

## Why each signal was picked

**task-board** (`plugins/task-board/hooks/register.tsx`):

- `tool.call` on `TodoWrite` — recorded *before* the tool runs, so the band updates the instant
  Claude commits to a new plan, not after some later round-trip.
- `classic.SubagentStart` — the only place a subagent's `agent_type` is available, so this is
  where the label (`testing-playwright-jest`, etc.) gets attached to its id.
- `classic.SubagentStop` — the subagent's list is scoped to its own lifetime; once it stops, its
  row should disappear even if the session's own list lives on.
- `classic.SessionEnd` — a `/clear` starts a logically new session; a stale plan from before the
  clear would be actively misleading, so everything is wiped. (Not the mod-native `session.end`:
  some engines reject it as "not an event", which fails the whole module.)
- `TaskCreate`/`TaskUpdate` are handled alongside `TodoWrite`: the Desktop app uses them. Create is
  recorded after the tool runs, because the new task's id comes back in the result
  (`result.task.id`); the hook branches on `e.tool` by name, since these tools are missing from a
  session's typed tool table whenever they are switched off there.
- No settings hook, no plugin configuration file. The mod needs nothing external — it only ever
  reads events it's handed.

**task-tracker** (`plugins/task-tracker/hooks/hooks.json`):

- `PostToolUse` matched on `TodoWrite|TaskCreate|TaskUpdate` — *Post*, not Pre, because the hook
  also wants `tool_response` (used defensively to find an id on `TaskCreate`/`TaskUpdate`; see
  below).
- `SubagentStop` — mirrors task-board's reasoning: a finished subagent's list is removed, scoped
  by `agent_id`, while the session's own list is untouched.
- `SessionEnd` — covers the clean-exit cases (exit, `/clear`, logout). A session whose tab was
  simply killed may never fire this; see the next section for how viewers compensate.
- Every event is routed through one script, `run.sh`, which resolves a `node` binary from `PATH`
  then a short list of common install locations (Homebrew, Volta, nvm's default alias), and
  **silently no-ops** (reads stdin, exits 0) if none is found. A hook must never be the reason a
  Claude Code session breaks or stalls — that constraint shaped the entire design: every error in
  `task-tracker-hook.mjs`'s `main()` is swallowed, and the process always exits 0.
- Pruning (`pruneOld`, files untouched for 7+ days) runs probabilistically — a 5% chance on any
  given hook invocation — rather than on a timer, since the hook has no persistent process to
  schedule one from.

## Detecting a closed session without a SessionEnd event

A tab closed by killing the terminal, or a crashed `claude` process, never fires `SessionEnd` —
`task-tracker`'s file is left behind with a stale `updatedAt`. Rather than guessing from age alone,
`vscode-extension/lib/model.js` cross-checks Claude Code's own session registry,
`~/.claude/sessions/<pid>.json` (one file per live session, containing at least `{ pid, sessionId }`),
and confirms the PID is actually alive with `process.kill(pid, 0)`.

Three tiers, deliberately ordered by how much they trust the evidence (`endedReason` in
`lib/model.js`):

1. **The registry is readable and non-empty.** Trust it completely: a session not listed there, or
   whose own recorded PID in the state file is dead, is `"closed"` and its state file is deleted.
2. **The registry is missing or came back empty.** Treated as *unknown*, never as "everything is
   closed" — an empty or unreadable registry wiping every open session's list the moment Claude
   Code changes its registry format (or the directory is briefly mid-write) would be a far worse
   failure than showing one stale entry a little too long. Falls back to the PID the hook itself
   recorded in the state file.
3. **No registry and no PID to check at all** (e.g., very old state, or `CLAUDE_PID` wasn't set at
   hook time). The list is only *hidden* once it's gone an hour without an update — never deleted,
   since there's no positive evidence it's actually closed.

A 60-second grace window (`REMOVE_GRACE_MS`) additionally protects any file updated more recently
than that from being removed at all, closing the gap between a new session starting and Claude
Code's registry entry for it actually landing on disk.

## The Codex CLI data path (vscode-extension only)

Unlike the two sources above, OpenAI Codex CLI plans don't go through a hook at all — Codex has no
plugin system task-tracker could hook into. `vscode-extension/lib/codex.js` reads Codex's own
session rollout files (`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`) directly and converts
the latest plan-like event in each into the same session shape `lib/model.js` produces
(`sessionId`, `title`, `cwd`, `updatedAt`, `ended`, `tasks`, `subagents: []`, `summary`), tagged
`source: "codex"`, so `extension.js` can merge and render both in one tree.

This is reading an **undocumented, unversioned log format** — reverse-engineered from real
`rollout-*.jsonl` files on one machine (Codex CLI 0.159.2, `cli` and `codex_vscode`
originators), not a published API, and it can change without notice. The full schema notes (what
was actually observed vs. assumed) live in the header comment of `lib/codex.js` itself and in
[`docs/features/vscode-codex-plans.md`](features/vscode-codex-plans.md) — read those before
touching this code. In short:

- Only two plan-like events were ever found in real files: Plan Mode's `item_completed` /
  `item.type: "Plan"` (a markdown document, no per-step status), and `update_plan` function calls
  (which *would* carry per-step status) — the latter was never actually observed and is
  implemented from Codex's published tool schema alone.
- "Ended" has no registry to check (unlike Claude Code's `~/.claude/sessions`), so it's
  approximated from the rollout file's own mtime going 15 minutes idle.
- Parsing is defensive everywhere a format assumption could be wrong: malformed JSON lines are
  skipped, an unrecognized plan shape falls through to "no plan" rather than throwing, and an
  unknown per-step status defaults to `pending`.

## Reading a session's display name

Claude Code appends `{"type":"ai-title","aiTitle":"...",...}` rows to a session's transcript as it
renames the tab. `readSessionTitle` in `lib/model.js` doesn't parse the whole (potentially huge)
transcript — it reads only the last 256 KB of the file and regex-matches the last `aiTitle` it
finds there, caching by file size so an unchanged transcript is never re-read. This is reading an
internal, undocumented log format, not a stable API; if Claude Code changes how or where it writes
that row, title lookup degrades to `undefined` (the session still shows, just unlabeled) rather
than failing loudly.

## Open questions and known gaps

- **`TaskCreate`/`TaskUpdate` shapes come from one real transcript** (Desktop app, Claude Code
  2.1.280): create `{ subject, description, activeForm }` → result `{ task: { id, subject } }`;
  update `{ taskId, status }`, with `status: "deleted"` removing the task. `lib/state.mjs` also
  tries alternative field names in case other versions differ.
- **Subagents without a task tool**: in that same Desktop session the subagent looked for
  `TaskCreate`/`TaskUpdate` and a todo tool and found neither, so it could not report a list.
  Nesting depends on Claude Code giving subagents a task tool.
- **Plugin naming**: names starting with `claude-` are reserved by Claude Code's plugin system,
  which is why this suite is `task-board` / `task-tracker` / `task-board-suite` rather than
  anything prefixed `claude-`.
- **Mods only draw in a terminal or the Desktop app's Code tab** (per Anthropic's own docs on
  "Where mods run") — a hard platform constraint, not a bug in `task-board`. It's the entire
  reason `task-tracker` + `vscode-extension` exist as a separate pipeline: there is no way for a
  mod to draw inside VS Code's own Claude chat panel, because that panel is a closed webview the
  mod API cannot reach.
- Everything above is read from Claude Code internals that are not a published, versioned API.
  Expect to revisit this document after any Claude Code upgrade that changes session registry
  format, transcript row shapes, or the model allowlist gating `TodoWrite`.
- The Codex CLI data path (see above) carries the same caveat for Codex: its rollout file format
  is undocumented and unversioned, and the `update_plan` parsing path in particular has never been
  exercised against a real file. See [`docs/features/vscode-codex-plans.md`](features/vscode-codex-plans.md).
