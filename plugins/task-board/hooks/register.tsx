// task-board: Claude's task list, drawn inside Claude Code.
//
// - A band above the prompt: one line per list — the session's own plan, and each running
//   subagent's nested under it — with done/total and the step in progress. "Show all" expands
//   every task, subagent tasks indented under their agent.
// - /tasks opens the same nested list in a pane beside the transcript.
//
// Source of truth is the TodoWrite tool call itself (a subagent's call carries its agentId), so
// this mod needs no settings hook. A subagent's list goes when classic.SubagentStop fires for it.
// Drawing shows in the terminal and the Desktop app's Code tab; the VS Code chat panel runs the
// hooks but draws nothing (the claude-task-panel extension covers VS Code).

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentMeta, Task, TaskLists } from '../types'

const PANE = 'task-board'
const MAX_STEP_CHARS = 60
const MAX_EXPANDED_ROWS = 14

const lists = atom({ plugin: 'task-board', key: 'lists' } as const, {})
const agents = atom({ plugin: 'task-board', key: 'agents' } as const, {})
const isExpanded = atom({ plugin: 'task-board', key: 'isExpanded' } as const, false)

const MARK = { completed: '✓', in_progress: '▸', pending: '○' } as const

export function toTasks(todos: unknown): Task[] {
  if (!Array.isArray(todos)) return []
  return todos.map(todo => ({
    content: String(todo?.content ?? ''),
    activeForm: String(todo?.activeForm ?? todo?.content ?? ''),
    status: todo?.status === 'completed' || todo?.status === 'in_progress' ? todo.status : 'pending',
  }))
}

export function summary(tasks: Task[]) {
  const done = tasks.filter(t => t.status === 'completed').length
  const current = tasks.find(t => t.status === 'in_progress')
  return { done, total: tasks.length, current, isFinished: tasks.length > 0 && done === tasks.length }
}

function clip(text: string, max = MAX_STEP_CHARS) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export type Row = { depth: 0 | 1 | 2; text: string; tone: 'head' | 'done' | 'active' | 'pending' }

// The nested outline both views draw: the main list first, then each subagent's under it.
// Compact = one header row per list; expanded = every task too (subagent tasks one level deeper).
export function outline(all: TaskLists, meta: AgentMeta, isFull: boolean): Row[] {
  const rows: Row[] = []
  const main = all.main ?? []
  const subagentIds = Object.keys(all).filter(id => id !== 'main' && (all[id]?.length ?? 0) > 0)

  const header = (label: string, tasks: Task[], depth: 0 | 1): Row => {
    const s = summary(tasks)
    const step = s.isFinished ? 'all done' : s.current ? `▸ ${clip(s.current.activeForm || s.current.content)}` : ''
    return { depth, text: `${label} ${s.done}/${s.total} ${step}`.trimEnd(), tone: 'head' }
  }
  const taskRows = (tasks: Task[], depth: 1 | 2): Row[] =>
    tasks.map(t => ({
      depth,
      text: `${MARK[t.status]} ${clip(t.status === 'in_progress' ? t.activeForm || t.content : t.content)}`,
      tone: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'active' : 'pending',
    }))

  if (main.length > 0) {
    rows.push(header('Tasks', main, 0))
    if (isFull) rows.push(...taskRows(main, 1))
  }
  for (const id of subagentIds) {
    const tasks = all[id] ?? []
    const label = `↳ ${meta[id]?.type ?? `subagent ${id.slice(0, 8)}`}`
    rows.push(header(label, tasks, 1))
    if (isFull) rows.push(...taskRows(tasks, 2))
  }
  return rows
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tasks', description: "Show Claude's task lists in a pane" })
    return next(e)
  })

  on('command.run', { command: 'tasks' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tasks' })
    return { text: 'Tasks pane opened.' }
  })

  // Record every TodoWrite, keyed by the loop that made it. Recorded before the tool runs, so
  // the band changes the moment Claude updates its plan.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const key = e.agentId ?? 'main'
    const tasks = toTasks(e.todos)
    await update($, lists, all => ({ ...all, [key]: tasks }))
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    await update($, agents, meta => ({ ...meta, [e.agent_id]: { type: e.agent_type } }))
    return next(e)
  })

  // A finished subagent's list is over; the session's own list stays.
  on('classic.SubagentStop', async ($, e, next) => {
    await update($, lists, all => {
      const { [e.agent_id]: _gone, ...rest } = all
      return rest
    })
    await update($, agents, meta => {
      const { [e.agent_id]: _gone, ...rest } = meta
      return rest
    })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // A /clear starts a fresh session: its old plan should not linger.
  on('session.end', async ($, e, next) => {
    await update($, lists, () => ({}))
    await update($, agents, () => ({}))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const full = await read($, isExpanded)
    const rows = outline(await read($, lists), await read($, agents), full)
    if (rows.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = full ? rows.slice(0, MAX_EXPANDED_ROWS) : rows
    const hidden = rows.length - shown.length

    return (
      <Box flexDirection="column">
        {shown.map((row, i) => (
          <Box key={`r${i}`} paddingLeft={row.depth * 2}>
            <Text
              bold={row.tone === 'head' && row.depth === 0}
              dimColor={row.tone === 'done' || row.tone === 'pending'}
              color={row.tone === 'active' ? 'yellow' : undefined}
              wrap="truncate-end"
            >
              {row.text}
            </Text>
          </Box>
        ))}
        <Box>
          {hidden > 0 && <Text dimColor>… {hidden} more (/tasks) </Text>}
          <Button
            key="toggle"
            label={full ? 'Collapse' : 'Show all'}
            plain
            dimColor
            onPress={() => update($, isExpanded, v => !v)}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = outline(await read($, lists), await read($, agents), true)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 2)

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>No task list yet. Claude writes one for multi-step work.</Text>}
        {rows.slice(0, room).map((row, i) => (
          <Box key={`p${i}`} paddingLeft={row.depth * 2}>
            <Text
              bold={row.tone === 'head'}
              dimColor={row.tone === 'done'}
              color={row.tone === 'active' ? 'yellow' : undefined}
              wrap="truncate-end"
            >
              {row.text}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
