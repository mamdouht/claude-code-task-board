// Shared state for the task tracker: one JSON file per Claude Code session under
// ~/.claude/task-tracker/<session_id>.json, written by the PostToolUse hook and read by the
// status line (and any future viewer, e.g. a VS Code sidebar).
//
// File shape (version 1):
//   { version: 1, sessionId, cwd, transcriptPath?, pid?, updatedAt,
//     lists: { main: Task[], "<agentId>": Task[] }, agents?: { "<agentId>": { type } } }
//   Task = { id, content, activeForm?, status: "pending" | "in_progress" | "completed" }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_VERSION = 1;
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const STATUSES = new Set(["pending", "in_progress", "completed"]);

export function stateDir() {
  return process.env.TASK_TRACKER_DIR || path.join(os.homedir(), ".claude", "task-tracker");
}

// Session ids come from Claude Code, but they become a file name — never trust them as a path.
export function stateFile(sessionId) {
  const safe = String(sessionId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) return null;
  return path.join(stateDir(), `${safe}.json`);
}

export function readState(sessionId) {
  const file = stateFile(sessionId);
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && parsed.version === STATE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function writeState(state) {
  const file = stateFile(state.sessionId);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Atomic replace: the status line may read while the hook writes.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

export function pruneOld(now = Date.now()) {
  let entries;
  try {
    entries = fs.readdirSync(stateDir());
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(stateDir(), name);
    try {
      if (now - fs.statSync(file).mtimeMs > PRUNE_AFTER_MS) fs.unlinkSync(file);
    } catch {
      // Another session may have pruned it first.
    }
  }
}

function normaliseStatus(status) {
  return STATUSES.has(status) ? status : "pending";
}

// TodoWrite sends the WHOLE list on every call, so it simply replaces the list.
export function applyTodoWrite(tasks, input) {
  if (!input || !Array.isArray(input.todos)) return tasks;
  return input.todos.map((todo, i) => ({
    id: String(todo.id ?? i + 1),
    content: String(todo.content ?? todo.subject ?? ""),
    activeForm: todo.activeForm ? String(todo.activeForm) : undefined,
    status: normaliseStatus(todo.status),
  }));
}

// TaskCreate / TaskUpdate are incremental. Their exact payloads were NOT observed in a real
// transcript when this was written, so field names are read defensively; see DESIGN.md.
// A subagent's TaskCreate result can arrive as text only: "Task #5 created successfully: ...".
function idFromText(response) {
  const text = typeof response === "string" ? response : typeof response?.content === "string" ? response.content : "";
  const match = /Task #(\w+) created/.exec(text);
  return match ? match[1] : undefined;
}

function pickTaskId(input, response) {
  const candidates = [
    response?.task?.id,
    response?.taskId,
    response?.id,
    idFromText(response),
    input?.taskId,
    input?.id,
  ];
  const found = candidates.find((v) => v !== undefined && v !== null && v !== "");
  return found === undefined ? undefined : String(found);
}

export function applyTaskCreate(tasks, input, response) {
  if (!input) return tasks;
  const id = pickTaskId(input, response) ?? String(tasks.length + 1);
  const task = {
    id,
    content: String(input.subject ?? input.content ?? input.title ?? input.description ?? ""),
    activeForm: input.activeForm ? String(input.activeForm) : undefined,
    status: normaliseStatus(input.status),
  };
  return [...tasks.filter((t) => t.id !== id), task];
}

export function applyTaskUpdate(tasks, input, response) {
  if (!input) return tasks;
  const id = pickTaskId(input, response);
  if (id === undefined) return tasks;
  if (input.status === "deleted") return tasks.filter((t) => t.id !== id);
  const existing = tasks.find((t) => t.id === id);
  const updated = {
    id,
    content: String(input.subject ?? input.content ?? existing?.content ?? ""),
    activeForm: input.activeForm ? String(input.activeForm) : existing?.activeForm,
    status: input.status ? normaliseStatus(input.status) : existing?.status ?? "pending",
  };
  return existing ? tasks.map((t) => (t.id === id ? updated : t)) : [...tasks, updated];
}

export function summarise(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const done = list.filter((t) => t.status === "completed").length;
  const current = list.find((t) => t.status === "in_progress");
  return { done, total: list.length, current };
}
