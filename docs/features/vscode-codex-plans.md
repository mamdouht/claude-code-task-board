# Feature: VS Code extension — OpenAI Codex CLI plans

**Status:** in progress (uncommitted) · **Updated:** 2026-10-07

## What it does

The "Claude Tasks" VS Code sidebar and status bar also show plans from **OpenAI Codex CLI**
sessions, merged into the same tree as Claude Code sessions. Each row is labeled `Claude` or
`Codex` (`done/total · <source> · relative time`) so the two are distinguishable. Codex plans are
always flat — no subagent nesting, since Codex exposes no subagent concept in this data. The
feature is on by default and needs nothing installed on the Codex side; it reads Codex's own
session files directly.

## How it works

Unlike the Claude Code path (which goes through the `task-tracker` plugin's hooks writing JSON
state files), Codex CLI has no plugin/hook system to intercept. There was no retrofit available
other than reading Codex's own session transcript — its "rollout" `.jsonl` files — directly off
disk.

```mermaid
flowchart LR
    subgraph codexproc["codex CLI process"]
        PLAN["Plan Mode doc / update_plan call"]
        ROLLOUT["~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl"]
        PLAN --> ROLLOUT
    end

    subgraph vsc["VS Code extension"]
        READ["lib/codex.js: head+tail read,\nlatest plan-like event wins"]
        MERGE["extension.js: merge with\nmodel.loadSessions(), sort by updatedAt"]
        VIEW["Claude Tasks view + status bar\n(labeled Claude / Codex)"]
        ROLLOUT -.->|fs.watch (recursive, best-effort)\n+ 10s poll fallback| READ --> MERGE --> VIEW
    end
```

- `extension.js`'s `config()` reads `claudeTasks.codexEnabled` (default `true`) and
  `claudeTasks.codexSessionsDir` (default `~/.codex/sessions`).
- `TasksProvider.refresh()` calls `codex.loadCodexSessions(...)` alongside the existing
  `model.loadSessions(...)`, concatenates both lists, tags each with `source` (`"claude"` or
  `"codex"`), and sorts the merged list by `updatedAt`.
- `lib/codex.js` walks the sessions directory (bounded depth, newest-mtime-first, capped file
  count), reads each candidate rollout file's head (64 KB — `session_meta` is always line 0) and
  tail (2 MB — the latest plan event is usually near the end), parses it line-by-line as JSON
  (tolerating malformed/truncated lines), and scans for the **latest** plan-like event by
  `ordinal`. A file with no plan-like event returns `null` and is not shown — most Codex sessions
  never call `update_plan` or enter Plan Mode.
- Two plan-like event shapes are recognized (see schema notes below): a Plan Mode markdown
  document, and an `update_plan` function call. Whichever has the highest `ordinal` wins.
- Results are cached per file by `{size, mtimeMs}` so an unchanged multi-MB rollout is never
  re-parsed on the next poll tick.
- A second `fs.watch` (recursive — macOS/Windows only; the call is wrapped in `try/catch` and
  silently disabled on platforms where it throws, e.g. Linux) plus the extension's existing 10
  second poll tick (`watchCodex`/`scheduleRender` in `extension.js`) keep the view current.

### Schema notes (read this before touching `lib/codex.js`)

Reverse-engineered from real `~/.codex/sessions/**/rollout-*.jsonl` files on one development
machine (Codex CLI 0.159.2, `cli` and `codex_vscode` originators). **This is not a published,
versioned Codex API** — it can change without notice. The full notes live in the header comment of
`vscode-extension/lib/codex.js`; summarized:

- One file per session. Line 0 is `{"type":"session_meta","payload":{"session_id":"<uuid>","cwd":...}}`.
  Every other line is `{"timestamp","ordinal","type","payload"}`, `ordinal` strictly increasing.
- **Plan Mode** — `event_msg` with `payload.type === "item_completed"` and
  `payload.item.type === "Plan"` — carries a full markdown planning document in
  `payload.item.text`, with **no per-step status**. This is the only plan-like event actually
  observed in real sessions (3 occurrences across 19 sampled rollout files).
