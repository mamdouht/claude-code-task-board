// Synthetic fixtures only — shapes mirror the formats lib/model.js and lib/codex.js read, but no
// content is copied from real transcripts. Timestamps are relative to "now" so the extension's
// 24 h maxAge and the Codex 15 min "ended" heuristic both see the sessions as live.
const fs = require("node:fs");
const path = require("node:path");

function writeFixtures(root) {
  const stateDir = path.join(root, "state");
  const codexDir = path.join(root, "codex", "sessions");
  fs.mkdirSync(stateDir, { recursive: true });

  // Claude (task-tracker) session. `pid` = this runner's pid, which stays alive for the whole run,
  // so the extension treats the session as open (HOME has no ~/.claude/sessions registry).
  const task = (content, status, activeForm) => ({ id: content, content, status, activeForm });
  fs.writeFileSync(
    path.join(stateDir, "claude-e2e.json"),
    JSON.stringify({
      version: 1,
      sessionId: "claude-e2e",
      cwd: "/synthetic/claude-project",
      pid: process.pid,
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
      lists: {
        main: [task("Claude step one", "completed"), task("Claude step two", "pending")],
      },
    }),
  );

  // Codex rollout: sessionsDir/YYYY/MM/DD/rollout-*.jsonl with an update_plan call.
  const dayDir = path.join(codexDir, "2026", "10", "06");
  fs.mkdirSync(dayDir, { recursive: true });
  const ts = (agoMs) => new Date(Date.now() - agoMs).toISOString();
  const lines = [
    { timestamp: ts(120_000), ordinal: 0, type: "session_meta", payload: { session_id: "codex-e2e", cwd: "/synthetic/codex-project", originator: "cli" } },
    {
      timestamp: ts(30_000),
      ordinal: 1,
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({
          plan: [
            { step: "Codex survey", status: "completed" },
            { step: "Codex implement", status: "in_progress" },
            { step: "Codex verify", status: "pending" },
          ],
        }),
      },
    },
  ];
  fs.writeFileSync(path.join(dayDir, "rollout-2026-10-06T00-00-00-codex-e2e.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));

  return { stateDir, codexDir };
}

module.exports = { writeFixtures };
