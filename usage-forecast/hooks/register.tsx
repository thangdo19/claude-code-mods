import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Agent, Limit, Weather } from '../types'
import { fableTurnUsd, limitRows, MODEL_COLOR, thisDeltaOf } from './rows'
import {
  addSpend,
  AGENT_ICONS,
  agentEntries,
  bookModel,
  endStatus,
  FABLE,
  fableTurn,
  familyOf,
  fitItems,
  fmtLeft,
  fmtModel,
  fmtPct,
  fmtTokens,
  HISTORY,
  isAlias,
  isFableKind,
  learnRate,
  parentOf,
  percentOf,
  pushHistory,
  reviveLimits,
  sameModel,
  sameWindow,
  serverFable,
  shareOf,
  sparkline,
  statusOf,
  sumLedgers,
  turnDelta,
  weatherFor,
} from './weather'
import type { AgentEntry, Anchor, ModelLedger, Spend } from './weather'

const EMPTY: Weather = {
  tokens: null,
  window: 0,
  isEstimate: false,
  history: [],
  lastDelta: null,
  lastDeltaCompacted: false,
  turnStartTokens: null,
  compacted: false,
  limits: [],
  limitsAsOf: null,
  turnStartLimits: null,
  lastLimitDelta: {},
  instanceId: '',
  usd: null,
  costFrom: null,
  spent: 0,
  turnStartSpent: null,
  rates: {},
  now: 0,
  model: null,
  effort: null,
  switchedFrom: null,
  switchSeen: false,
  agents: {},
  forks: [],
  agentSpent: 0,
  compactSpent: 0,
  lastCompactSpent: null,
  clearedAt: null,
  modelSpent: { usd: {} },
  modelTotals: { usd: {} },
  turnStartFable: null,
  lastFableDelta: null,
  fableSince: null,
  fableAllowance: null,
  serverAt: 0,
  serverDue: false,
}
const weather = atom({ plugin: 'usage-forecast', key: 'weather' } as const, EMPTY)

// Last live limits, kept across sessions so a new session can show them at once.
const STORE_KEY = 'lastLimits'
type Saved = { limits: Limit[]; at: number }
// Each session's spend under its own key, so no two sessions write one key;
// the learned rates beside them.
const SPEND_PREFIX = 'spend.'
const RATES_KEY = 'rates.v2'
// Rates learned before a /clear's spend was counted: too high, so dropped.
const OLD_RATES_KEY = 'rates'
type SpendEntry = { usd: number; at: number }
type Rates = Record<string, Anchor>
// A session idle this long has stopped: its entry goes.
const SPEND_TTL_MS = 8 * 24 * 60 * 60_000
// Another session's saved reading this fresh is a fair baseline for a turn.
const FRESH_MS = 60_000

// Each session's $ by model family in the parent limit's window, under its
// own key; and when the count began (`models.since`), written once.
const MODELS_PREFIX = 'models.'
const SINCE_KEY = 'models.since'
type ModelEntry = ModelLedger & { at: number }
type Since = { at: number; resetsAt?: string }

// The account has no limits (any more): nothing to show or compare against.
const NO_LIMITS = {
  limits: [],
  limitsAsOf: null,
  turnStartLimits: null,
  lastLimitDelta: {},
  modelSpent: { usd: {} },
  modelTotals: { usd: {} },
  turnStartFable: null,
  lastFableDelta: null,
  fableSince: null,
  fableAllowance: null,
  serverAt: 0,
  serverDue: false,
} satisfies Partial<Weather>

const AGENT_COLOR = '#5fb8b4'
const ICON_COLORS = { running: AGENT_COLOR, done: 'green', failed: 'red', killed: undefined, idle: undefined } as const
// Engine forks seen (compaction, memory), kept so each is looked up once.
const MAX_FORKS = 32

// `startedAt` tells a new cost ledger (a /clear, a resume) from a stale reading.
type Usage = { startedAt?: number; context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

// The id this session's spend is saved under. No session.start follows a
// /clear, so a turn makes one too when the state has none.
const withInstance = (w: Weather): Weather => (w.instanceId ? w : { ...w, instanceId: crypto.randomUUID() })

const copyLimits = (limits: readonly SessionRateLimit[]): Limit[] =>
  limits.map(({ kind, percentUsed, resetsAt }) => (resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt }))

/**
 * A new reading. What it added is booked to the family of `modelId` (the
 * model that answered; the main loop's by default), in the parent limit's
 * window; with no parent (an API key) nothing is booked.
 */
const withUsage = (w: Weather, usage: Usage, now: number, modelId?: string | null): Weather => {
  const next = readUsage(w, usage, now)
  const parent = parentOf(next.limits)
  if (!parent) return next
  const family = familyOf(modelId ?? w.model)
  return { ...next, modelSpent: bookModel(w.modelSpent ?? EMPTY.modelSpent, family, next.spent - w.spent, parent.resetsAt) }
}

