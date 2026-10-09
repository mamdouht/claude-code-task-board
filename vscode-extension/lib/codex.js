// Reads OpenAI Codex CLI rollout files directly — no Codex-side hook required — and builds
// session objects shaped exactly like the ones lib/model.js produces (sessionId, title, cwd,
// updatedAt, ended, tasks, subagents, summary), so extension.js can render both sources in the
// same tree/status bar. Pure data layer, no `vscode` import — unit-testable with plain
// `node --test`.
//
// Schema notes — reverse-engineered from real ~/.codex/sessions/**/rollout-*.jsonl files on this
// machine (Codex CLI 0.159.2, `cli` and `codex_vscode` originators). Nothing below is guessed
// without saying so:
//   - One file per session. Line 0 is always `{"type":"session_meta","payload":{"session_id":
//     "<uuid>","cwd":"...", ...}}`. Every other line is `{"timestamp","ordinal","type":
//     "event_msg"|"response_item"|..., "payload":{...}}` — `ordinal` is a strictly increasing
//     per-file sequence number, used below to find the LATEST plan-like event.
//   - Codex's own system prompt documents two distinct "plan" concepts, and real files only ever
//     exercised the first one:
//       1. Plan Mode: one `event_msg` with `payload.type === "item_completed"` and
//          `payload.item.type === "Plan"`, carrying a full markdown planning *document* in
//          `payload.item.text` — no per-step status. Confirmed from real sessions (3 occurrences
//          across 19 rollout files sampled).
//       2. `update_plan`: described by Codex's system prompt as "a checklist/progress/TODOs
//          tool", distinct from Plan Mode. It was never actually invoked in any sampled local
//          rollout, so its shape here is taken from Codex's own published tool schema, not from
//          an observed example: a `response_item` with `payload.type === "function_call"`,
//          `payload.name === "update_plan"`, and `payload.arguments` a JSON string
//          `{"plan":[{"step":"...","status":"pending"|"in_progress"|"completed"}, ...]}`. If
//          Codex ever changes this shape, parsing just falls through to the Plan Mode path below
//          rather than throwing.
//   - `event_msg` with `payload.type === "task_complete"` and a `turn_id` marks a turn finished.
//     It is the only completion signal available for a Plan Mode document (which carries no
//     per-step status): every extracted line starts "pending", and ALL of them flip to
//     "completed" together once a task_complete for that document's turn_id is seen. This is an
//     approximation, not a measured fact — documented here rather than invented silently.
//   - There is no PID/registry file for Codex sessions (unlike Claude's ~/.claude/sessions), so
//     "ended" is approximated from the rollout file's own mtime (IDLE_MS below).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { summarise } = require("./model");

const HEAD_BYTES = 64 * 1024; // session_meta + the first user message live in the first few KB
const TAIL_BYTES = 2 * 1024 * 1024; // the latest plan/update_plan/task_complete rarely sit further back
const MAX_WALK_DEPTH = 6; // tolerate deeper/shallower nesting than the known YYYY/MM/DD
const DEFAULT_MAX_FILES = 200; // bound cost even if a huge number of rollouts exist
const IDLE_MS = 15 * 60 * 1000; // no liveness registry for Codex — approximate "ended" from mtime
const STATUSES = new Set(["pending", "in_progress", "completed"]);
const asStatus = (v) => (STATUSES.has(v) ? v : undefined);

const rolloutCache = new Map(); // filePath -> { size, mtimeMs, session }

function defaultCodexSessionsDir() {
  return path.join(os.homedir(), ".codex", "sessions");
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readTail(file, bytes) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, "r");
  try {
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // half-written, or the first/last line of a head/tail read got cut mid-way — skip it
    }
  }
  return rows;
}

function dedupeByOrdinal(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = row.ordinal ?? row.timestamp;
    if (key !== undefined) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(row);
  }
  return out;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Strips the markdown Codex plan docs use down to plain text, so it reads like a Claude TodoWrite
