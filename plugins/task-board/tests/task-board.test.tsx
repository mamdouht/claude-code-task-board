import { describe, expect, test } from 'claude-code/testing'

import { outline, toTasks } from '../hooks/register'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const plan = [
  { content: 'P1 schema', status: 'completed', activeForm: 'Writing schema' },
  { content: 'P2 hook', status: 'in_progress', activeForm: 'Writing the hook' },
  { content: 'P3 docs', status: 'pending', activeForm: 'Writing docs' },
] as const

describe('outline', () => {
  test('compact: one header per list, subagents nested under the main list', async () => {
    const lists = {
      main: toTasks(plan),
      a1: toTasks([{ content: 'Run suite', status: 'in_progress', activeForm: 'Running the suite' }]),
    }
    const rows = outline(lists, { a1: { type: 'testing-playwright-jest' } }, false)
    expect(rows.map(r => [r.depth, r.text])).toEqual([
      [0, 'Tasks 1/3 ▸ Writing the hook'],
      [1, '↳ testing-playwright-jest 0/1 ▸ Running the suite'],
    ])
  })

  test('expanded: every task, subagent tasks one level deeper', async () => {
    const rows = outline({ main: toTasks(plan), a1: toTasks([plan[0]]) }, {}, true)
    expect(rows.map(r => r.depth)).toEqual([0, 1, 1, 1, 1, 2])
    expect(rows[2]?.text).toBe('▸ Writing the hook')
    expect(rows[4]?.text).toBe('↳ subagent a1 1/1 all done')
  })

  test('nothing to show when there are no lists', async () => {
    expect(outline({}, {}, false)).toEqual([])
    expect(toTasks('nope')).toEqual([])
  })
})

describe('band', () => {
  test('a TodoWrite call draws the plan above the prompt; a subagent nests; its stop removes it', async ($, on) => {
    // Stands in for the engine's own band, which the mod falls through to when it has no list.
    on('ui.render', async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine-band" />
    })
    // Stands in for the tool itself; the mod records the list before it runs.
    on('tool.call', async () => ({ result: { text: 'ok' } }) as never)
    // Stand in for the settings hooks a session would run on these events (none configured).
    on('classic.SubagentStart', async () => ({}) as never)
    on('classic.SubagentStop', async () => ({}) as never)
    const empty = await $.ui.mount({ plugin: 'task-board', surface: 'terminal', ...BAND })
    expect(await empty.find({ type: 'Text', text: /Tasks/ })).toBeUndefined()
    await empty.unmount()

    await $.tool.call({ tool: 'TodoWrite', todos: [...plan] })
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
    // The kit runs tools on the main loop; agentId stands in for a call from the subagent's loop.
    await $.tool.call({
      tool: 'TodoWrite',
      agentId: 'a1',
      todos: [{ content: 'Scan', status: 'in_progress', activeForm: 'Scanning' }],
    } as never)

    const ui = await $.ui.mount({ plugin: 'task-board', surface: 'terminal', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'Tasks 1/3 ▸ Writing the hook' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↳ Explore 0/1 ▸ Scanning' })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: '▸ Scanning' })).toBeDefined()
    await ui.unmount()

    await $.classic.SubagentStop({
      agent_id: 'a1',
      agent_type: 'Explore',
      agent_transcript_path: '',
      stop_hook_active: false,
    })
    const after = await $.ui.mount({ plugin: 'task-board', surface: 'terminal', ...BAND })
    expect(await after.find({ type: 'Text', text: /Explore/ })).toBeUndefined()
    expect(await after.find({ type: 'Text', text: /Tasks 1\/3/ })).toBeDefined()
    await after.unmount()
  })
})
