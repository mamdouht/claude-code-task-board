# VS Code extension 0.4.0: also show OpenAI Codex CLI plans

## Release notes

- New: the "Claude Tasks" sidebar in VS Code now also shows plans from the OpenAI Codex CLI, not
  just Claude Code. If you use both tools, you'll see one combined list, with each entry labeled
  either "Claude" or "Codex" so you can tell them apart.
- This works automatically — there's nothing to install or configure on the Codex side. It's on
  by default; there's a setting to turn it off if you don't use Codex.
- Codex plans always show as a flat checklist (no nested sub-tasks), since Codex doesn't expose
  that kind of grouping.
- Honesty check before you rely on this: Codex doesn't give a clean, documented way to read its
  plans, so this reads Codex's own internal session files directly. Most of the time this works
  fine, but there's one gap worth knowing — if Codex uses its "step-by-step checklist" feature
  (which would show each step's real status), that path has never actually been seen in practice
  and is built from Codex's own description of it rather than a confirmed real example. The plan
  type that *has* been seen and confirmed working is Codex's "Plan Mode" document — but because
  that one has no per-step status at all, every line shows as pending right up until the whole
  plan is marked done, then all lines flip to done together (not one at a time). This was tested
  with 30 automated tests (12 of them new, built from realistic made-up examples) — it has not
  been tried against a live Codex session or clicked through in VS Code itself yet.

## Details

### What changed and where

- `vscode-extension/lib/codex.js` (new) — reads Codex CLI's own session files
  (`~/.codex/sessions/**/rollout-*.jsonl`) directly and turns the latest plan found in each into
  the same shape the extension already uses for Claude sessions.
- `vscode-extension/extension.js` — merges Codex sessions into the same tree/status bar as Claude
  sessions, tags each row with its source ("Claude" or "Codex"), and adds a second file watcher
  (plus the existing 10-second poll) so Codex sessions update live too.
- `vscode-extension/lib/model.js` — Claude sessions are now explicitly tagged `source: "claude"`
  so the two can be told apart once merged.
- `vscode-extension/package.json` — two new settings: `claudeTasks.codexEnabled` (default on) and
  `claudeTasks.codexSessionsDir` (default empty, meaning `~/.codex/sessions`).
- `vscode-extension/test/codex.test.js` (new) — 12 unit tests against synthetic fixtures.
- Docs updated in place: root `README.md` (component table, requirements, configuration table,
  usage section, how-it-works section, limitations, dev file table), `vscode-extension/README.md`
  (what-it-does, settings table, limits, development), `docs/how-it-works.md` (new "Codex CLI data
  path" section plus a line under "Open questions"), `CHANGELOG.md` (Unreleased/Added), and a new
  feature brief at `docs/features/vscode-codex-plans.md`.

### Why read Codex's rollout files directly, rather than a Codex-side hook

Claude Code's half of this project works by hooking Claude Code's own plugin system
(`task-tracker`'s classic hooks) to catch the moment a plan changes. Codex CLI has no equivalent
plugin/hook mechanism to attach to — there's nothing to retrofit. The only thing available is the
session transcript ("rollout" file) Codex already writes to disk for its own session-resume
feature. Reading that file directly was the only integration point that existed at all, so that's
what this does: a read-only parser, no cooperation needed from Codex, and no risk of interfering
with it.

### What was actually confirmed vs. assumed (read this before trusting it)

This was built by inspecting real `~/.codex/sessions/**/rollout-*.jsonl` files on one development
machine (Codex CLI 0.159.2), not from any published Codex spec — because none exists for this
format. Two plan-shaped things were found in Codex's protocol:

1. **Plan Mode** — a markdown planning document, attached to a `Plan`-typed completed item. This
   is the only one of the two that was **actually observed** in real session files (3 times
   across 19 sampled rollouts). It has **no per-step status** — it's just a markdown list.
   Completion is approximated from a separate `task_complete` signal tied to that plan's turn: all
   steps are "pending" right up until that event appears, then they **all** flip to "completed" at
   once. There is no way, from what Codex writes, to know that step 2 of 5 is done while step 3
   isn't — so this doesn't pretend to know that.
2. **`update_plan`** — a tool Codex's own system prompt describes as a checklist/progress tool
   that *would* carry real per-step status (pending/in-progress/completed per item). **This was
   never once seen fired in any real session sampled during development.** Its parsing exists and
   is unit-tested, but purely against a fixture built from Codex's documented tool schema — not
   from a captured real call. If Codex's actual argument shape turns out to differ, the code is
   written to fail safe (fall through to "no plan found" rather than crash), but the mapping
   itself is unverified. **This is the single biggest trap for whoever touches this next:**
   capture one real `update_plan` call before trusting that this path's field names are right.

Other approximations, stated plainly:
- Codex has no live-session registry (unlike Claude Code's), so a Codex session is considered
  "ended" once its rollout file has sat untouched for 15 minutes — a timing guess, not a fact.
- The rollout file format itself is not a stable, versioned contract. It could change in a future
  Codex release without any warning, and this parser has no way to detect that beyond defensive
  fallbacks (skip malformed lines, treat unrecognized shapes as "no plan").
- Codex plans only ever render flat — there is no subagent/nested-task concept in what Codex
  exposes here, so this isn't a missing feature, it's the actual shape of the data.

### What was verified, and what wasn't

Verified in this session: all 30 unit tests pass (`cd vscode-extension && npm test`), 12 of them
new, covering both plan shapes, malformed/truncated input, workspace filtering, age/idle
thresholds, and title extraction — all against synthetic fixtures built to match the schema
described above, never against real transcript content.

Also verified: a new end-to-end test (`cd vscode-extension && npm run test:e2e`) launches real
VS Code 1.141.0 with the extension and passed 3/3 on two runs: a Codex row shows with its plan
steps and the Codex label, a Claude row is labeled Claude, and `codexEnabled=false` hides Codex
and re-enabling restores it. It uses synthetic fixtures in a temp HOME. Version bumped to 0.4.0.
Side effects to know about: new devDependency `@vscode/test-electron` (first run downloads ~313 MB
of VS Code), `activate()` now returns `{ getTreeSnapshot() }` as a test hook, and the launcher
unsets `ELECTRON_RUN_AS_NODE`, which broke VS Code launch from some shells.

**Not verified:** no live Codex CLI session was run through this code, and the e2e test does not
cover the status bar, `currentWorkspaceOnly` filtering, or live file-watcher refresh. The
`update_plan` shape used in the e2e fixture is the assumed one, not an observed one.
