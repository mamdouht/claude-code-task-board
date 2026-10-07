// Run: node --test claude-mods/vscode-task-panel/test/
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const model = require("../lib/model");

const now = Date.parse("2026-10-06T12:00:00Z");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tasks-"));

function writeSession(id, { cwd = "/r/project", minutesAgo = 1, tasks, subagents = {}, title, pid, endedAt } = {}) {
  let transcriptPath;
  if (title) {
    transcriptPath = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: "ai-title", aiTitle: "Old title" }),
        JSON.stringify({ type: "user", message: { content: "hi" } }),
        JSON.stringify({ type: "ai-title", aiTitle: title }),
      ].join("\n"),
    );
  }
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      version: 1,
      sessionId: id,
      cwd,
      transcriptPath,
      pid,
      endedAt,
      updatedAt: new Date(now - minutesAgo * 60_000).toISOString(),
      lists: { main: tasks, ...subagents },
    }),
  );
}

const t = (content, status, activeForm) => ({ id: content, content, status, activeForm });

writeSession("aaa", {
  title: "Rename X",
  minutesAgo: 5,
  tasks: [t("Find refs", "completed"), t("Rename", "in_progress", "Renaming X"), t("Check", "pending")],
  subagents: { "agent-123456789": [t("sub step", "completed")] },
});
writeSession("bbb", { title: "Pin map image", minutesAgo: 1, tasks: [t("Fix", "completed")] });
writeSession("ccc", { cwd: "/r/other", minutesAgo: 2, tasks: [t("Elsewhere", "pending")] });
writeSession("old", { minutesAgo: 60 * 48, tasks: [t("Stale", "pending")] });
writeSession("empty", { tasks: [] });
fs.writeFileSync(path.join(dir, "broken.json"), "{not json");

test("loads sessions newest first, skipping empty, broken, stale and foreign-workspace ones", () => {
  const sessions = model.loadSessions({ sessionsDir: "/nonexistent", stateDir: dir, workspaceFolders: ["/r/project"], maxAgeMs: 24 * 3600e3, now });
  assert.deepEqual(sessions.map((s) => s.sessionId), ["bbb", "aaa"]);
  const all = model.loadSessions({ sessionsDir: "/nonexistent", stateDir: dir, now, includeEnded: true });
  assert.deepEqual(all.map((s) => s.sessionId).sort(), ["aaa", "bbb", "ccc", "old"]);
});

test("workspace filter matches subfolders but not sibling prefixes", () => {
  writeSession("sub", { cwd: "/r/project/apps/web", tasks: [t("x", "pending")] });
  writeSession("sib", { cwd: "/r/project-legacy", tasks: [t("x", "pending")] });
  const ids = model.loadSessions({ sessionsDir: "/nonexistent", stateDir: dir, workspaceFolders: ["/r/project"], now }).map((s) => s.sessionId);
  assert.ok(ids.includes("sub"));
  assert.ok(!ids.includes("sib"));
  fs.unlinkSync(path.join(dir, "sub.json"));
  fs.unlinkSync(path.join(dir, "sib.json"));
});

test("session title is the LAST ai-title row in the transcript", () => {
  const [, aaa] = model.loadSessions({ sessionsDir: "/nonexistent", stateDir: dir, workspaceFolders: ["/r/project"], now });
  assert.equal(aaa.title, "Rename X");
  assert.equal(model.readSessionTitle("/nonexistent.jsonl"), undefined);
});

test("subagent lists are exposed separately from the main list", () => {
  const aaa = model.loadSessions({ sessionsDir: "/nonexistent", stateDir: dir, now }).find((s) => s.sessionId === "aaa");
  assert.equal(aaa.tasks.length, 3);
  assert.deepEqual(aaa.subagents.map((s) => s.agentId), ["agent-123456789"]);
});

test("focus follows the active Claude tab, else the newest unfinished session", () => {
  const sessions = model.loadSessions({ sessionsDir: "/nonexistent", stateDir: dir, workspaceFolders: ["/r/project"], now });
  assert.equal(model.pickFocused(sessions, "Pin map image").sessionId, "bbb");
  assert.equal(model.pickFocused(sessions, "settings.json").sessionId, "aaa", "bbb is finished");
  assert.equal(model.pickFocused([], "x"), undefined);
});

test("status bar and tooltip text", () => {
  const sessions = model.loadSessions({ sessionsDir: "/nonexistent", stateDir: dir, workspaceFolders: ["/r/project"], now });
  const aaa = sessions.find((s) => s.sessionId === "aaa");
  const bbb = sessions.find((s) => s.sessionId === "bbb");
  assert.equal(model.statusBarText(aaa), "$(checklist) 1/3 ▸ Renaming X");
  assert.equal(model.statusBarText(bbb), "$(pass-filled) 1/1 done");
  assert.equal(model.statusBarText(undefined), undefined);
  const tip = model.tooltipMarkdown(aaa);
  assert.match(tip, /\*\*Rename X\*\* — 1\/3 done/);
  assert.match(tip, /✅ Find refs/);
  assert.match(tip, /⏳ Renaming X/);
  assert.match(tip, /⬜ Check/);
});

test("labels and relative times", () => {
  assert.equal(model.sessionLabel({ title: undefined, tasks: [{ content: "P1" }], sessionId: "abcdefghij" }), "P1");
  assert.equal(model.relativeTime(now - 30e3, now), "just now");
  assert.equal(model.relativeTime(now - 5 * 60e3, now), "5m ago");
  assert.equal(model.relativeTime(now - 3 * 3600e3, now), "3h ago");
});

function scratch(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `claude-tasks-${name}-`));
}

