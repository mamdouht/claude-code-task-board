// Run: node --test claude-mods/task-tracker/test/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "task-tracker-"));
process.env.TASK_TRACKER_DIR = tmp;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { handle } = await import("../hook/task-tracker-hook.mjs");
const { applyTaskCreate, applyTaskUpdate, readState, stateFile, summarise } = await import(
  "../lib/state.mjs"
);

const todos = [
  { content: "P1 schema", status: "completed", activeForm: "Writing schema" },
  { content: "P2 hook", status: "in_progress", activeForm: "Writing the hook" },
  { content: "P3 docs", status: "pending", activeForm: "Writing docs" },
];

test("TodoWrite replaces the main list and records the session", () => {
  handle({ session_id: "s1", cwd: "/r/project", tool_name: "TodoWrite", tool_input: { todos } });
  const state = readState("s1");
  assert.equal(state.lists.main.length, 3);
  assert.equal(state.cwd, "/r/project");
  assert.deepEqual(summarise(state.lists.main).done, 1);

  handle({ session_id: "s1", tool_name: "TodoWrite", tool_input: { todos: todos.slice(0, 1) } });
  assert.equal(readState("s1").lists.main.length, 1, "whole-list replace, not append");
});

test("subagent lists are kept apart from the main list", () => {
  handle({ session_id: "s2", tool_name: "TodoWrite", tool_input: { todos } });
  handle({
    session_id: "s2",
    agent_id: "agent-7",
    tool_name: "TodoWrite",
    tool_input: { todos: todos.slice(0, 1) },
  });
  const state = readState("s2");
  assert.equal(state.lists.main.length, 3);
  assert.equal(state.lists["agent-7"].length, 1);
});

test("unknown tools and malformed payloads write nothing", () => {
  assert.equal(handle({ session_id: "s3", tool_name: "Bash", tool_input: {} }), null);
  assert.equal(handle({ tool_name: "TodoWrite" }), null);
  handle({ session_id: "s3", tool_name: "TodoWrite", tool_input: { todos: "nope" } });
  assert.deepEqual(readState("s3").lists.main, []);
});

test("session ids cannot escape the state directory", () => {
  assert.equal(path.dirname(stateFile("../../etc/passwd")), tmp);
  assert.equal(stateFile("../.."), null);
});

test("records the Claude PID and transcript path from the hook's environment", () => {
  handle(
    { session_id: "pid1", transcript_path: "/t/pid1.jsonl", tool_name: "TodoWrite", tool_input: { todos } },
    new Date(),
    { CLAUDE_PID: "4242" },
  );
  const state = readState("pid1");
  assert.equal(state.pid, 4242);
  assert.equal(state.transcriptPath, "/t/pid1.jsonl");
});

test("SessionEnd removes the session's list; other sessions are untouched", () => {
  handle({ session_id: "end1", tool_name: "TodoWrite", tool_input: { todos } });
  handle({ session_id: "end2", tool_name: "TodoWrite", tool_input: { todos } });
  assert.deepEqual(handle({ session_id: "end1", hook_event_name: "SessionEnd" }), { removed: "end1" });
  assert.equal(readState("end1"), null);
  assert.equal(readState("end2").lists.main.length, 3);
});

test("SessionEnd for a session without a list does nothing", () => {
  assert.equal(handle({ session_id: "none", hook_event_name: "SessionEnd" }), null);
  assert.equal(handle({ hook_event_name: "SessionEnd" }), null);
  assert.equal(readState("none"), null);
});

test("a list written after /clear (new session id) starts fresh", () => {
  handle({ session_id: "before-clear", tool_name: "TodoWrite", tool_input: { todos } });
  handle({ session_id: "before-clear", hook_event_name: "SessionEnd" });
  handle({ session_id: "after-clear", tool_name: "TodoWrite", tool_input: { todos: todos.slice(0, 1) } });
  assert.equal(readState("before-clear"), null);
  assert.equal(readState("after-clear").lists.main.length, 1);
});

test("subagent lists record the agent type and are removed on SubagentStop", () => {
  handle({ session_id: "sa", tool_name: "TodoWrite", tool_input: { todos } });
  handle({
    session_id: "sa",
    agent_id: "a1",
    agent_type: "testing-playwright-jest",
    tool_name: "TodoWrite",
    tool_input: { todos: todos.slice(0, 2) },
  });
  let state = readState("sa");
  assert.deepEqual(state.agents, { a1: { type: "testing-playwright-jest" } });
  assert.equal(state.lists.a1.length, 2);

  handle({ session_id: "sa", hook_event_name: "SubagentStop", agent_id: "a1" });
  state = readState("sa");
  assert.equal(state.lists.a1, undefined);
  assert.deepEqual(state.agents, {});
  assert.equal(state.lists.main.length, 3, "the session's own list stays");
  assert.equal(handle({ session_id: "sa", hook_event_name: "SubagentStop", agent_id: "never-had-a-list" }), null);
});

test("a subagent's TaskCreate result given as text still yields the task id", () => {
  let tasks = applyTaskCreate([], { subject: "Scan" }, "Task #5 created successfully: Scan");
  tasks = applyTaskUpdate(tasks, { taskId: "5", status: "in_progress" });
  assert.deepEqual(tasks.map((t) => [t.id, t.status]), [["5", "in_progress"]]);
});

test("TaskCreate then TaskUpdate tracks one task incrementally", () => {
  let tasks = applyTaskCreate([], { subject: "P1", activeForm: "Doing P1" }, { task: { id: "1" } });
  tasks = applyTaskCreate(tasks, { subject: "P2" }, { task: { id: "2" } });
  tasks = applyTaskUpdate(tasks, { taskId: "1", status: "completed" });
  tasks = applyTaskUpdate(tasks, { taskId: "2", status: "in_progress" });
  assert.deepEqual(
    tasks.map((t) => [t.id, t.content, t.status]),
    [["1", "P1", "completed"], ["2", "P2", "in_progress"]],
  );
  assert.equal(applyTaskUpdate(tasks, { taskId: "2", status: "deleted" }).length, 1);
});

test("end to end through run.sh: the hook writes the state file and prints nothing", () => {
  const env = { ...process.env, TASK_TRACKER_DIR: tmp };
  const run = (arg, input) =>
    execFileSync(path.join(root, "run.sh"), [arg], { input: JSON.stringify(input), env }).toString();
  assert.equal(run("hook", { session_id: "e2e", tool_name: "TodoWrite", tool_input: { todos } }), "");
  assert.equal(readState("e2e").lists.main.length, 3);
  assert.equal(run("statusline", {}), "", "unknown modes are ignored");
  assert.equal(run("hook", "not json"), "", "bad input is swallowed silently");
});
