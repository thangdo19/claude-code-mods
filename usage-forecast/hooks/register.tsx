import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Limit, Weather } from '../types'
import {
  addSpend,
  fmtLeft,
  fmtLimitDelta,
  fmtModel,
  fmtPct,
  fmtReset,
  fmtTokens,
  HOT_PCT,
  isAlias,
  LIMIT_LABELS,
  percentOf,
  pushHistory,
  reviveLimits,
  sameModel,
  sparkline,
  usageCells,
  weatherFor,
  learnRate,
  turnDelta,
  HISTORY,
} from './weather'
import type { Anchor, Spend } from './weather'

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

// The account has no limits (any more): nothing to show or compare against.
const NO_LIMITS = { limits: [], limitsAsOf: null, turnStartLimits: null, lastLimitDelta: {} } satisfies Partial<Weather>

const TRACK = '#4a2e25'
const LABEL_WIDTH = 9
const MODEL_COLOR = 'permission'

// `startedAt` tells a new cost ledger (a /clear, a resume) from a stale reading.
type Usage = { startedAt?: number; context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

// The id this session's spend is saved under. No session.start follows a
// /clear, so a turn makes one too when the state has none.
const withInstance = (w: Weather): Weather => (w.instanceId ? w : { ...w, instanceId: crypto.randomUUID() })

const copyLimits = (limits: readonly SessionRateLimit[]): Limit[] =>
  limits.map(({ kind, percentUsed, resetsAt }) => (resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt }))