function writeState(stateDir, id, { minutesAgo = 5, ...extra } = {}) {
  fs.writeFileSync(
    path.join(stateDir, `${id}.json`),
    JSON.stringify({
      version: 1,
      sessionId: id,
      cwd: "/r/project",
      updatedAt: new Date(now - minutesAgo * 60_000).toISOString(),
      lists: { main: [t("step", "pending")] },
      ...extra,
    }),
  );
}

// Mirrors Claude Code's ~/.claude/sessions/<pid>.json registry entries.
function registry(entries) {
  const dir = scratch("registry");
  for (const [pid, sessionId] of entries) {
    fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: "/r/project" }));
    fs.writeFileSync(path.join(dir, `${pid}.abc.key`), "{}"); // sibling files must be ignored
  }
  return dir;
}

test("registry: open ids come only from entries whose PID is alive", () => {
  const dir = registry([[100, "open-a"], [200, "crashed"], [300, "open-b"]]);
  const ids = model.readOpenSessions(dir, (pid) => pid !== 200);
  assert.deepEqual([...ids].sort(), ["open-a", "open-b"]);
  assert.equal(model.readOpenSessions("/nonexistent", () => true), null, "missing registry = unknown");
  assert.equal(model.readOpenSessions(registry([]), () => true), null, "empty registry = unknown, not 'all closed'");
});

test("resync removes lists of sessions the registry no longer has open, in every workspace", () => {
  const stateDir = scratch("state");
  writeState(stateDir, "open-a");
  writeState(stateDir, "closed-legacy"); // no PID: the stuck case from the screenshot
  writeState(stateDir, "closed-other-ws", { cwd: "/r/SyriaCore-web" });
  writeState(stateDir, "closed-but-fresh", { minutesAgo: 0 }); // inside the grace window
  const sessionsDir = registry([[100, "open-a"]]);
  const isAlive = (pid) => pid === 100;

  const removed = model.removeClosedSessions({ stateDir, sessionsDir, isAlive, now });
  assert.deepEqual(removed.sort(), ["closed-legacy", "closed-other-ws"]);
  assert.deepEqual(fs.readdirSync(stateDir).sort(), ["closed-but-fresh.json", "open-a.json"]);

  const shown = model.loadSessions({ stateDir, sessionsDir, isAlive, now }).map((s) => s.sessionId);
  assert.deepEqual(shown, ["open-a"], "a closed list inside the grace window is hidden, not shown");
});

test("without a registry: dead recorded PID is removed, unknown legacy state is only hidden when idle", () => {
  const stateDir = scratch("state-noreg");
  writeState(stateDir, "alive", { pid: 100 });
  writeState(stateDir, "dead", { pid: 200 });
  writeState(stateDir, "legacy-recent", { minutesAgo: 10 });
  writeState(stateDir, "legacy-idle", { minutesAgo: 90 });
  const opts = { stateDir, sessionsDir: "/nonexistent", isAlive: (pid) => pid === 100, now };

  assert.deepEqual(model.removeClosedSessions(opts), ["dead"]);
  const shown = model.loadSessions(opts).map((s) => s.sessionId).sort();
  assert.deepEqual(shown, ["alive", "legacy-recent"]);
  assert.ok(fs.existsSync(path.join(stateDir, "legacy-idle.json")), "idle legacy is hidden, never deleted");
});

test("an old SessionEnd stamp (endedAt from 0.2.0) still counts as closed", () => {
  const stateDir = scratch("state-stamp");
  writeState(stateDir, "stamped", { pid: 100, endedAt: new Date(now).toISOString() });
  const removed = model.removeClosedSessions({ stateDir, sessionsDir: "/nonexistent", isAlive: () => true, now });
  assert.deepEqual(removed, ["stamped"]);
});

test("focus never lands on an ended session while a live one exists", () => {
  const all = [
    { sessionId: "e", ended: true, summary: { finished: false } },
    { sessionId: "l", ended: false, summary: { finished: false } },
  ];
  assert.equal(model.pickFocused(all).sessionId, "l");
});

test("subagents: labelled by type, and a session with only a subagent list still shows", () => {
  const stateDir = scratch("state-sub");
  writeState(stateDir, "delegated", {
    pid: 100,
    lists: { main: [], a1: [t("Write tests", "completed"), t("Run suite", "in_progress", "Running the suite")] },
    agents: { a1: { type: "testing-playwright-jest" } },
  });
  const [session] = model.loadSessions({ stateDir, sessionsDir: "/nonexistent", isAlive: () => true, now });
  assert.equal(session.sessionId, "delegated");
  assert.equal(model.subagentLabel(session.subagents[0]), "testing-playwright-jest (subagent)");
  assert.equal(model.subagentLabel({ agentId: "abcdef123456" }), "Subagent abcdef12");
  assert.equal(model.statusBarText(session), "$(hubot) $(checklist) 1/2 ▸ Running the suite");
  assert.match(model.tooltipMarkdown(session), /\*\*testing-playwright-jest \(subagent\)\*\* — 1\/2 done/);
});

test("isProcessAlive tells this process from a dead PID", () => {
  assert.equal(model.isProcessAlive(process.pid), true);
  assert.equal(model.isProcessAlive(2 ** 22 + 12345), false);
});

test("the extension manifest wires the view, container and commands consistently", () => {
  const pkg = require("../package.json");
  const containerId = pkg.contributes.viewsContainers.activitybar[0].id;
  assert.ok(pkg.contributes.views[containerId].some((v) => v.id === "claudeTasks.list"));
  const src = fs.readFileSync(path.join(__dirname, "..", "extension.js"), "utf8");
  for (const { command } of pkg.contributes.commands) {
    assert.ok(src.includes(`registerCommand("${command}"`), `${command} is registered`);
  }
});
