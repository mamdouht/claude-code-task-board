export type TaskStatus = 'pending' | 'in_progress' | 'completed'
// id: TodoWrite position (1-based) or the Task tools' own task id
export type Task = { id: string; content: string; activeForm: string; status: TaskStatus }
// One list per loop: 'main' for the session's own, a subagent's agentId for each subagent.
export type TaskLists = Record<string, Task[]>
// What we know about each running subagent, from classic.SubagentStart.
export type AgentMeta = Record<string, { type: string }>

declare module 'claude-code' {
  interface PluginState {
    'task-board': { lists: TaskLists; agents: AgentMeta; isExpanded: boolean }
  }
}
