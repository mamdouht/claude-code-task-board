// Runs inside the VS Code extension host. Mocha-free: a tiny sequential runner over node:assert.
const assert = require("node:assert/strict");
const vscode = require("vscode");

const EXT_ID = "opstudioz.task-board-vscode";

async function until(fn, what, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await vscode.commands.executeCommand("claudeTasks.refresh");
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for: ${what} (last: ${JSON.stringify(last)})`);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let api;
const bySource = (src) => api.getTreeSnapshot().find((s) => s.source === src);

test("Codex session appears, labeled Codex, with its plan steps", async () => {
  const s = await until(() => bySource("codex"), "a codex session row");
  assert.match(s.description, /· Codex ·/);
  assert.match(s.description, /^1\/3/);
  assert.deepEqual(
    s.tasks.map((t) => [t.label, t.icon]),
    [
      ["Codex survey", "pass-filled"],
      ["Codex implement", "sync~spin"],
      ["Codex verify", "circle-large-outline"],
    ],
  );
});

test("Claude session is labeled Claude", async () => {
  const s = await until(() => bySource("claude"), "a claude session row");
  assert.match(s.description, /· Claude ·/);
  assert.deepEqual(s.tasks.map((t) => t.label), ["Claude step one", "Claude step two"]);
});

test("claudeTasks.codexEnabled=false hides Codex but keeps Claude, and re-enabling restores it", async () => {
  const cfg = vscode.workspace.getConfiguration("claudeTasks");
  await cfg.update("codexEnabled", false, vscode.ConfigurationTarget.Global);
  await until(() => !bySource("codex"), "codex rows gone");
  assert.ok(bySource("claude"), "Claude session must remain");
  await cfg.update("codexEnabled", true, vscode.ConfigurationTarget.Global);
  await until(() => bySource("codex"), "codex rows back");
});

async function run() {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `extension ${EXT_ID} not found`);
  api = await ext.activate();
  assert.ok(api && typeof api.getTreeSnapshot === "function", "activate() must return the test hook");
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${name}\n       ${e.message}`);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} e2e tests passed`);
  if (failed) throw new Error(`${failed} e2e test(s) failed`);
}

module.exports = { run };