const readUsage = (w: Weather, usage: Usage, now: number): Weather => {
  // The last response's reading stays put after its window resets: fresh again.
  const live = reviveLimits(copyLimits(usage.rateLimits), now)
  const ledger = usage.cost ? addSpend(w, usage.cost.usd, usage.startedAt, w.clearedAt) : undefined
  return {
    ...w,
    ...ledger,
    // A /clear's mark is spent once its ledger's first reading is in.
    clearedAt: ledger && ledger.costFrom !== w.costFrom ? null : w.clearedAt,
    window: usage.context.window || w.window,
    // No figure yet keeps what we had: the start estimate, or null after a compaction.
    tokens: usage.context.tokens ?? w.tokens,
    isEstimate: usage.context.tokens === undefined && w.isEstimate,
    // The Fable limit comes from the account's usage answer (askServer), never in a reading: kept.
    limits: live.length > 0 ? [...live, ...w.limits.filter(l => isFableKind(l.kind) && !live.some(x => x.kind === l.kind))] : w.limits,
    limitsAsOf: live.length > 0 ? null : w.limitsAsOf,
    now,
  }
}

/**
 * The main loop now runs `id`. A real change (not an alias gaining its
 * version) notes the model before it, kept from a switch no turn has run
 * on yet; switching back to that one drops the note.
 */
const withModel = (w: Weather, id: string): Weather => {
  const next = fmtModel(id)
  if (next === null) return w
  const prev = w.model === null ? null : fmtModel(w.model)
  // An alias resolving ("opusplan" → "Opus 5.5") is no switch.
  if (prev === null || (isAlias(prev) && !isAlias(next))) return { ...w, model: id }
  // The same model: keep the fuller name ("Opus 5.5" over the alias "Opus").
  if (sameModel(prev, next)) return next.length >= prev.length ? { ...w, model: id } : w
  const from = w.switchedFrom !== null && !w.switchSeen ? w.switchedFrom : prev
  const switched = sameModel(from, next) ? null : from
  // The old effort may not apply to the new model: unknown until its first request.
  return { ...w, model: id, effort: null, switchedFrom: switched, switchSeen: false }
}

async function saveLimits($: EngineInterface, usage: Usage, now: number) {
  const live = copyLimits(usage.rateLimits)
  if (live.length > 0) await $.store.set(STORE_KEY, { limits: live, at: now } satisfies Saved)
}

// Puts this session's spend where the other sessions can count it.
async function saveSpend($: EngineInterface, w: Weather, now: number) {
  if (!w.instanceId) return
  await $.store.set(SPEND_PREFIX + w.instanceId, { usd: w.spent, at: now } satisfies SpendEntry)
  // Its count by model too, while there is a limit to count against.
  if (parentOf(w.limits) && w.modelSpent) {
    await $.store.set(MODELS_PREFIX + w.instanceId, { ...w.modelSpent, at: now } satisfies ModelEntry)
    await countModels($, now)
  }
}

/**
 * Adds up the other sessions' counts of the parent's current window, drops
 * old ones, and notes when the count began (once, the first time anything
 * is booked: "since Thu" shows until that window resets).
 */
async function countModels($: EngineInterface, now: number) {
  try {
    const w = await read($, weather)
    const parent = parentOf(w.limits)
    const others: Record<string, number> = {}
    for (const key of await $.store.keys()) {
      if (!key.startsWith(MODELS_PREFIX) || key === SINCE_KEY) continue
      const entry = (await $.store.get(key)) as ModelEntry | undefined
      if (!entry) continue
      if (now - entry.at > SPEND_TTL_MS) {
        await $.store.delete(key)
        continue
      }
      if (key === MODELS_PREFIX + w.instanceId || parent?.resetsAt === undefined) continue
      for (const [family, usd] of Object.entries(sumLedgers([entry], parent.resetsAt))) others[family] = (others[family] ?? 0) + usd
    }
    let since = (await $.store.get(SINCE_KEY)) as Since | undefined
    const own = sumLedgers([w.modelSpent ?? EMPTY.modelSpent], parent?.resetsAt)
    const booked = [...Object.values(others), ...Object.values(own)].some(n => n > 0)
    if (!since && parent && booked) {
      // A count that began at 0% missed nothing: no "since".
      since = parent.percentUsed > 0 && parent.resetsAt !== undefined ? { at: now, resetsAt: parent.resetsAt } : { at: now }
      await $.store.set(SINCE_KEY, since)
    }
    const fableSince = since?.resetsAt !== undefined && parent && sameWindow(since.resetsAt, parent.resetsAt) ? since.at : null
    const modelTotals: ModelLedger = parent?.resetsAt === undefined ? { usd: {} } : { usd: others, resetsAt: parent.resetsAt }
    await update($, weather, cur => ({ ...cur, modelTotals, fableSince }))
  } catch {
    // The row shows what it had; the next save counts again.
  }
}

