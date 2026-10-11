/** One usage-limit window as the last API response reported it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

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
  /** $ this session spent since it started here, growing even when `usd` starts over. */
  spent: number
  /** `spent` when the running turn began; null between turns. */
  turnStartSpent: number | null
  /** Each window's learned % per dollar, shared by every session. */
  rates: Record<string, number>
  /** Clock reading of the last refresh. */
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-forecast': { weather: Weather }
  }
}
