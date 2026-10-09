// Run: node --test test/
// Fixtures below are synthetic — built from the real ~/.codex/sessions/**/rollout-*.jsonl schema
// confirmed during development (session_meta line 0; event_msg item_completed with item.type
// "Plan" carrying a markdown doc; event_msg task_complete with a turn_id; response_item
// function_call with name "update_plan" and a JSON-string `arguments` field), never copied from
// real transcript content.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const codex = require("../lib/codex");

const now = Date.parse("2026-10-06T12:00:00Z");

function scratch(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `codex-tasks-${name}-`));
}

// Codex nests rollouts three directories deep: sessionsDir/YYYY/MM/DD/rollout-*.jsonl.
function rolloutPath(sessionsDir, id) {
  const dir = path.join(sessionsDir, "2026", "10", "06");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `rollout-2026-10-06T00-00-00-${id}.jsonl`);
}

function sessionMeta(id, cwd, timestamp) {
  return { timestamp, ordinal: 0, type: "session_meta", payload: { session_id: id, cwd, originator: "cli" } };
}

function userMessage(ordinal, timestamp, text) {
  return {
    timestamp,
    ordinal,
    type: "event_msg",
    payload: { type: "item_completed", item: { type: "UserMessage", id: "item-1", content: [{ type: "text", text }] } },
  };
}

function planDoc(ordinal, timestamp, turnId, text) {
  return {
    timestamp,
    ordinal,
    type: "event_msg",
    payload: { type: "item_completed", thread_id: "t", turn_id: turnId, item: { type: "Plan", id: `${turnId}-plan`, text } },
  };
}

function taskComplete(ordinal, timestamp, turnId) {
  return { timestamp, ordinal, type: "event_msg", payload: { type: "task_complete", turn_id: turnId } };
}

function updatePlanCall(ordinal, timestamp, plan) {
  return {
    timestamp,
    ordinal,
    type: "response_item",
    payload: { type: "function_call", name: "update_plan", arguments: JSON.stringify({ plan }) },
  };
}

function writeRollout(sessionsDir, id, lines, { mtime } = {}) {
  const file = rolloutPath(sessionsDir, id);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
}

test("update_plan: the latest structured plan wins, with status values mapped through", () => {
  const dir = scratch("update-plan");
  writeRollout(
    dir,
    "aaa",
    [
      sessionMeta("aaa", "/r/project", "2026-10-06T11:00:00Z"),
      userMessage(1, "2026-10-06T11:00:01Z", "Build the thing"),
      updatePlanCall(2, "2026-10-06T11:00:02Z", [
        { step: "Old step", status: "pending" },
      ]),
      updatePlanCall(3, "2026-10-06T11:00:03Z", [
        { step: "Survey the code", status: "completed" },
        { step: "Write the fix", status: "in_progress" },
        { step: "Verify", status: "pending" },
        { step: "Garbage status", status: "not-a-real-status" },
      ]),
    ],
    { mtime: new Date(now - 60_000) },
  );
  const [session] = codex.loadCodexSessions({ sessionsDir: dir, now });
  assert.equal(session.sessionId, "aaa");
  assert.equal(session.source, "codex");
  assert.equal(session.cwd, "/r/project");
  assert.deepEqual(session.subagents, []);
  assert.deepEqual(
    session.tasks.map((t) => [t.content, t.status]),
    [
      ["Survey the code", "completed"],
      ["Write the fix", "in_progress"],
      ["Verify", "pending"],
      ["Garbage status", "pending"], // unknown status values default to pending, never throw
    ],
  );
  assert.equal(session.summary.done, 1);
  assert.equal(session.summary.total, 4);
});