// The limits went (an API key, /logout): the counts go with them.
async function dropModels($: EngineInterface) {
  try {
    for (const key of await $.store.keys()) if (key.startsWith(MODELS_PREFIX)) await $.store.delete(key)
  } catch {
    // Dropped after 8 days anyway.
  }
}

// The account's usage answer: what /usage and claude.ai read. Claude Code passes a mod no Fable limit, but its
// answer holds one. Asked with the session's own login, at most once a minute.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?skip_spend=1'
const SERVER_EVERY_MS = 60_000

/**
 * Puts the real Fable limit beside the others, or takes it away when the
 * answer lists none; an answer of another shape, or none at all (no login,
 * a gateway, traffic switched off), leaves things as they are: the row
 * falls back to the mod's own count.
 */
async function askServer($: EngineInterface) {
  try {
    const now = await $.clock.now()
    if (now - ((await read($, weather)).serverAt ?? 0) < SERVER_EVERY_MS) return
    await update($, weather, cur => ({ ...cur, serverAt: now, serverDue: false }))
    const auth = await $.session.authorize()
    if (auth?.kind !== 'bearer') return
    const res = await $.http.fetch(USAGE_URL, { headers: { 'Content-Type': 'application/json' }, auth: auth.handle })
    if (!res.ok) return
    const fable = serverFable(res.text)
    if (!fable) return
    await update($, weather, cur => ({
      ...cur,
      limits: [...cur.limits.filter(l => !isFableKind(l.kind)), ...(fable.limit ? reviveLimits([fable.limit], now) : [])],
      fableAllowance: fable.allowance ?? null,
    }))
  } catch {
    // The count stands in until the next answer.
  }
}


const ratesOf = (rates: Rates): Record<string, number> =>
  Object.fromEntries(Object.entries(rates).flatMap(([kind, a]) => (a.rate === null ? [] : [[kind, a.rate]])))

/**
 * Learns each window's % per dollar from a live reading and every session's
 * spend, and hands back the rates; with no reading, the rates as they stand.
 */
async function learn($: EngineInterface, live: readonly Limit[], now: number): Promise<Record<string, number>> {
  const rates = ((await $.store.get(RATES_KEY)) ?? {}) as Rates
  if (live.length === 0) return ratesOf(rates)

  const spend: Spend = {}
  for (const key of await $.store.keys()) {
    if (key === OLD_RATES_KEY) await $.store.delete(key)
    if (!key.startsWith(SPEND_PREFIX)) continue
    const entry = (await $.store.get(key)) as SpendEntry | undefined
    if (!entry) continue
    if (now - entry.at > SPEND_TTL_MS) await $.store.delete(key)
    else spend[key.slice(SPEND_PREFIX.length)] = entry.usd
  }
  const next: Rates = { ...rates }
  for (const limit of live) next[limit.kind] = learnRate(rates[limit.kind], limit, spend)
  if (JSON.stringify(next) !== JSON.stringify(rates)) await $.store.set(RATES_KEY, next)
  return ratesOf(next)
}

/**
 * What a reading added goes to the loop whose response it followed: an
 * agent's, or yours (the main loop, and the engine's own forks).
 */
const credit = (w: Weather, loop: string | undefined, usd: number): Weather => {
  const agent = loop === undefined ? undefined : w.agents[loop]
  if (!agent || usd <= 0) return w
  return { ...w, agentSpent: w.agentSpent + usd, agents: { ...w.agents, [loop!]: { ...agent, spent: agent.spent + usd } } }
}

const nextOrder = (w: Weather) => Math.max(0, ...Object.values(w.agents).map(a => a.order)) + 1

const withAgent = (w: Weather, id: string, patch: Partial<Agent>): Weather => {
  const agent = w.agents[id]
  return agent ? { ...w, agents: { ...w.agents, [id]: { ...agent, ...patch } } } : w
}

/**
 * Makes sure a loop id is known: an agent the spawn hook missed is filled in
 * from the agent list; one no list names is an engine fork, counted as yours.
 */
async function ensureLoop($: EngineInterface, id: string) {
  const w = await read($, weather)
  if (w.agents[id] || w.forks.includes(id)) return
  const info = (await $.agent.list().catch(() => [])).find(a => a.id === id)
  const now = await $.clock.now()
  await update($, weather, cur => {
    if (cur.agents[id] || cur.forks.includes(id)) return cur
    if (!info) return { ...cur, forks: [...cur.forks, id].slice(-MAX_FORKS) }
    const isTeammate = info.teammateId !== undefined
    const agent: Agent = {
      type: isTeammate ? (info.name ?? 'teammate') : info.type,
      description: info.description,
      model: null,
      effort: null,
      status: statusOf(info.status),
      spent: 0,
      background: false,
      teammate: isTeammate,
      parentId: info.parentId ?? null,
      workflow: null,
      compacted: false,
      startedAt: now,
      endedAt: null,
      order: nextOrder(cur),
    }
    return { ...cur, agents: { ...cur.agents, [id]: agent } }
  })
}