- **`update_plan`** — a `response_item` with `payload.type === "function_call"`,
  `payload.name === "update_plan"`, `payload.arguments` a JSON string
  `{"plan":[{"step":"...","status":"pending"|"in_progress"|"completed"}, ...]}`. Codex's system
  prompt documents this as a distinct "checklist/progress" tool, carrying real per-step status —
  **but it was never once invoked in any sampled local rollout file.** Its parsing is implemented
  from Codex's own published tool schema, not from an observed example. If the real shape differs,
  parsing falls through to "no structured plan" (and then to the Plan Mode path, if any) rather
  than throwing.
- `event_msg` with `payload.type === "task_complete"` and a `turn_id` marks a turn finished. It is
  the only completion signal available for a Plan Mode document (which carries no per-step
  status): every line extracted from the markdown starts `"pending"`, and **all of them flip to
  `"completed"` together** the moment a `task_complete` for that document's `turn_id` is seen.
  This is an approximation, not a measured per-step fact.
- There is no PID/liveness registry for Codex sessions (unlike Claude Code's `~/.claude/sessions`),
  so `ended` is approximated from the rollout file's own mtime: idle more than 15 minutes
  (`IDLE_MS`) counts as ended.
- Only flat, top-level list items (`- `, `* `, `1. `) are extracted from a Plan Mode document;
  nested/indented sub-bullets are treated as detail, not steps.

## Key files

- `vscode-extension/lib/codex.js` — the entire Codex data layer: rollout discovery/parsing,
  plan extraction, caching, session shaping, workspace/age/ended filtering. Pure Node, no
  `vscode` import (`defaultCodexSessionsDir`, `loadCodexSessions`, `tasksFromPlanMarkdown` exported).
- `vscode-extension/extension.js` — `config()` reads the two new settings; `TasksProvider.refresh()`
  merges Codex sessions in; `getChildren()` renders the `Claude`/`Codex` source label;
  `watchCodex()`/the dispose block add the second `fs.watch` and tear it down.
- `vscode-extension/lib/model.js` — `loadSessions()` now tags every session `source: "claude"`,
  so the merged list can tell the two apart.
- `vscode-extension/package.json` — new settings `claudeTasks.codexEnabled` (boolean, default
  `true`) and `claudeTasks.codexSessionsDir` (string, default `""`).
- `vscode-extension/test/codex.test.js` — 12 unit tests against synthetic fixtures built to match
  the schema above (never copied from real transcript content).

## Data & contracts

- No network calls, no database. Reads the filesystem only:
  `<codexSessionsDir>/<YYYY>/<MM>/<DD>/rollout-*.jsonl`, default
  `~/.codex/sessions` (`codex.defaultCodexSessionsDir()`).
- New VS Code settings (`package.json` → `contributes.configuration`):
  - `claudeTasks.codexEnabled` (boolean, default `true`) — master on/off switch.
  - `claudeTasks.codexSessionsDir` (string, default `""` → `~/.codex/sessions`).
- Session object shape (internal, shared with `lib/model.js`'s output): adds `source: "codex"`
  and always `subagents: []`. Everything else (`sessionId`, `title`, `cwd`, `updatedAt`, `ended`,
  `tasks`, `summary`) matches the existing Claude session shape so `extension.js` can render both
  without a branch per field.

## Decisions & constraints

- **Why read rollout files directly instead of a Codex-side hook:** Codex CLI has no
  plugin/hook mechanism comparable to Claude Code's, so there is nothing to retrofit a
  `task-tracker`-style hook into. The rollout file Codex already writes for its own session
  resumption is the only available data source — this is a read-only integration with no
  cooperation needed from Codex.
- **Only non-empty plans are surfaced.** Most Codex sessions never call `update_plan` or enter
  Plan Mode; showing every Codex session regardless would clutter the board with idle chats that
  have nothing to show (`sessionFromRollout` returns `null` for these).
- **Head+tail read (64 KB / 2 MB) instead of reading the whole file.** Bounds cost on large
  rollout files while still reliably catching `session_meta` (always line 0) and the latest plan
  event (expected to be near the end of the file).
- **Cache by `{size, mtimeMs}`.** An unchanged multi-MB file is never re-parsed on the next 10
  second poll tick.
- **`fs.watch(..., { recursive: true })` is best-effort, not depended on.** It throws on Linux;
  the call is wrapped in `try/catch` and silently disabled there. The existing 10-second poll
  tick is the cross-platform fallback everywhere, including when the Codex sessions directory
  doesn't exist yet. Unlike the Claude state dir, this directory is never created by the
  extension — it isn't the extension's to create.
- **Completion is all-or-nothing for Plan Mode documents**, because the only observed completion
  signal (`task_complete`) carries a `turn_id`, not a per-step status. This was a deliberate
  choice to show an honest approximation (pending until done, then all done) rather than
  inventing partial-completion heuristics with no evidence behind them.
- **`update_plan` parsing is unverified against reality.** This is the single biggest trap for
  whoever touches this next: the code path exists and is unit-tested against a synthetic fixture,
  but **no real Codex session in the author's history ever invoked `update_plan`** — the argument
  shape (`{"plan":[{"step","status"}]}`) comes from Codex's own tool description, not a captured
  example. If a real `update_plan` call is ever captured, add it as a fixture and re-verify the
  field names before trusting this path in production.
- **Rollout format is not a stable public contract.** It was reverse-engineered from real files on
  one machine running Codex CLI 0.159.2. A future Codex release could change field names, nesting,
  or event types without notice; the parser is written defensively (malformed JSON skipped,
  unrecognized shapes fall through to "no plan", unknown per-step statuses default to `pending`)
  specifically because of this.
- **Flat plans only.** Codex's plan data has no subagent/sub-task concept exposed here, so
  `subagents` is always `[]` for Codex sessions — this mirrors reality rather than being a
  limitation to lift later.

## Testing

- `vscode-extension/test/codex.test.js` — 12 new unit tests, all against **synthetic fixtures**
  built to match the schema notes above (never copied from real transcript content):
  1. `update_plan`: latest call wins by `ordinal`, status values mapped through, unknown status
     defaults to `pending`.
  2. Plan Mode markdown doc: flat top-level list items extracted, nested bullets ignored, pending
     until the matching `task_complete` flips everything to completed together.
  3. `tasksFromPlanMarkdown` bullet/numbered-list extraction in isolation.
  4. A session with no plan-like event at all is not shown.
  5. Malformed/truncated JSON lines are skipped, not thrown.
  6. A session whose `session_meta` line itself is malformed is skipped entirely.
  7. Malformed `update_plan` JSON `arguments` falls through gracefully (no structured plan).
  8. Workspace-folder filtering: subfolder matches, sibling-prefix directory does not.
  9. `maxAgeMs` (plan hasn't changed recently) and `maxFileAgeMs` (rollout file itself is old)
     both hide a session.
  10. A session idle past the 15-minute threshold is hidden unless `includeEnded` is passed.
  11. A missing sessions directory yields no sessions, not a throw.
  12. Title extraction from the first `UserMessage`, both the IDE-wrapped (`## My request:`
      marker) and plain-CLI forms.
- Run: `cd vscode-extension && npm test` (plain `node --test test/`). All 30 tests in the suite
  pass (12 new + 18 pre-existing `model.test.js`/manifest tests) — verified directly in this
  session.
- **Not verified:** no real Codex CLI session was run against this code, and there is no
  Playwright/VS Code E2E check that Codex sessions actually render correctly in the live sidebar
  (icons, labels, expand/collapse). Coverage is entirely the pure data layer against synthetic
  fixtures — the schema notes above are the honest record of what's assumed vs. observed.

## Resume-work notes

- **Done:** `lib/codex.js` data layer, `extension.js` wiring (merge, dual watch, config,
  disposal), `package.json` settings, 12 passing unit tests, docs updated (this brief, root
  README, `vscode-extension/README.md`, `docs/how-it-works.md`, `CHANGELOG.md`).
- **Not done / open:**
  - No real `update_plan` call has ever been captured — the single biggest unverified assumption
    in this feature. Capture one and add it as a fixture before relying on it.
  - The e2e test (`npm run test:e2e`) covers tree rows, labels and the `codexEnabled` toggle only
    with a synthetic `update_plan` fixture; the status bar, `currentWorkspaceOnly`, live watcher
    refresh and a real Codex session are not covered.
  - Windows is untested for both the existing extension and this addition; `fs.watch recursive`
    behavior there specifically is unverified.
  - Released as `vscode-extension` 0.4.0.
