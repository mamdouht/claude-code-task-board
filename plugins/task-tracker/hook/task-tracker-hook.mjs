#!/usr/bin/env node
// Task-tracker hook, registered for three events:
//   PostToolUse (TodoWrite|TaskCreate|TaskUpdate) — records the task list of the session, or of
//                the subagent that made the call (payload.agent_id / agent_type);
//   SubagentStop — removes that subagent's list once it finishes;
//   SessionEnd — removes the session's file (exit, /clear, logout). A tab killed without
//                SessionEnd is cleaned up by viewers instead, from Claude Code's session registry.
// It must never block or fail the session, so every error is swallowed and the process always
// exits 0 with no output.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  applyTaskCreate,
  applyTaskUpdate,
  applyTodoWrite,
  pruneOld,
  readState,
  stateFile,
  STATE_VERSION,
  writeState,
} from "../lib/state.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// The Claude Code process that owns this session. Hooks inherit CLAUDE_PID from it; viewers
// treat a dead PID as an ended session (covers a killed tab, where SessionEnd may never run).
function claudePid(env) {
  const pid = Number.parseInt(env.CLAUDE_PID ?? "", 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

// SessionEnd only touches sessions that already have a task list.
function handleSessionEnd(sessionId) {
  const file = stateFile(sessionId);
  if (!file || !fs.existsSync(file)) return null;
  fs.unlinkSync(file);
  return { removed: sessionId };
}

// SubagentStop: the subagent's work is over, so its list goes; the session's own list stays.
function handleSubagentStop(sessionId, agentId, now) {
  const state = readState(sessionId);
  if (!state || !agentId || !(agentId in state.lists)) return null;
  delete state.lists[agentId];
  if (state.agents) delete state.agents[agentId];
  state.updatedAt = now.toISOString();
  writeState(state);
  return state;
}

export function handle(payload, now = new Date(), env = process.env) {
  const { session_id: sessionId, tool_name: tool, tool_input: input, tool_response: response } =
    payload || {};
  const event = payload?.hook_event_name;
  if (event === "SessionEnd") return sessionId ? handleSessionEnd(sessionId) : null;
  if (event === "SubagentStop") return handleSubagentStop(sessionId, payload.agent_id, now);
  if (!sessionId || !tool) return null;

  // Subagents keep their own lists; key them apart so the main list is not overwritten.
  const listKey = payload.agent_id ? String(payload.agent_id) : "main";
  const state = readState(sessionId) ?? {
    version: STATE_VERSION,
    sessionId,
    cwd: payload.cwd,
    lists: {},
  };
  const before = state.lists[listKey] ?? [];

  let after;
  if (tool === "TodoWrite") after = applyTodoWrite(before, input);
  else if (tool === "TaskCreate") after = applyTaskCreate(before, input, response);
  else if (tool === "TaskUpdate") after = applyTaskUpdate(before, input, response);
  else return null;

  state.lists[listKey] = after;
  if (listKey !== "main" && payload.agent_type) {
    state.agents = { ...state.agents, [listKey]: { type: String(payload.agent_type) } };
  }
  state.cwd = payload.cwd ?? state.cwd;
  // Viewers read the session's title (the Claude tab name) from the transcript's ai-title rows.
  state.transcriptPath = payload.transcript_path ?? state.transcriptPath;
  state.pid = claudePid(env) ?? state.pid;
  state.updatedAt = now.toISOString();
  writeState(state);
  return state;
}

async function main() {
  try {
    handle(JSON.parse(await readStdin()));
    if (Math.random() < 0.05) pruneOld();
  } catch {
    // Never surface hook errors to the session.
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();