// entry in the tree view (no literal `**`, `[link](url)`, or Codex's citation directive).
function stripMarkdown(text) {
  return text
    .replace(/:codex-file-citation\{[^}]*\}/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[`*_]/g, "")
    .trim();
}

// Flattens a Plan Mode markdown document into step-like lines: only column-0 bullet/numbered list
// items — nested sub-bullets are detail, not steps. See the module header for why every item
// starts "pending" here; the caller decides whether to flip them to "completed".
function tasksFromPlanMarkdown(markdown) {
  const items = [];
  for (const raw of String(markdown ?? "").split("\n")) {
    const m = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(raw);
    if (!m) continue;
    const content = stripMarkdown(m[1]);
    if (content) items.push(content);
  }
  return items;
}

function tasksFromPlanDoc(text, finished) {
  return tasksFromPlanMarkdown(text).map((content, i) => ({
    id: String(i + 1),
    content,
    status: finished ? "completed" : "pending",
    activeForm: undefined,
  }));
}

function tasksFromUpdatePlan(plan) {
  return plan
    .filter((p) => p && typeof p.step === "string" && p.step.trim())
    .map((p, i) => ({
      id: String(i + 1),
      content: p.step,
      status: asStatus(p.status) ?? "pending",
      activeForm: undefined,
    }));
}

// Scans a session's rows for the LATEST plan-like event (highest `ordinal` wins — "latest plan
// snapshot wins", whichever source produced it) and converts it into a flat task list.
function latestPlanTasks(rows) {
  let best; // { ordinal, kind: "update_plan" | "doc", plan?, text?, turnId? }
  const completedTurns = new Set();
  for (const row of rows) {
    const payload = row?.payload;
    if (!payload) continue;
    if (payload.type === "task_complete" && payload.turn_id) completedTurns.add(payload.turn_id);

    if (payload.type === "function_call" && payload.name === "update_plan") {
      let args;
      try {
        args = JSON.parse(payload.arguments);
      } catch {
        args = null;
      }
      if (args && Array.isArray(args.plan) && (!best || row.ordinal > best.ordinal)) {
        best = { ordinal: row.ordinal, kind: "update_plan", plan: args.plan };
      }
    }

    if (payload.type === "item_completed" && payload.item?.type === "Plan") {
      if (!best || row.ordinal > best.ordinal) {
        best = { ordinal: row.ordinal, kind: "doc", text: payload.item.text, turnId: payload.turn_id };
      }
    }
  }
  if (!best) return [];
  if (best.kind === "update_plan") return tasksFromUpdatePlan(best.plan);
  return tasksFromPlanDoc(best.text, completedTurns.has(best.turnId));
}

// Best-effort session title from the first UserMessage: real codex_vscode sessions wrap it with
// a "# Files mentioned..." header and a "## My request:" marker ahead of the actual ask; plain
// CLI sessions don't. Falls back to the first non-heading line either way.
function extractTitle(rows) {
  for (const row of rows) {
    const payload = row?.payload;
    if (payload?.type !== "item_completed" || payload.item?.type !== "UserMessage") continue;
    const block = Array.isArray(payload.item.content) ? payload.item.content.find((c) => c?.type === "text") : undefined;
    if (typeof block?.text !== "string") continue;
    const lines = block.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const marker = lines.indexOf("## My request:");
    const line = marker >= 0 ? lines[marker + 1] : lines.find((l) => !l.startsWith("#"));
    if (line) return truncate(line, 80);
  }
  return undefined;
}

function walkRolloutFiles(dir, depth, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // missing dir (Codex never ran here) or a permissions hiccup
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_WALK_DEPTH) walkRolloutFiles(full, depth + 1, out);
    } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
}

// Only the files that could plausibly still matter: recently modified, newest first, capped —
// never a directory scan that loads a year of history to show today's plan.
function findRecentRolloutFiles({ sessionsDir, maxFileAgeMs, now, maxFiles = DEFAULT_MAX_FILES }) {
  const all = [];
  walkRolloutFiles(sessionsDir, 0, all);
  const withStat = [];
  for (const file of all) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue; // removed between readdir and stat
    }
    if (maxFileAgeMs && now - stat.mtimeMs > maxFileAgeMs) continue;
    withStat.push({ file, mtimeMs: stat.mtimeMs });
  }
  withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStat.slice(0, maxFiles).map((f) => f.file);
}

function isInsideAny(dir, folders) {
  if (!dir) return false;
  return folders.some((folder) => dir === folder || dir.startsWith(folder + path.sep));
}

// Parses one rollout file into a session object, or null when it has nothing plan-like yet (most
// Codex sessions never call update_plan or enter Plan Mode — see module header — so most files
// are expected to return null and are simply not shown). Cached by size+mtime so an unchanged
// multi-MB file is never re-read on the next poll tick.
function sessionFromRollout(file, { now = Date.now() } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const cached = rolloutCache.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.session;

  let headRows, tailRows;
  try {
    headRows = parseLines(readHead(file, HEAD_BYTES));
    tailRows = parseLines(readTail(file, TAIL_BYTES));
  } catch {
    return null;
  }
  const meta = headRows.find((r) => r.type === "session_meta");
  if (!meta?.payload?.session_id) return null;

  const rows = dedupeByOrdinal([...headRows, ...tailRows]);
  const tasks = latestPlanTasks(rows);
  if (tasks.length === 0) return null; // nothing to show — don't clutter the board with idle chats

  const lastEventMs = rows.reduce((max, r) => {
    const t = Date.parse(r.timestamp);
    return Number.isFinite(t) ? Math.max(max, t) : max;
  }, 0);
  const updatedAt = lastEventMs > 0 ? lastEventMs : stat.mtimeMs;

  const session = {
    sessionId: meta.payload.session_id,
    title: extractTitle(headRows),
    cwd: meta.payload.cwd,
    updatedAt,
    ended: now - stat.mtimeMs > IDLE_MS,
    tasks,
    subagents: [], // Codex plans are flat — no subagent nesting
    summary: summarise(tasks),
    source: "codex",
  };
  rolloutCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, session });
  return session;
}

// Returns Codex sessions with a non-empty plan, newest first — same shape and filtering
// semantics as model.js's loadSessions (workspace filter, max age, includeEnded).
function loadCodexSessions({
  sessionsDir = defaultCodexSessionsDir(),
  workspaceFolders = [],
  maxAgeMs,
  maxFileAgeMs = 7 * 24 * 3600 * 1000, // don't even look at rollouts older than a week
  includeEnded = false,
  now = Date.now(),
} = {}) {
  const files = findRecentRolloutFiles({ sessionsDir, maxFileAgeMs, now });
  const sessions = [];
  for (const file of files) {
    const session = sessionFromRollout(file, { now });
    if (!session) continue;
    if (maxAgeMs && now - session.updatedAt > maxAgeMs) continue;
    if (workspaceFolders.length > 0 && !isInsideAny(session.cwd, workspaceFolders)) continue;
    if (session.ended && !includeEnded) continue;
    sessions.push(session);
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

module.exports = {
  defaultCodexSessionsDir,
  loadCodexSessions,
  tasksFromPlanMarkdown,
};