test("Plan Mode markdown doc: flat top-level list items, pending until the matching task_complete", () => {
  const dir = scratch("plan-doc");
  const text = [
    "# Some refresh",
    "",
    "## Summary",
    "",
    "Do the thing, following the guide.",
    "",
    "## Implementation",
    "",
    "- **Step one.** Nested detail is not a step:",
    "  - this nested bullet must be ignored",
    "- Step two with a [link](https://example.com) and `code`",
    "1. Step three, numbered",
  ].join("\n");
  writeRollout(dir, "bbb", [
    sessionMeta("bbb", "/r/project", "2026-10-06T10:00:00Z"),
    userMessage(1, "2026-10-06T10:00:01Z", "please plan this"),
    planDoc(2, "2026-10-06T10:00:02Z", "turn-1", text),
  ], { mtime: new Date(now - 30_000) });

  const [pending] = codex.loadCodexSessions({ sessionsDir: dir, now });
  assert.deepEqual(pending.tasks.map((t) => t.content), ["Step one. Nested detail is not a step:", "Step two with a link and code", "Step three, numbered"]);
  assert.ok(pending.tasks.every((t) => t.status === "pending"), "no per-step status exists yet, so nothing is completed");

  // Now the matching task_complete arrives — every step in that plan flips to completed together.
  const dir2 = scratch("plan-doc-done");
  writeRollout(dir2, "ccc", [
    sessionMeta("ccc", "/r/project", "2026-10-06T10:00:00Z"),
    userMessage(1, "2026-10-06T10:00:01Z", "please plan this"),
    planDoc(2, "2026-10-06T10:00:02Z", "turn-1", text),
    taskComplete(3, "2026-10-06T10:00:03Z", "turn-1"),
  ], { mtime: new Date(now - 30_000) });
  const [done] = codex.loadCodexSessions({ sessionsDir: dir2, now });
  assert.ok(done.tasks.every((t) => t.status === "completed"));
  assert.equal(done.summary.finished, true);
});

test("tasksFromPlanMarkdown ignores indented sub-bullets and headings, keeps only column-0 list items", () => {
  const tasks = codex.tasksFromPlanMarkdown("# Title\n- top one\n  - nested, skip\n* top two\n2. top three\nplain text line\n");
  assert.deepEqual(tasks, ["top one", "top two", "top three"]);
});

test("empty or no-plan sessions are not shown", () => {
  const dir = scratch("empty");
  writeRollout(dir, "empty", [
    sessionMeta("empty", "/r/project", "2026-10-06T09:00:00Z"),
    userMessage(1, "2026-10-06T09:00:01Z", "just chatting, no plan"),
  ], { mtime: new Date(now - 30_000) });
  const sessions = codex.loadCodexSessions({ sessionsDir: dir, now });
  assert.deepEqual(sessions, []);
});

test("malformed and truncated lines are tolerated, not thrown", () => {
  const dir = scratch("malformed");
  const file = rolloutPath(dir, "bad");
  fs.writeFileSync(
    file,
    [
      JSON.stringify(sessionMeta("bad", "/r/project", "2026-10-06T09:00:00Z")),
      "{not json at all",
      JSON.stringify(updatePlanCall(2, "2026-10-06T09:00:02Z", [{ step: "Only valid step", status: "pending" }])),
      "{\"truncated mid-object",
    ].join("\n"),
  );
  fs.utimesSync(file, new Date(now - 30_000), new Date(now - 30_000));
  const sessions = codex.loadCodexSessions({ sessionsDir: dir, now });
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].tasks.map((t) => t.content), ["Only valid step"]);
});

test("a session whose session_meta line is itself malformed is skipped entirely", () => {
  const dir = scratch("broken-meta");
  const file = rolloutPath(dir, "brokenmeta");
  fs.writeFileSync(file, ["not even json", JSON.stringify(updatePlanCall(1, "2026-10-06T09:00:01Z", [{ step: "x", status: "pending" }]))].join("\n"));
  fs.utimesSync(file, new Date(now - 30_000), new Date(now - 30_000));
  assert.deepEqual(codex.loadCodexSessions({ sessionsDir: dir, now }), []);
});

test("update_plan with a malformed JSON arguments string falls back to no structured plan (and the doc path, if any)", () => {
  const dir = scratch("bad-args");
  const file = rolloutPath(dir, "badargs");
  fs.writeFileSync(
    file,
    [
      JSON.stringify(sessionMeta("badargs", "/r/project", "2026-10-06T09:00:00Z")),
      JSON.stringify({ timestamp: "2026-10-06T09:00:01Z", ordinal: 1, type: "response_item", payload: { type: "function_call", name: "update_plan", arguments: "{not valid json" } }),
    ].join("\n"),
  );
  fs.utimesSync(file, new Date(now - 30_000), new Date(now - 30_000));
  assert.deepEqual(codex.loadCodexSessions({ sessionsDir: dir, now }), []);
});