async function applyUsage($: EngineInterface, usage: Usage, persist: boolean, loop?: string, modelId?: string | null) {
  try {
    const now = await $.clock.now()
    let before = 0
    const w = await update($, weather, cur => {
      before = cur.spent
      // An engine fork (no agent by that id) runs for the main loop: its model.
      const next = withUsage(cur, usage, now, loop === undefined || cur.agents[loop] ? modelId : undefined)
      return credit(next, loop, next.spent - cur.spent)
    })
    if (persist || w.spent !== before) await saveSpend($, w, now)
    if (persist) {
      await saveLimits($, usage, now)
      const rates = await learn($, copyLimits(usage.rateLimits), now)
      await update($, weather, cur => ({ ...cur, rates }))
    }
  } catch {
    // A failed refresh only skips one reading; never disturb the event.
  }
}

// A compaction finished: an agent's marks it, yours blanks the fill and notes what it cost.
async function noteCompaction($: EngineInterface, agentId: string | undefined, isMain: boolean, before: Weather | undefined) {
  if (agentId !== undefined) {
    // An agent compacted its own transcript: yours is untouched.
    await update($, weather, w => withAgent(w, agentId, { compacted: true }))
  } else if (isMain) {
    const usage = await $.session.usage().catch(() => undefined)
    const now = await $.clock.now()
    await update($, weather, cur => {
      const w = usage ? withUsage(cur, usage, now) : cur
      // Its requests run as an unnamed fork, counted as yours: what yours grew by.
      const cost = before ? Math.max(0, w.spent - w.agentSpent - (before.spent - before.agentSpent)) : 0
      // The fill is unknown until the next response reports it.
      return { ...w, tokens: null, isEstimate: false, compacted: true, compactSpent: w.compactSpent + cost }
    })
  }
}

