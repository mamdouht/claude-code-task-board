// Pure data layer for the Claude Tasks panel — no `vscode` import, so it is unit-testable with
// plain `node --test`. Reads the task-tracker's v1 state files (see
// claude-mods/task-tracker/lib/state.mjs for the contract).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TITLE_TAIL_BYTES = 256 * 1024;
// State written before the hook recorded a PID, read while the session registry is unavailable,
// cannot be liveness-checked; treat it as ended once it has been idle this long (hidden, not removed).
const LEGACY_IDLE_MS = 60 * 60 * 1000;
// Never remove a list touched this recently — covers the moment between a session (re)starting
// and Claude Code updating its registry entry.
const REMOVE_GRACE_MS = 60 * 1000;
const titleCache = new Map(); // transcriptPath -> { size, title }

function defaultStateDir() {
  return path.join(os.homedir(), ".claude", "task-tracker");
}

function defaultSessionsDir() {
  return path.join(os.homedir(), ".claude", "sessions");
}

// Claude Code appends `{"type":"ai-title","aiTitle":"Rename X",...}` rows to the transcript;
// the latest one is the session's tab name. Only the tail is read — transcripts grow large.
function readSessionTitle(transcriptPath) {
  if (!transcriptPath) return undefined;
  let size;
  try {
    size = fs.statSync(transcriptPath).size;
  } catch {
    return undefined;
  }
  const cached = titleCache.get(transcriptPath);
  if (cached && cached.size === size) return cached.title;

  let title;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const length = Math.min(size, TITLE_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      const matches = buffer.toString("utf8").match(/"aiTitle":"((?:[^"\\]|\\.)*)"/g);
      if (matches) title = JSON.parse(`{${matches[matches.length - 1]}}`).aiTitle;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    title = undefined;
  }
  titleCache.set(transcriptPath, { size, title });
  return title;
}

function summarise(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const done = list.filter((t) => t.status === "completed").length;
  const current = list.find((t) => t.status === "in_progress");
  return { done, total: list.length, current, finished: list.length > 0 && done === list.length };
}

// Signal 0 checks existence without signalling. EPERM means it exists but belongs to someone else.
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

// Claude Code registers every running session in ~/.claude/sessions/<pid>.json
// ({ pid, sessionId, cwd, procStart, ... }). An entry counts only while its PID is alive — a crash
// can leave the file behind. Returns the set of open session ids, or null when the registry is
// missing or yields nothing usable (then callers fall back to the PID the hook recorded). Treating
// an empty result as "unknown" rather than "nothing is open" means a future change to the
// registry's format degrades to the fallback instead of wiping every list.
function readOpenSessions(sessionsDir = defaultSessionsDir(), isAlive = isProcessAlive) {
  let names;
  try {
    names = fs.readdirSync(sessionsDir).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return null;
  }
  const ids = new Set();
  for (const name of names) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(sessionsDir, name), "utf8"));
      if (Number.isInteger(entry.pid) && entry.sessionId && isAlive(entry.pid)) ids.add(entry.sessionId);
    } catch {
      // being rewritten, or not ours
    }
  }
  return ids.size > 0 ? ids : null;
}

// Why a session counts as ended, or undefined while it is open:
//   "closed"  — SessionEnd stamped it, the registry no longer lists it, or its recorded PID is
//               dead. Its list is removed.
//   "idle"    — no way to check (old state, no registry) and idle for an hour. Hidden only.
function endedReason(state, updatedAt, now, isAlive, openIds) {
  if (state.endedAt) return "closed";
  if (openIds) return openIds.has(state.sessionId) ? undefined : "closed";
  if (Number.isInteger(state.pid)) return isAlive(state.pid) ? undefined : "closed";
  return now - updatedAt > LEGACY_IDLE_MS ? "idle" : undefined;
}

function readStateFile(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state && state.version === 1 && state.lists ? state : null;
  } catch {
    return null; // half-written or foreign file
  }
}

