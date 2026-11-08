/** An office worker who handles one kind of tool. The last three sit at the front desks. */
export type Role = 'archivist' | 'typist' | 'it' | 'courier' | 'researcher' | 'planner' | 'librarian'

/** A tool call of the main loop that is running now. */
export type Job = {
  /** The call's tool_use_id. */
  id: string
  role: Role
  /** A few characters for the bubble ("auth.ts", "npm test"). */
  short: string
  /** The whole action for the list ("Read src/auth.ts"). */
  full: string
  startedAt: number
  /** Busy only for a moment (BRIEF_MS) though the call runs on: briefing a new agent. */
  brief?: boolean
}

/** The last call a worker finished: drives the coffee break and the red ✗. */
export type LastJob = {
  short: string
  full: string
  /** The tool failed. */
  err: boolean
  /** The person said no to it. */
  denied: boolean
  endedAt: number
}

/** A finished call, kept for the turn so the picture can show it at a human pace. */
export type Done = { role: Role; short: string; full: string; startedAt: number; endedAt: number }

/** Where a subagent stands: working, finished, failed or stopped, or a teammate waiting for a message. */
export type SecStatus = 'run' | 'done' | 'fail' | 'idle'

/** A subagent, teammate or workflow agent: a secretary. */
export type Sec = {
  /** Its loop id (agentId). */
  id: string
  /** Its agent type (Explore, Plan) or a teammate's name. */
  name: string
  /** The short task its spawn gave it. */
  task: string
  /** Its current step for the bubble. */
  short: string
  /** Its current step for the list. */
  full: string
  status: SecStatus
  startedAt: number
  endedAt: number | null
  teammate: boolean
  /** Spawn order: the line at the door is first come, first served. */
  order: number
}

/** What the Manager (Claude's main loop) is doing. */
export type Mood = 'idle' | 'think' | 'write' | 'work' | 'permission' | 'ask' | 'done' | 'stopped' | 'hold'

/** One line of the to-do list, as TodoWrite gave it, or a task (TaskCreate / TaskUpdate / TaskList) with its id. */
export type Todo = { text: string; status: 'pending' | 'in_progress' | 'completed'; id?: string }

export type Office = {
  mood: Mood
  /** The Manager's list line when it says more than the mood (the command it needs your OK for). */
  moodText: string | null
  moodAt: number
  /** Plan mode is on: the Manager stands at the board. */
  plan: boolean
  /** A main turn is running. */
  turnActive: boolean
  /** Running tool calls of the main loop. */
  jobs: Job[]
  /** Each worker's last finished call. */
  last: Partial<Record<Role, LastJob>>
  /** This turn's finished calls (the last 30), for the human pace. An older stored state has none. */
  recent?: Done[]
  /** Commands still running in the background (as the last Stop listed them). */
  bg: string[]
  secs: Sec[]
  todos: Todo[] | null
  /** A compaction of the main conversation is running. */
  compacting: boolean
  /** Last time anything happened: night falls 10 minutes after it. */
  lastActivity: number
  /** Next spawn order number. */
  order: number
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-office': { office: Shaped<Office> }
  }
}