const withUsage = (w: Weather, usage: Usage, now: number): Weather => {
  // The last response's reading stays put after its window resets: fresh again.
  const live = reviveLimits(copyLimits(usage.rateLimits), now)
  return {
    ...w,
    ...(usage.cost ? addSpend(w, usage.cost.usd, usage.startedAt) : {}),
    window: usage.context.window || w.window,
    // No figure yet keeps what we had: the start estimate, or null after a compaction.
    tokens: usage.context.tokens ?? w.tokens,
    isEstimate: usage.context.tokens === undefined && w.isEstimate,
    limits: live.length > 0 ? live : w.limits,
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
  if (w.instanceId) await $.store.set(SPEND_PREFIX + w.instanceId, { usd: w.spent, at: now } satisfies SpendEntry)
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

async function applyUsage($: EngineInterface, usage: Usage, persist: boolean) {
  try {
    const now = await $.clock.now()
    let before = 0
    const w = await update($, weather, cur => {
      before = cur.spent
      return withUsage(cur, usage, now)
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

// Each limit's change over the turn ending now, this session's share where a
// rate is known; with no baseline and no rate, the last figures stay.
const lastDeltas = (w: Weather): Record<string, number> => {
  const spent = w.turnStartSpent === null ? null : w.spent - w.turnStartSpent
  const deltas = Object.fromEntries(
    w.limits.flatMap(l => {
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
    $.clock.every(60_000, () => {
      void $.clock
        .now()
        .then(at => update($, weather, cur => ({ ...cur, limits: reviveLimits(cur.limits, at), now: at })))
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

  // A main-loop turn begins (a subagent's run raises none).
  on('turn.start', async ($, e, next) => {
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
          turnStartLimits: base ? Object.fromEntries(base.map(l => [l.kind, l.percentUsed])) : null,
          // A turn on the new model has begun: its end clears the switch note.
          switchSeen: w.switchedFrom !== null && e.agentId === undefined ? true : w.switchSeen,
        }
      })
    } catch {
      // Without a baseline this turn just shows no change.
    }
    return next(e)
  })

  // Live: every model response, mid-turn included, refreshes the figures.
  on('turn.step', async function* ($, e, next) {
    // The main loop's model and effort as sent; a subagent's are its own.
    if (e.agentId === undefined) {
      try {
        const effort = typeof e.effort === 'string' ? e.effort : null
        await update($, weather, cur => ({ ...withModel(cur, e.model), effort }))
      } catch {
        // The name stays as it was until the next request.
      }
    }
    const result = yield* next(e)
    try {
      await applyUsage($, await $.session.usage(), false)
    } catch {
      // A failed read only skips one refresh; never disturb the turn.
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

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
        const ended = { ...w, turnStartLimits: null, turnStartTokens: null, turnStartSpent: null }
        if (!counts) return ended

        const tokens = usage?.context.tokens
        const last = w.history.at(-1)
        const before = last ?? w.turnStartTokens
        const measured = tokens !== undefined && before !== null
        return {
          ...ended,
          history: tokens === undefined ? w.history : pushHistory(w.history, tokens),
          lastDelta: measured ? tokens - before : w.lastDelta,
          lastDeltaCompacted: measured ? w.compacted : w.lastDeltaCompacted,
          compacted: measured ? false : w.compacted,
          lastLimitDelta: lastDeltas(w),
          // A whole turn ran on the new model: the switch note has been read.
          ...(w.switchSeen ? { switchedFrom: null, switchSeen: false } : {}),
        }
      })
      if (usage) await saveLimits($, usage, now)
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
    const result = await next(e)
    // A precompute only prepares a summary: the conversation is unchanged.
    if (e.trigger !== 'precompute' && result.skip === undefined) {
      // The fill is unknown until the next response reports it.
      await update($, weather, w => ({ ...w, tokens: null, isEstimate: false, compacted: true }))
    }
    return result
    // Only observes: a failure here must never block or alter the compaction.
  }).catch(($, e, next) => next(e))

  // /clear and /resume switch conversations with no session.start: drop the old
  // turns, keep the window and the limits with their last-turn change (they
  // belong to the account). /logout drops the limits too.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
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
      }))
    } else if (e.reason === 'logout') {
      await update($, weather, w => ({ ...w, ...NO_LIMITS }))
      await $.store.delete(STORE_KEY)
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

    // Line 1 opens with the model, so a narrow terminal's cut never hides it.
    const model = name && (
      <Text color={MODEL_COLOR}>
        <Text bold>◆ {name}</Text>
        {w.effort && <Text>{` ${w.effort}`}</Text>}
      </Text>
    )

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
      if (w.lastDelta < 0 && w.lastDeltaCompacted)
        tail = <Text color="green">▼ −{fmtTokens(-w.lastDelta)} compacted</Text>
      else if (w.lastDelta < 0) tail = <Text dimColor>▼ −{fmtTokens(-w.lastDelta)} last turn</Text>
      else
        tail = (
          <Text color={w.lastDelta > w.window * 0.2 ? 'red' : undefined} dimColor={w.lastDelta <= w.window * 0.2}>
            ▲ +{fmtTokens(w.lastDelta)} last turn
          </Text>
        )
    }

    const context =
      w.window === 0 ? (
        model && <Text wrap="truncate">{model}</Text>
      ) : (
        <Text wrap="truncate">
          {model}
          {model && <Text dimColor>{'  │  '}</Text>}
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

    // Lines 2–3: usage limits, /usage-style bars in Claude orange, saved
    // readings from an earlier session included.
    const width = Math.max(10, Math.min(30, e.props.bodyColumns - LABEL_WIDTH - 80))
    const rows = (['five_hour', 'seven_day'] as const).flatMap(kind => {
      const limit = w.limits.find(l => l.kind === kind)
      if (!limit) return []
      // This session's own share of the running turn, the account's change until a rate is learned.
      const thisDelta = working
        ? turnDelta(
            limit.percentUsed,
            w.turnStartLimits?.[kind],
            w.turnStartSpent === null ? null : w.spent - w.turnStartSpent,
            w.rates[kind],
          )
        : undefined
      // Kept while the next turn runs, so the previous answer's cost stays readable.
      const lastDelta = w.lastLimitDelta[kind]
      const thisText = thisDelta === undefined ? '' : fmtLimitDelta(thisDelta, 'this')
      const lastText = lastDelta === undefined ? '' : fmtLimitDelta(lastDelta, 'last')
      // Counted from the last refresh; the minute timer keeps it current.
      const at = limit.resetsAt ? fmtReset(limit.resetsAt, kind === 'seven_day') : ''
      const reset = at ? `in ${fmtLeft(Date.parse(limit.resetsAt!) - w.now)} (${at})` : ''
      // Nearly gone: the bar and its figure turn red, as the context line does.
      const fill = limit.percentUsed >= HOT_PCT ? 'red' : 'claude'
      return [
        <Text key={kind} wrap="truncate">
          <Text color="claude" bold>
            {LIMIT_LABELS[kind].padEnd(LABEL_WIDTH)}
          </Text>
          <Text color={fill} backgroundColor={TRACK}>
            {usageCells(limit.percentUsed, width)}
          </Text>
          <Text color={fill} bold>
            {' '}
            {fmtPct(limit.percentUsed)}%
          </Text>
          {thisText && <Text color="claude">{` ${thisText}`}</Text>}
          {lastText && <Text color="claude">{` ${lastText}`}</Text>}
          <Text dimColor>{reset ? ` · resets ${reset}` : ' · window reset'}</Text>
        </Text>,
      ]
    })

    return (
      <Box flexDirection="column">
        {context}
        {rows}
      </Box>
    )
  })
}