// Deletes the state files of sessions that are confirmed closed — in every workspace, not just
// the open one. Returns the removed session ids.
function removeClosedSessions({
  stateDir = defaultStateDir(),
  sessionsDir = defaultSessionsDir(),
  isAlive = isProcessAlive,
  now = Date.now(),
} = {}) {
  let names;
  try {
    names = fs.readdirSync(stateDir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const openIds = readOpenSessions(sessionsDir, isAlive);
  const removed = [];
  for (const name of names) {
    const file = path.join(stateDir, name);
    const state = readStateFile(file);
    if (!state) continue;
    const updatedAt = Date.parse(state.updatedAt) || 0;
    if (now - updatedAt < REMOVE_GRACE_MS) continue;
    if (endedReason(state, updatedAt, now, isAlive, openIds) !== "closed") continue;
    try {
      fs.unlinkSync(file);
      removed.push(state.sessionId);
    } catch {
      // already gone
    }
  }
  return removed;
}

function isInside(dir, folders) {
  if (!dir) return false;
  return folders.some((folder) => dir === folder || dir.startsWith(folder + path.sep));
}

// Returns open sessions with a non-empty main list, newest first. Ended ones are dropped unless
// includeEnded is set, in which case they carry `ended: true`.
function loadSessions({
  stateDir = defaultStateDir(),
  sessionsDir = defaultSessionsDir(),
  workspaceFolders = [],
  maxAgeMs,
  includeEnded = false,
  isAlive = isProcessAlive,
  now = Date.now(),
} = {}) {
  let names;
  try {
    names = fs.readdirSync(stateDir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const openIds = readOpenSessions(sessionsDir, isAlive);
  const sessions = [];
  for (const name of names) {
    const state = readStateFile(path.join(stateDir, name));
    if (!state) continue;
    const tasks = Array.isArray(state.lists.main) ? state.lists.main : [];
    const agents = state.agents || {};
    const subagents = Object.entries(state.lists)
      .filter(([key, list]) => key !== "main" && Array.isArray(list) && list.length > 0)
      .map(([agentId, list]) => ({ agentId, type: agents[agentId]?.type, tasks: list, summary: summarise(list) }));
    // A session whose only list belongs to a subagent still shows (e.g. a delegated build).
    if (tasks.length === 0 && subagents.length === 0) continue;
    const updatedAt = Date.parse(state.updatedAt) || 0;
    if (maxAgeMs && now - updatedAt > maxAgeMs) continue;
    if (workspaceFolders.length > 0 && !isInside(state.cwd, workspaceFolders)) continue;
    const ended = endedReason(state, updatedAt, now, isAlive, openIds) !== undefined;
    if (ended && !includeEnded) continue;
    sessions.push({
      sessionId: state.sessionId,
      title: readSessionTitle(state.transcriptPath),
      cwd: state.cwd,
      updatedAt,
      ended,
      tasks,
      subagents,
      summary: summarise(tasks),
    });
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

// The session the user is looking at: the one whose title matches the active Claude tab, else
// the most recently updated unfinished one, else the most recent.
function pickFocused(sessions, activeTabLabel) {
  if (sessions.length === 0) return undefined;
  if (activeTabLabel) {
    const byTab = sessions.find((s) => s.title && s.title === activeTabLabel);
    if (byTab) return byTab;
  }
  const live = sessions.filter((s) => !s.ended);
  return live.find((s) => !s.summary.finished) ?? live[0] ?? sessions[0];
}

function sessionLabel(session) {
  return session.title || session.tasks[0]?.content || session.sessionId.slice(0, 8);
}

function subagentLabel(sub) {
  return sub.type ? `${sub.type} (subagent)` : `Subagent ${sub.agentId.slice(0, 8)}`;
}

// The list the status bar follows: the session's own, or — while it has none — the first running
// subagent's, so a delegated build still shows progress.
function primaryList(session) {
  if (!session) return undefined;
  if (session.tasks.length > 0) return { label: undefined, tasks: session.tasks, summary: session.summary };
  const sub = session.subagents[0];
  return sub ? { label: subagentLabel(sub), tasks: sub.tasks, summary: sub.summary } : undefined;
}

function relativeTime(then, now = Date.now()) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Status bar text, using VS Code's $(icon) syntax.
function statusBarText(session) {
  const list = primaryList(session);
  if (!list) return undefined;
  const { done, total, current, finished } = list.summary;
  const who = list.label ? `$(hubot) ` : "";
  if (finished) return `${who}$(pass-filled) ${done}/${total} done`;
  const step = current ? ` ▸ ${truncate(current.activeForm || current.content, 40)}` : "";
  return `${who}$(checklist) ${done}/${total}${step}`;
}

const STATUS_MARK = { completed: "✅", in_progress: "⏳", pending: "⬜" };

function taskLines(tasks) {
  return tasks.map((task) => {
    const text = task.status === "in_progress" && task.activeForm ? task.activeForm : task.content;
    return `${STATUS_MARK[task.status] ?? "⬜"} ${text.replace(/([\\`*_[\]<>])/g, "\\$1")}`;
  });
}

function tooltipMarkdown(session) {
  if (!session) return "";
  const lines = [`**${sessionLabel(session)}** — ${session.summary.done}/${session.summary.total} done`];
  lines.push(...taskLines(session.tasks));
  for (const sub of session.subagents) {
    lines.push(`**${subagentLabel(sub)}** — ${sub.summary.done}/${sub.summary.total} done`, ...taskLines(sub.tasks));
  }
  return lines.join("\n\n");
}

module.exports = {
  defaultSessionsDir,
  defaultStateDir,
  isProcessAlive,
  readOpenSessions,
  removeClosedSessions,
  loadSessions,
  pickFocused,
  readSessionTitle,
  relativeTime,
  primaryList,
  sessionLabel,
  statusBarText,
  subagentLabel,
  summarise,
  tooltipMarkdown,
};
