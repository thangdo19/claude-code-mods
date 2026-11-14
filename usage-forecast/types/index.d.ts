/** One usage-limit window as the last API response reported it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** Where an agent's loop stands, as the band marks it. */
export type AgentStatus = 'running' | 'done' | 'failed' | 'killed' | 'idle'

/** A subagent, teammate or workflow agent of this session, as the band lists it. */
export type Agent = {
  /** Its agent type (`Explore`, `Plan`), `workflow`, or a teammate's name. */
  type: string
  /** The few words its spawn gave the task. */
  description: string
  /** The model id its last request ran on; null before the first. */
  model: string | null
  /** The effort of its last request; null when unknown or the model takes none. */
  effort: string | null
  status: AgentStatus
  /** $ its own requests cost, each response's cost read right after it. */
  spent: number
  /** Started in the background: it may outlive the turn that spawned it. */
  background: boolean
  /** A teammate: it goes idle between turns instead of finishing. */
  teammate: boolean
  /** The agent that spawned it; null when the main loop did. */
  parentId: string | null
  /** A workflow run's id: its agents show as one entry. */
  workflow: string | null
  /** It compacted its own transcript. */
  compacted: boolean
  startedAt: number
  /** When its run ended; null while it runs. */
  endedAt: number | null
  /** Spawn order, for a steady listing. */
  order: number
}

export type Weather = {
  /** Context tokens in use; null when unknown (right after compaction). */
  tokens: number | null
  /** The model's context window in tokens; 0 before the first measurement. */
  window: number
  /** True while `tokens` is the start-of-session local estimate. */
  isEstimate: boolean
  /** Context tokens at the end of each of the last 12 main turns, oldest first. */
  history: number[]
  /** Tokens the last main turn added (negative when the context shrank). */
  lastDelta: number | null
  /** True when a compaction ran within `lastDelta`'s span. */
  lastDeltaCompacted: boolean
  /** Context tokens when the running turn began, for the first turn's delta. */
  turnStartTokens: number | null
  /** A compaction ran since the last main turn finished. */
  compacted: boolean
  limits: Limit[]
  /** When `limits` were saved by an earlier session; null once live. */
  limitsAsOf: number | null
  /** Each limit's % when the running turn began; null between turns. */
  turnStartLimits: Record<string, number> | null
  /** Each limit's % change over the last finished turn; negative when its window reset. */
  lastLimitDelta: Record<string, number>
  /** This session's id in the store's shared spend list; '' before session.start. */
  instanceId: string
  /** The session's own $ total at the last reading; null before the first. */
  usd: number | null
  /** When the ledger behind `usd` began (`startedAt`); a new one (a /clear, a resume) is counted afresh. */
  costFrom: number | null
  /** $ this session spent since it started here, growing even when `usd` starts over. */
  spent: number
  /** `spent` when the running turn began; null between turns. */
  turnStartSpent: number | null
  /** Each window's learned % per dollar, shared by every session. */
  rates: Record<string, number>
  /** Clock reading of the last refresh. */
  now: number
  /** The main loop's model id as the engine gave it; null before the first. */
  model: string | null
  /** The effort level of the last main request; null when unknown or the model takes none. */
  effort: string | null
  /** The model's name before a switch, shown until a whole turn ran after it. */
  switchedFrom: string | null
  /** A turn has started since the switch, so its end clears the note. */
  switchSeen: boolean
  /** Agents by loop id: running ones, and finished ones until the next main turn starts. */
  agents: Record<string, Agent>
  /** Loop ids no agent list names (compaction, memory): the engine's own forks, counted as yours. */
  forks: string[]
  /** $ all agents of this session spent, part of `spent`; kept across /clear and dropped records. */
  agentSpent: number
  /** $ compactions cost since the last measured main turn. */
  compactSpent: number
  /** $ the compaction within `lastDelta` cost; null when none ran. */
  lastCompactSpent: number | null
  /** When a /clear ended the last conversation; the next cost ledger counts in full from it. */
  clearedAt: number | null
  /** $ this session's replies cost by model family ("Fable"), in the parent limit's current window. */
  modelSpent: ModelLedger
  /** The same for every other session on this computer, added up from the store. */
  modelTotals: ModelLedger
  /** This session's Fable $ when the running turn began; null between turns. */
  turnStartFable: number | null
  /** Fable's points of the parent over the last finished turn; negative when its window reset. */
  lastFableDelta: number | null
  /** When the Fable count began, while that is inside the parent's current window; else null. */
  fableSince: number | null
  /** Fable's allowance as a % of the week (50), from the account's usage answer; null when unknown. */
  fableAllowance: number | null
  /** When the account's usage answer was last asked for (it is asked at most once a minute); 0 never. */
  serverAt: number
  /** A turn ended since that answer was asked for: the minute timer asks again. */
  serverDue: boolean
}

/** $ by model family in one window of the parent limit (Week, or Spend). */
export type ModelLedger = { usd: Record<string, number>; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-forecast': { weather: Weather }
  }
}