test("workspace filter matches subfolders but not sibling prefixes", () => {
  const dir = scratch("workspace");
  writeRollout(dir, "in", [
    sessionMeta("in", "/r/project/apps/web", "2026-10-06T09:00:00Z"),
    updatePlanCall(1, "2026-10-06T09:00:01Z", [{ step: "x", status: "pending" }]),
  ], { mtime: new Date(now - 30_000) });
  writeRollout(dir, "out", [
    sessionMeta("out", "/r/project-legacy", "2026-10-06T09:00:00Z"),
    updatePlanCall(1, "2026-10-06T09:00:01Z", [{ step: "x", status: "pending" }]),
  ], { mtime: new Date(now - 30_000) });
  const ids = codex.loadCodexSessions({ sessionsDir: dir, workspaceFolders: ["/r/project"], now }).map((s) => s.sessionId);
  assert.deepEqual(ids, ["in"]);
});

test("maxAgeMs hides a plan that hasn't changed recently, maxFileAgeMs skips old rollout files outright", () => {
  const dir = scratch("aging");
  writeRollout(dir, "stale", [
    sessionMeta("stale", "/r/project", "2026-10-01T09:00:00Z"),
    updatePlanCall(1, "2026-10-01T09:00:01Z", [{ step: "x", status: "pending" }]),
  ], { mtime: new Date(now - 10 * 24 * 3600 * 1000) });
  assert.deepEqual(codex.loadCodexSessions({ sessionsDir: dir, now, maxFileAgeMs: 7 * 24 * 3600 * 1000 }), []);
  assert.deepEqual(codex.loadCodexSessions({ sessionsDir: dir, now, maxAgeMs: 24 * 3600 * 1000 }), []);
});

test("a session idle longer than the ended threshold is hidden unless includeEnded is set", () => {
  const dir = scratch("idle");
  writeRollout(dir, "idle", [
    sessionMeta("idle", "/r/project", "2026-10-06T09:00:00Z"),
    updatePlanCall(1, "2026-10-06T09:00:01Z", [{ step: "x", status: "pending" }]),
  ], { mtime: new Date(now - 60 * 60 * 1000) }); // well past the 15-minute idle threshold
  assert.deepEqual(codex.loadCodexSessions({ sessionsDir: dir, now }), []);
  const [session] = codex.loadCodexSessions({ sessionsDir: dir, now, includeEnded: true });
  assert.equal(session.ended, true);
});

test("missing sessions directory yields no sessions, not a throw", () => {
  assert.deepEqual(codex.loadCodexSessions({ sessionsDir: "/nonexistent/codex/sessions", now }), []);
});

test("title is read from the first UserMessage, using the IDE-wrapped '## My request:' marker when present", () => {
  const dir = scratch("title");
  writeRollout(dir, "wrapped", [
    sessionMeta("wrapped", "/r/project", "2026-10-06T09:00:00Z"),
    userMessage(1, "2026-10-06T09:00:01Z", "# Files mentioned by the user:\n\nDistinguish instructions from the request.\n\n## My request:\n\nFix the login bug"),
    updatePlanCall(2, "2026-10-06T09:00:02Z", [{ step: "x", status: "pending" }]),
  ], { mtime: new Date(now - 30_000) });
  const [session] = codex.loadCodexSessions({ sessionsDir: dir, now });
  assert.equal(session.title, "Fix the login bug");

  const dir2 = scratch("title-plain");
  writeRollout(dir2, "plain", [
    sessionMeta("plain", "/r/project", "2026-10-06T09:00:00Z"),
    userMessage(1, "2026-10-06T09:00:01Z", "Fix the login bug please"),
    updatePlanCall(2, "2026-10-06T09:00:02Z", [{ step: "x", status: "pending" }]),
  ], { mtime: new Date(now - 30_000) });
  const [session2] = codex.loadCodexSessions({ sessionsDir: dir2, now });
  assert.equal(session2.title, "Fix the login bug please");
});