// Each limit's change over the turn ending now, this session's share where a
// rate is known; with no baseline and no rate, the last figures stay. Not the
// Fable limit's: it is read between turns, so it never moves within one.
const lastDeltas = (w: Weather): Record<string, number> => {
  const spent = w.turnStartSpent === null ? null : w.spent - w.turnStartSpent
  const deltas = Object.fromEntries(
    w.limits.flatMap(l => {
      if (isFableKind(l.kind)) return []
      const d = turnDelta(l.percentUsed, w.turnStartLimits?.[l.kind], spent, w.rates[l.kind])
      return d === undefined ? [] : [[l.kind, d]]
    }),
  )
  return Object.keys(deltas).length > 0 ? deltas : w.lastLimitDelta
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    // Shows a window whose reset time has passed as fresh, live or saved,
    // until the next reading.
    // Other sessions' Fable counts, and "since" going at the reset, follow;
    // then the account's answer, for a turn that ended too soon after the last.
    $.clock.every(60_000, () => {
      void $.clock
        .now()
        .then(async at => {
          await update($, weather, cur => ({ ...cur, limits: reviveLimits(cur.limits, at), now: at }))
          await countModels($, at)
          if ((await read($, weather)).serverDue) await askServer($)
        })
        .catch(() => {})
    })

    try {
      // A hot reload over state saved by an older version: its new fields start empty.
      await update($, weather, cur => ({ ...EMPTY, ...cur }))
      const now = await $.clock.now()
      const w = await update($, weather, withInstance)
      // A hot reload fires session.start again: keep what this session measured.
      if (w.window === 0) {
        // Counted as /context counts it; the local estimate if that fails.
        const usage = await $.session
          .usage({ breakdown: 'full' })
          .catch(() => $.session.usage({ breakdown: 'summary' }))
          .catch(() => $.session.usage())
        const estimate = usage.context.breakdown?.totalTokens
        const saved = (await $.store.get(STORE_KEY)) as Saved | undefined
        const live = copyLimits(usage.rateLimits)
        const rates = await learn($, [], now).catch(() => ({}))
        await update($, weather, cur => ({
          ...cur,
          ...(usage.cost ? addSpend(cur, usage.cost.usd, usage.startedAt) : {}),
          rates,
          window: usage.context.window,
          tokens: usage.context.tokens ?? estimate ?? null,
          isEstimate: usage.context.tokens === undefined && estimate !== undefined,
          limits: live.length > 0 ? live : saved ? reviveLimits(saved.limits, now) : [],
          limitsAsOf: live.length > 0 || !saved ? null : saved.at,
          now,
        }))
      }
    } catch {
      // No first reading: the band fills in from the first response.
    }
    // The real Fable figure, else the saved Fable counts, show at once.
    await askServer($)
    await countModels($, await $.clock.now().catch(() => 0))

    // Outside the gate above, so a hot reload of an older state fills it too.
    try {
      if ((await read($, weather)).model === null) {
        const model = await $.session.model()
        await update($, weather, cur => (cur.model === null ? withModel(cur, model) : cur))
      }
    } catch {
      // No name yet: the first request names it.
    }
    return result
  })

  // A turn begins: the main loop's, or an agent's run (a teammate's wake too).
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      // An agent's run is its own: your turn's counters stay as they are.
      try {
        const id = e.agentId
        await ensureLoop($, id)
        await update($, weather, cur => withAgent(cur, id, { status: 'running', endedAt: null }))
      } catch {
        // Listed at its first reply instead.
      }
      return next(e)
    }
    try {
      const now = await $.clock.now()
      const usage = await $.session.usage().catch(() => undefined)
      const saved = (await $.store.get(STORE_KEY).catch(() => undefined)) as Saved | undefined
      const fresh = saved && now - saved.at < FRESH_MS ? saved : undefined
      const rates = await learn($, [], now).catch(() => undefined)
      await update($, weather, cur => {
        const w = withInstance(usage ? withUsage(cur, usage, now) : cur)
        // Limits from an earlier session are not a fair baseline; another
        // session's reading from just now is.
        const base = w.limitsAsOf === null ? w.limits : fresh?.limits
        return {
          ...w,
          rates: rates ?? w.rates,
          turnStartTokens: w.tokens,
          turnStartSpent: w.spent,
          turnStartFable: w.modelSpent?.usd[FABLE] ?? 0,
          turnStartLimits: base ? Object.fromEntries(base.map(l => [l.kind, l.percentUsed])) : null,
          // Finished agents were shown through the turn after: they go now.
          agents: Object.fromEntries(Object.entries(w.agents).filter(([, a]) => a.status === 'running' || a.status === 'idle')),
          // A turn on the new model has begun: its end clears the switch note.
          switchSeen: w.switchedFrom !== null ? true : w.switchSeen,
        }
      })
    } catch {
      // Without a baseline this turn just shows no change.
    }
    return next(e)
  })

  // An agent starts: its type, task and where it runs, for the agents line.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    try {
      const id = result.agentId
      if (id !== undefined) {
        const now = await $.clock.now()
        await update($, weather, cur => {
          const prev = cur.agents[id]
          const isTeammate = e.isTeammate === true
          const agent: Agent = {
            type: e.workflow ? 'workflow' : isTeammate ? (result.teammateId?.split('@')[0] ?? e.name ?? 'teammate') : e.subagentType,
            description: e.description,
            model: result.model ?? prev?.model ?? null,
            effort: prev?.effort ?? null,
            status: 'running',
            spent: prev?.spent ?? 0,
            background: e.background === true,
            teammate: isTeammate,
            parentId: e.parentAgentId ?? null,
            workflow: e.workflow?.runId ?? null,
            compacted: false,
            startedAt: prev?.startedAt ?? now,
            endedAt: null,
            order: prev?.order ?? nextOrder(cur),
          }
          return { ...cur, agents: { ...cur.agents, [id]: agent }, forks: cur.forks.filter(f => f !== id) }
        })
      }
    } catch {
      // Listed from the agent list at its first reply instead.
    }
    return result
  })

  // Live: every model response, mid-turn included, refreshes the figures.
  on('turn.step', async function* ($, e, next) {
    const effort = typeof e.effort === 'string' ? e.effort : typeof e.effort === 'number' ? String(e.effort) : null
    // The main loop's model and effort as sent; a subagent's are its own.
    if (e.agentId === undefined) {
      try {
        await update($, weather, cur => ({ ...withModel(cur, e.model), effort }))
      } catch {
        // The name stays as it was until the next request.
      }
    }
    const result = yield* next(e)
    try {
      // The model that answered: a fallback's, where it fell back.
      const model = result?.usage?.model ?? e.model
      if (e.agentId !== undefined) {
        const id = e.agentId
        await ensureLoop($, id)
        await update($, weather, cur => withAgent(cur, id, { model, effort }))
      }
      // This response's cost goes to the loop that asked for it, and to its model.
      await applyUsage($, await $.session.usage(), false, e.agentId, model)
    } catch {
      // A failed read only skips one refresh; never disturb the turn.
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      // An agent's run ended: finished, failed, stopped, or a teammate gone idle.
      try {
        const id = e.agentId
        await ensureLoop($, id)
        const usage = await $.session.usage().catch(() => undefined)
        const model = e.usage?.model ?? (await read($, weather)).agents[id]?.model
        if (usage) await applyUsage($, usage, false, id, model)
        const now = await $.clock.now()
        await update($, weather, cur => {
          const agent = cur.agents[id]
          if (!agent) return cur
          return withAgent(cur, id, { status: endStatus(e.reason, agent.teammate), endedAt: now, model: e.usage?.model ?? agent.model })
        })
      } catch {
        // It stays as last seen.
      }
      return result
    }

    try {
      const usage = await $.session.usage().catch(() => undefined)
      const now = await $.clock.now()
      // Ended before any response (Esc at once, an API error): not a turn to count.
      const counts = e.reason === 'answer' || e.usage !== undefined
      const spending = usage ? withUsage(await read($, weather), usage, now) : undefined
      if (spending) await saveSpend($, spending, now)
      const rates = await learn($, usage ? copyLimits(usage.rateLimits) : [], now).catch(() => undefined)
      await update($, weather, cur => {
        const w = { ...(usage ? withUsage(cur, usage, now) : cur), rates: rates ?? cur.rates }
        const ended = {
          ...w,
          turnStartLimits: null,
          turnStartTokens: null,
          turnStartSpent: null,
          turnStartFable: null,
        }
        if (!counts) return ended

        // Fable's part of the parent's change; with none to tell, the last figure stays.
        const parent = parentOf(w.limits)
        const turnSpent = w.turnStartSpent === null ? null : w.spent - w.turnStartSpent
        const parentDelta = parent && turnDelta(parent.percentUsed, w.turnStartLimits?.[parent.kind], turnSpent, w.rates[parent.kind])
        const fableDelta = parent && fableTurn(fableTurnUsd(w), turnSpent ?? 0, parentDelta, w.rates[parent.kind])

        const tokens = usage?.context.tokens
        const last = w.history.at(-1)
        const before = last ?? w.turnStartTokens
        const measured = tokens !== undefined && before !== null
        return {
          ...ended,
          history: tokens === undefined ? w.history : pushHistory(w.history, tokens),
          lastDelta: measured ? tokens - before : w.lastDelta,
          lastDeltaCompacted: measured ? w.compacted : w.lastDeltaCompacted,
          lastCompactSpent: measured ? (w.compacted ? w.compactSpent : null) : w.lastCompactSpent,
          compactSpent: measured ? 0 : w.compactSpent,
          compacted: measured ? false : w.compacted,
          lastLimitDelta: lastDeltas(w),
          lastFableDelta: fableDelta ?? w.lastFableDelta,
          // Its Fable use is not in the account's figure yet: asked below, or by the minute timer.
          serverDue: true,
          // A whole turn ran on the new model: the switch note has been read.
          ...(w.switchSeen ? { switchedFrom: null, switchSeen: false } : {}),
        }
      })
      if (usage) await saveLimits($, usage, now)
      await askServer($)
    } catch {
      // A failed reading leaves the band as it was; the turn itself is done.
    }
    return result
  })

  // /model, the picker, a fallback: the band shows the new model at once.
  on('classic.PostModelSwitch', async ($, e, next) => {
    if (e.agent_id === undefined) await update($, weather, w => withModel(w, e.to_model))
    return next(e)
    // Only observes: a failure here must never block the switch.
  }).catch(($, e, next) => next(e))

  // Pushed after each main turn and whenever a limit moves a whole point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length === 0) {
      // The limits left (an API key now, say): stop showing the last ones.
      try {
        await update($, weather, w => ({ ...w, ...NO_LIMITS }))
        await $.store.delete(STORE_KEY)
        await dropModels($)
      } catch {
        // Shown again at the next reading.
      }
    }
    // Its cost carries no ledger start, so a stale one can't be told from a
    // /clear: spend is read where `$.session.usage()` gives one.
    await applyUsage($, { context: e.context, rateLimits: e.rateLimits }, true)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    // Your own spend before it, so the compaction's cost can be told apart.
    // A precompute only prepares a summary: the conversation is unchanged.
    const isMain = e.agentId === undefined && e.trigger !== 'precompute'
    const before = isMain ? await read($, weather).catch(() => undefined) : undefined
    const result = await next(e)
    if (result.skip !== undefined) return result
    try {
      await noteCompaction($, e.agentId, isMain, before)
    } catch {
      // The reading stays as it was; the compaction itself is done.
    }
    return result
    // Only observes: a failure here must never block or alter the compaction.
  }).catch(($, e, next) => next(e))


  // /clear and /resume switch conversations with no session.start: drop the old
  // turns, keep the window and the limits with their last-turn change (they
  // belong to the account), and the agents still running. /logout drops the
  // limits too.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      const now = await $.clock.now()
      await update($, weather, w => ({
        ...EMPTY,
        window: w.window,
        limits: w.limits,
        limitsAsOf: w.limitsAsOf,
        lastLimitDelta: w.lastLimitDelta,
        instanceId: w.instanceId,
        usd: w.usd,
        costFrom: w.costFrom,
        spent: w.spent,
        rates: w.rates,
        now: w.now,
        model: w.model,
        effort: w.effort,
        switchedFrom: w.switchedFrom,
        switchSeen: w.switchSeen,
        // A background agent or a teammate outlives the conversation it began in.
        agents: Object.fromEntries(Object.entries(w.agents).filter(([, a]) => a.status === 'running' || a.status === 'idle')),
        forks: w.forks,
        agentSpent: w.agentSpent,
        // The Fable count belongs to the week, not to one conversation.
        modelSpent: w.modelSpent,
        modelTotals: w.modelTotals,
        lastFableDelta: w.lastFableDelta,
        fableSince: w.fableSince,
        fableAllowance: w.fableAllowance,
        serverAt: w.serverAt,
        serverDue: w.serverDue,
        // A /clear's new ledger starts at 0: its first reading counts in full.
        clearedAt: e.reason === 'clear' ? now : null,
      }))
    } else if (e.reason === 'logout') {
      await update($, weather, w => ({ ...w, ...NO_LIMITS }))
      await $.store.delete(STORE_KEY)
      await dropModels($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const w = await read($, weather)
    // Loose checks: state from an older version may lack these until session.start fills them.
    const name = w.model == null ? null : fmtModel(w.model)
    if (w.window === 0 && w.limits.length === 0 && name === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const working = e.props.isWorking
    const agents = w.agents ?? {}
    const entries = agentEntries(agents)
    const viewId = e.props.view?.agentId
    const viewed = viewId === undefined ? undefined : entries.find(x => x.ids.includes(viewId))

    // The running turn's spend.
    const turnSpent = w.turnStartSpent == null ? 0 : w.spent - w.turnStartSpent
    // A Session share for each agent: its spend at the learned rate, or at
    // this turn's own rate before one is learned.
    const session = w.limits.find(l => l.kind === 'five_hour')
    const sessionThis = session ? thisDeltaOf(w, working, session) : undefined
    const sessionRate =
      w.rates.five_hour ?? (sessionThis !== undefined && sessionThis > 0 && turnSpent > 0 ? sessionThis / turnSpent : undefined)

    // Lines 2–5: usage limits, /usage-style bars, saved readings from an
    // earlier session included (rows.ts).
    const rows = limitRows(w, e.props.bodyColumns, working).map((pieces, i) => (
      <Text key={`l${i}`} wrap="truncate">
        {pieces.map((p, j) => (
          <Text key={`p${j}`} color={p.color} backgroundColor={p.bg} bold={p.bold} dimColor={p.dim}>
            {p.text}
          </Text>
        ))}
      </Text>
    ))

    // The agents: one line, or one row each while you view one of them. With
    // no room left above the prompt, a chip on line 1 instead.
    const room = e.props.maxRows - 1 - rows.length
    const isChip = entries.length > 0 && room <= 0
    const shareText = (x: AgentEntry) => {
      // Nothing yet (no reply in, or no rate to tell): no figure.
      const share = shareOf(x.spent, sessionRate)
      return share ? ` +${fmtPct(share)}%` : ''
    }
    const label = (x: AgentEntry) => {
      const model = x.model === null ? null : fmtModel(x.model)
      return `${x.type}${model ? '·' + model : ''}${x.effort ? ' ' + x.effort : ''}`
    }
    const timeOf = (x: AgentEntry) =>
      x.status === 'running'
        ? fmtLeft(w.now - x.startedAt)
        : x.status === 'done'
          ? `done in ${fmtLeft((x.endedAt ?? w.now) - x.startedAt)}`
          : x.status === 'failed'
            ? 'failed'
            : x.status === 'killed'
              ? 'stopped'
              : 'waiting'
    let agentLines: ReturnType<typeof Text>[] = []
    if (entries.length > 0 && !isChip) {
      const running = entries.filter(x => x.status === 'running').length
      if (viewed && room >= 2) {
        const total = shareOf(entries.reduce((n, x) => n + x.spent, 0), sessionRate)
        const shown = entries.length > room - 1 ? entries.slice(0, Math.max(0, room - 2)) : entries
        agentLines = [
          <Text key="ah" wrap="truncate">
            <Text color={AGENT_COLOR} bold>
              ⑂ Agents
            </Text>
            <Text dimColor>{`  ${running} running · ${entries.length - running} done`}</Text>
            {!!total && <Text color={AGENT_COLOR}>{` · +${fmtPct(total)}% of Session`}</Text>}
          </Text>,
          ...shown.map((x, i) => {
            const isViewed = x === viewed
            const desc = x.description.length > 28 ? x.description.slice(0, 27) + '…' : x.description
            return (
              <Text key={`ar${i}`} wrap="truncate" bold={isViewed}>
                <Text dimColor>{isViewed ? ' ▸ ' : '   '}</Text>
                <Text color={ICON_COLORS[x.status]} dimColor={ICON_COLORS[x.status] === undefined}>
                  {AGENT_ICONS[x.status]}{' '}
                </Text>
                <Text dimColor={x.status === 'killed'}>{((x.isChild ? '└ ' : '') + x.type).padEnd(17)}</Text>
                <Text dimColor>{(desc ? `"${desc}"` : '').padEnd(31)}</Text>
                <Text color={MODEL_COLOR}>{((x.model && fmtModel(x.model)) ?? '').padEnd(11)}</Text>
                <Text dimColor>{(x.effort ?? '—').padEnd(7)}</Text>
                <Text color={AGENT_COLOR}>{shareText(x).trim().padStart(6)}</Text>
                <Text dimColor>{`  ${timeOf(x)}${x.compacted ? '  ⟲ compacted' : ''}`}</Text>
              </Text>
            )
          }),
          ...(shown.length < entries.length
            ? [
                <Text key="am" dimColor>
                  {`   +${entries.length - shown.length} more`}
                </Text>,
              ]
            : []),
        ]
      } else {
        const isBackground = entries.every(x => x.background && x.status === 'running')
        const head = `⑂ ${entries.length} agent${entries.length === 1 ? '' : 's'}`
        const extra = isBackground ? ' in background' : running > 0 && running < entries.length ? ` (${running} running)` : ''
        const items = entries.map(x => ({ x, name: label(x), share: shareText(x) }))
        const fits = fitItems(
          head.length + extra.length,
          items.map(it => 4 + it.name.length + (it.x.compacted ? 2 : 0) + it.share.length),
          e.props.bodyColumns,
        )
        agentLines = [
          <Text key="al" wrap="truncate">
            <Text color={AGENT_COLOR} bold>
              {head}
            </Text>
            <Text color={isBackground ? AGENT_COLOR : undefined} dimColor={!isBackground}>
              {extra}
            </Text>
            {items.slice(0, fits).map(({ x, name, share }, i) => (
              <Text key={`ai${i}`} bold={x === viewed}>
                <Text dimColor>{x === viewed ? ' ▸' : '  '}</Text>
                <Text color={ICON_COLORS[x.status]} dimColor={ICON_COLORS[x.status] === undefined}>
                  {AGENT_ICONS[x.status]}{' '}
                </Text>
                <Text dimColor={x.status === 'killed'}>{name}</Text>
                {x.compacted && <Text color={AGENT_COLOR}> ⟲</Text>}
                {share && <Text color={AGENT_COLOR}>{share}</Text>}
              </Text>
            ))}
            {fits < items.length && <Text dimColor>{`  +${items.length - fits} more`}</Text>}
          </Text>,
        ]
      }
    }

    // Line 1 opens with the model, so a narrow terminal's cut never hides it.
    const model = name && (
      <Text color={MODEL_COLOR}>
        <Text bold>◆ {name}</Text>
        {w.effort && <Text>{` ${w.effort}`}</Text>}
      </Text>
    )
    const chip = isChip && <Text color={AGENT_COLOR}>{`${model ? '  ' : ''}⑂ ${entries.length}`}</Text>

    // Line 1: the context window.
    const known = w.tokens !== null
    const pct = known ? percentOf(w.tokens!, w.window) : 0
    const level = weatherFor(pct)
    const bars = sparkline(w.history, w.window)
    let tail = null
    // For one turn after a model change, that says more than any figure.
    if (w.switchedFrom != null) tail = <Text color={MODEL_COLOR}>↻ switched from {w.switchedFrom}</Text>
    // Unknown until the next response: right after a compaction, a /clear or a /resume.
    else if (!known) tail = <Text dimColor>measuring…</Text>
    else if (w.isEstimate) tail = <Text dimColor>waiting for first reply</Text>
    else if (w.lastDelta !== null) {
      if (w.lastDelta < 0 && w.lastDeltaCompacted) {
        // What the compaction itself cost, as a share of the Session bar.
        const cost = w.lastCompactSpent == null ? null : shareOf(w.lastCompactSpent, w.rates.five_hour)
        tail = (
          <Text color="green">
            ▼ −{fmtTokens(-w.lastDelta)} compacted{cost ? ` · +${fmtPct(cost)}%` : ''}
          </Text>
        )
      } else if (w.lastDelta < 0) tail = <Text dimColor>▼ −{fmtTokens(-w.lastDelta)} last turn</Text>
      else
        tail = (
          <Text color={w.lastDelta > w.window * 0.2 ? 'red' : undefined} dimColor={w.lastDelta <= w.window * 0.2}>
            ▲ +{fmtTokens(w.lastDelta)} last turn
          </Text>
        )
    }

    const context =
      w.window === 0 ? (
        (model || chip) && (
          <Text wrap="truncate">
            {model}
            {chip}
          </Text>
        )
      ) : (
        <Text wrap="truncate">
          {model}
          {chip}
          {(model || chip) && <Text dimColor>{'  │  '}</Text>}
          <Text color={level.color} bold>
            {level.icon} {level.word}
          </Text>
          <Text color={level.color}>
            {'  '}
            {known ? `${pct}%` : '—%'}
          </Text>
          <Text>
            {'  '}
            {known ? fmtTokens(w.tokens!) : '—'} / {fmtTokens(w.window)}
            {'  '}
          </Text>
          {bars.map((bar, i) => (
            <Text key={`b${i}`} color={bar.color}>
              {bar.ch}
            </Text>
          ))}
          <Text dimColor>{'·'.repeat(HISTORY - bars.length)}</Text>
          {tail && <Text>{'  '}</Text>}
          {tail}
        </Text>
      )

    return (
      <Box flexDirection="column">
        {context}
        {agentLines}
        {rows}
      </Box>
    )
  })
}
