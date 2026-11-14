// Pure helpers: no engine calls, so tests run them directly.

export type Level = { icon: string; word: string; color: string }

const LEVELS: readonly (Level & { below: number })[] = [
  { below: 25, icon: '☀', word: 'Clear', color: 'yellow' },
  { below: 50, icon: '☁', word: 'Cloudy', color: 'cyan' },
  { below: 75, icon: '☂', word: 'Showers', color: 'blue' },
  { below: 90, icon: '☇', word: 'Storm', color: 'magenta' },
  { below: Infinity, icon: '↯', word: 'Compact soon', color: 'red' },
]

export const weatherFor = (pct: number): Level => {
  const { icon, word, color } = LEVELS.find(level => pct < level.below)!
  return { icon, word, color }
}

export const percentOf = (tokens: number, window: number): number =>
  window > 0 ? Math.round((tokens / window) * 100) : 0

/** 134400 → "134.4k", 200000 → "200k", 1000000 → "1M", 950 → "950". */
export const fmtTokens = (n: number): string => {
  const abs = Math.abs(n)
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '')
  if (abs >= 1e6) return trim(n / 1e6) + 'M'
  if (abs >= 1e3) return trim(n / 1e3) + 'k'
  return String(Math.round(n))
}

/** At most one decimal, no trailing ".0": 4 → "4", 4.25 → "4.3". */
export const fmtPct = (p: number): string => String(Math.round(p * 10) / 10)

export const HISTORY = 12
const SPARK = '▁▂▃▄▅▆▇█'

/** One bar per value, scaled to the window (not the max), colored by its own weather. */
export const sparkline = (values: readonly number[], window: number) =>
  values.slice(-HISTORY).map(v => {
    const pct = window > 0 ? (v / window) * 100 : 0
    const ch = SPARK[Math.max(0, Math.min(7, Math.floor((pct / 100) * 8)))]
    return { ch, color: weatherFor(pct).color }
  })

export const pushHistory = (history: readonly number[], tokens: number): number[] =>
  [...history, tokens].slice(-HISTORY)

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** A /usage-style bar body exactly `width` cells wide, filled from the left in eighths. */
export const usageCells = (pct: number, width: number): string => {
  const cells = (Math.max(0, Math.min(100, pct)) / 100) * width
  const full = Math.floor(cells)
  const part = full < width ? EIGHTHS[Math.floor((cells - full) * 8)] : ''
  return ('█'.repeat(full) + part).padEnd(width, ' ')
}

export const LIMIT_LABELS = { five_hour: 'Session', seven_day: 'Week', spend_limit: 'Spend' } as const

/** A limit used this much draws red. */
export const HOT_PCT = 90

const MODEL_MAX = 24
const family = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)

/**
 * A model id as a short name, any family: "claude-opus-5-5[1m]" → "Opus 5.5",
 * an alias "opus" → "Opus", another id as given (cut to 24); null for none.
 */
export const fmtModel = (id: string): string | null => {
  const raw = id.trim().replace(/\[[^\]]*\]$/, '')
  const lower = raw.toLowerCase()
  if (lower === '' || lower === 'default' || lower === '<synthetic>') return null
  if (/^[a-z]+$/.test(lower)) return family(lower)
  // claude-opus-5-5, claude-opus-4-20250514 (a date is never the minor), us.anthropic.…-v1:0, …@date.
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(lower)
  if (m) return `${family(m[1]!)} ${m[2]}${m[3] ? '.' + m[3] : ''}`
  // The older order: claude-3-5-sonnet-20241022.
  const old = /claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)/.exec(lower)
  if (old) return `${family(old[3]!)} ${old[1]}${old[2] ? '.' + old[2] : ''}`
  const last = raw.split('/').at(-1) || raw
  return last.length > MODEL_MAX ? last.slice(0, MODEL_MAX - 1) + '…' : last
}

/** A name with no version: an alias ("Opus", "Opusplan") the engine has yet to resolve. */
export const isAlias = (name: string): boolean => !/\d/.test(name)

/** The same model, an alias ("Opus") matching its full name ("Opus 5.5") too. */
export const sameModel = (a: string, b: string): boolean =>
  a === b || (isAlias(a) && b.startsWith(a + ' ')) || (isAlias(b) && a.startsWith(b + ' '))

const pad2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** As /usage writes it, in local time: "4:50am", or with the date "Oct 16 at 4am". */
export const fmtReset = (iso: string, withDate: boolean): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = d.getHours()
  const time = `${h % 12 || 12}${d.getMinutes() ? ':' + pad2(d.getMinutes()) : ''}${h < 12 ? 'am' : 'pm'}`
  return withDate ? `${MONTHS[d.getMonth()]} ${d.getDate()} at ${time}` : time
}

/** Time left, two units at most: "5d 3h", "2h 10m", "10m", "<1m". */
export const fmtLeft = (ms: number): string => {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '<1m'
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return h ? `${d}d ${h}h` : `${d}d`
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`
}

/**
 * Limits as they read at `now`: a window whose reset time has passed is
 * fresh again, so it reads 0% with no known reset, marked `isReset`.
 */
export const reviveLimits = <L extends { percentUsed: number; resetsAt?: string; isReset?: boolean }>(limits: readonly L[], now: number): L[] =>
  limits.map(limit =>
    limit.resetsAt !== undefined && Date.parse(limit.resetsAt) <= now
      ? { ...limit, percentUsed: 0, resetsAt: undefined, isReset: true }
      : limit,
  )

/**
 * A limit's change over a turn, as the row writes it: "+1.2% now" for the
 * running turn, "▲ +0.3% last" for the one before. A negative change means
 * its window reset mid-turn. Readings come in whole points, so a finished turn
 * that moved nothing reads "<1%"; a running one shows nothing until it moves.
 */
export const fmtLimitDelta = (delta: number, span: 'this' | 'last'): string => {
  const word = span === 'this' ? 'now' : 'last'
  if (delta < 0) return `↺ reset ${word}`
  if (delta > 0) return `${span === 'last' ? '▲ ' : ''}+${fmtPct(delta)}% ${word}`
  return span === 'last' ? '▲ <1% last' : ''
}

type Ledger = { usd: number | null; spent: number; costFrom: number | null }

const CLEAR_SLACK_MS = 60_000

/**
 * This session's running spend after a new cost reading: `usd` is the
 * session's own total, counted from `startedAt`. A new ledger (a /clear, a
 * resume) or the first reading counts from there; a total lower than one
 * already counted is a stale reading and adds nothing, so `spent` only grows.
 */
export const addSpend = (prev: Ledger, usd: number, startedAt?: number, clearedAt?: number | null): Ledger => {
  const costFrom = startedAt ?? prev.costFrom
  const isNewLedger = startedAt !== undefined && prev.costFrom !== null && startedAt !== prev.costFrom
  if (prev.usd === null || isNewLedger) {
    // A /clear's ledger starts at 0 then: what it holds at its first reading
    // (a background agent's reply, say) was spent here. A resumed session's
    // starts earlier and holds spend from before: a baseline only.
    const isFromClear = isNewLedger && clearedAt != null && startedAt >= clearedAt - CLEAR_SLACK_MS
    return { usd, spent: prev.spent + (isFromClear ? usd : 0), costFrom }
  }
  if (usd <= prev.usd) return { usd: prev.usd, spent: prev.spent, costFrom }
  return { usd, spent: prev.spent + usd - prev.usd, costFrom }
}

/** Every running session's spend, by instance id, as the store holds it. */
export type Spend = Record<string, number>

/** What all sessions spent since `snap`; a session missing from `snap` began after it. */
export const spendSince = (snap: Readonly<Spend>, now: Readonly<Spend>): number =>
  Object.entries(now).reduce((sum, [id, usd]) => sum + Math.max(0, usd - (snap[id] ?? 0)), 0)

/** One window's learned % per dollar, the points it was measured over (`span`), and where its current measurement began. */
export type Anchor = { rate: number | null; pct: number; resetsAt?: string; snap: Spend; span?: number }

const MIN_USD = 1
const MIN_PCT = 2
const SAME_RESET_MS = 30 * 60_000

export const sameWindow = (a: string | undefined, b: string | undefined) =>
  a === b || (a !== undefined && b !== undefined && Math.abs(Date.parse(a) - Date.parse(b)) <= SAME_RESET_MS)

/**
 * Learns how many points of a window one dollar moves, from the account's
 * reading and every session's spend since the window's first reading. A
 * long span keeps the whole-point steps from skewing it. A new window keeps
 * the old rate until its own measurement is as long, or says the old rate
 * can't be right (readings are whole points: the true move is within 1).
 */
export const learnRate = (
  prev: Anchor | undefined,
  limit: { percentUsed: number; resetsAt?: string },
  spend: Readonly<Spend>,
): Anchor => {
  if (!prev || limit.percentUsed < prev.pct || !sameWindow(prev.resetsAt, limit.resetsAt)) {
    const anchor: Anchor = { rate: prev?.rate ?? null, pct: limit.percentUsed, snap: { ...spend } }
    if (prev?.span !== undefined) anchor.span = prev.span
    return limit.resetsAt === undefined ? anchor : { ...anchor, resetsAt: limit.resetsAt }
  }
  const usd = spendSince(prev.snap, spend)
  const pct = limit.percentUsed - prev.pct
  if (usd < MIN_USD || pct < MIN_PCT) return prev
  const stands =
    prev.rate !== null && prev.span !== undefined && prev.span > pct && prev.rate >= (pct - 1) / usd && prev.rate <= (pct + 1) / usd
  return stands ? prev : { ...prev, rate: pct / usd, span: pct }
}

type Reading = { kind: string; percentUsed: number; resetsAt?: string; isReset?: boolean }

/** Two readings of one window: both name a reset time, the same one. */
export const isSameReading = (a: Reading, b: Reading): boolean =>
  a.resetsAt !== undefined && b.resetsAt !== undefined && sameWindow(a.resetsAt, b.resetsAt)

// A newer reading `o` from elsewhere beats `m`: the same window read higher, or a later window.
const takes = (m: Reading, o: Reading, now: number): boolean => {
  if (o.resetsAt === undefined) return m.resetsAt === undefined && !o.isReset && o.percentUsed > m.percentUsed
  if (m.resetsAt === undefined) return Date.parse(o.resetsAt) > now
  return isSameReading(m, o) ? o.percentUsed > m.percentUsed : Date.parse(o.resetsAt) > Date.parse(m.resetsAt)
}

/**
 * `own` limits after a newer reading from elsewhere (another session, the
 * account's own answer). A limit is taken when it reads the same window
 * higher, or a later window; one `own` lacks is added. A window only fills,
 * so a lower figure is never taken. Nothing taken hands back `own` itself.
 */
export const mergeLimits = <L extends Reading>(own: readonly L[], other: readonly L[], now: number): readonly L[] => {
  let isChanged = false
  const out = own.map(m => {
    const o = other.find(x => x.kind === m.kind)
    if (!o || !takes(m, o, now)) return m
    isChanged = true
    return o
  })
  for (const o of other) {
    if (own.some(m => m.kind === o.kind)) continue
    out.push(o)
    isChanged = true
  }
  return isChanged ? out : own
}

/**
 * A limit's change over a turn: this session's own share when a rate is
 * known (at least 0.1 once it spent anything), the account's change
 * otherwise. A window that reset since `startPct` reads negative either way.
 *
 * The share never tops what the account moved (whole-point readings hide
 * up to one more) nor what the window holds: a rate learned while some
 * spend went uncounted (claude.ai, another computer) reads too high.
 */
export const turnDelta = (
  percentUsed: number,
  startPct: number | undefined,
  spent: number | null,
  rate: number | undefined,
): number | undefined => {
  if (startPct !== undefined && percentUsed < startPct) return Math.round((percentUsed - startPct) * 10) / 10
  if (rate !== undefined && spent !== null) {
    if (spent <= 0) return 0
    const cap = startPct === undefined ? percentUsed : Math.min(percentUsed, percentUsed - startPct + 1)
    return Math.round(Math.min(Math.max(0.1, Math.round(spent * rate * 10) / 10), cap) * 10) / 10
  }
  return startPct === undefined ? undefined : Math.round((percentUsed - startPct) * 10) / 10
}

/** Each limit's % change since `start`, one decimal; kinds missing from `start` are left out. */
export const limitDeltas = (
  limits: readonly { kind: string; percentUsed: number }[],
  start: Readonly<Record<string, number>>,
): Record<string, number> =>
  Object.fromEntries(
    limits
      .filter(limit => start[limit.kind] !== undefined)
      .map(limit => [limit.kind, Math.round((limit.percentUsed - (start[limit.kind] ?? 0)) * 10) / 10]),
  )

export const LIMIT_KINDS = ['five_hour', 'seven_day', 'spend_limit'] as const

/** $ as a share of a window, one decimal, at least 0.1 once anything was spent; null with no rate. */
export const shareOf = (usd: number, rate: number | undefined): number | null => {
  if (rate === undefined) return null
  if (usd <= 0) return 0
  return Math.max(0.1, Math.round(usd * rate * 10) / 10)
}

/** An agent loop's state as `$.agent.list()` gives it, in the band's words. */
export const statusOf = (s: string): 'running' | 'done' | 'failed' | 'killed' | 'idle' =>
  s === 'completed' ? 'done' : s === 'failed' ? 'failed' : s === 'killed' ? 'killed' : s === 'idle' ? 'idle' : 'running'

/** How an agent's run ended: a teammate waits for its next message instead of finishing. */
export const endStatus = (reason: string, isTeammate: boolean): 'done' | 'failed' | 'killed' | 'idle' =>
  reason === 'aborted' ? 'killed' : reason === 'answer' ? (isTeammate ? 'idle' : 'done') : 'failed'

export const AGENT_ICONS = { running: '●', done: '✓', failed: '✗', killed: '✗', idle: '⏸' } as const

/** One entry of the agents line: a workflow run's agents fold into one. */
export type AgentEntry = {
  ids: string[]
  type: string
  description: string
  model: string | null
  effort: string | null
  status: keyof typeof AGENT_ICONS
  spent: number
  background: boolean
  compacted: boolean
  isChild: boolean
  startedAt: number
  endedAt: number | null
}

type AgentLike = Omit<AgentEntry, 'ids' | 'isChild'> & { order: number; workflow: string | null; parentId: string | null }

const RANK = { running: 0, idle: 1, failed: 2, killed: 3, done: 4 } as const

/** Agents in spawn order, each child right under its parent, a workflow run as one entry. */
export const agentEntries = (agents: Readonly<Record<string, AgentLike>>): AgentEntry[] => {
  const sorted = Object.entries(agents).sort(([, a], [, b]) => a.order - b.order)
  const entries: AgentEntry[] = []
  const byRun = new Map<string, AgentEntry>()
  for (const [id, a] of sorted) {
    const run = a.workflow === null ? undefined : byRun.get(a.workflow)
    if (run) {
      run.ids.push(id)
      run.spent += a.spent
      run.type = `workflow ×${run.ids.length}`
      if (RANK[a.status] < RANK[run.status]) run.status = a.status
      run.compacted ||= a.compacted
      run.endedAt = run.status === 'running' ? null : Math.max(run.endedAt ?? 0, a.endedAt ?? 0)
      continue
    }
    const entry: AgentEntry = {
      ids: [id], type: a.type, description: a.description, model: a.model, effort: a.effort, status: a.status,
      spent: a.spent, background: a.background, compacted: a.compacted,
      isChild: a.parentId !== null && agents[a.parentId] !== undefined, startedAt: a.startedAt, endedAt: a.endedAt,
    }
    if (a.workflow !== null) byRun.set(a.workflow, entry)
    entries.push(entry)
  }
  // A child sits under its parent.
  const out: AgentEntry[] = []
  const placed = new Set<AgentEntry>()
  const place = (e: AgentEntry) => {
    if (placed.has(e)) return
    placed.add(e)
    out.push(e)
    for (const c of entries) if (c.isChild && e.ids.includes(agents[c.ids[0]!]!.parentId!)) place(c)
  }
  for (const e of entries) if (!e.isChild) place(e)
  for (const e of entries) place(e)
  return out
}

// ---------- the Fable row: each model family's spend, per window ----------

export const FABLE = 'Fable'

/** A model's family, as the counts are kept: "claude-fable-5-2" → "Fable"; "Other" for none. */
export const familyOf = (id: string | null | undefined): string => {
  const name = id == null ? null : fmtModel(id)
  return name === null ? 'Other' : name.split(' ')[0]!
}

/** The long limit the Fable row hangs under: Week, else a gateway's Spend. */
export const parentOf = <L extends { kind: string }>(limits: readonly L[]): L | undefined =>
  limits.find(l => l.kind === 'seven_day') ?? limits.find(l => l.kind === 'spend_limit')

/** A real Fable limit, should Claude Code ever report one. */
export const isFableKind = (kind: string): boolean =>
  /fable/i.test(kind) && !(LIMIT_KINDS as readonly string[]).includes(kind)

/** The real Fable limit, as the mod keeps it beside the others. */
export const FABLE_KIND = 'weekly_fable'

/**
 * A server time as ISO, to the minute (it says 20:59:59.58 for a 21:00 reset):
 * seconds since 1970, or a string (microseconds and "+00:00" included).
 */
const isoOf = (t: unknown): string | undefined => {
  const ms = typeof t === 'number' ? t * 1000 : typeof t === 'string' ? Date.parse(t.replace(/(\.\d{3})\d+/, '$1')) : NaN
  return Number.isNaN(ms) ? undefined : new Date(Math.round(ms / 60_000) * 60_000).toISOString()
}

/**
 * The limits in the account's usage answer (what /usage and claude.ai show),
 * in the mod's kinds: Session and Week where they name a reset time, and the
 * Fable limit (its % of Fable's own allowance) with that allowance as a % of
 * the week. Undefined when the answer has no list of limits (another shape:
 * keep what we have); no Fable limit in the list when it names none.
 */
export const serverLimits = (
  text: string,
): { limits: { kind: string; percentUsed: number; resetsAt?: string }[]; allowance?: number } | undefined => {
  type Entry = { kind?: unknown; percent?: unknown; resets_at?: unknown; scope?: { model?: { display_name?: unknown } } | null }
  type Share = { limit_index?: unknown; allowance_percent_of_weekly?: unknown }
  let body: { limits?: unknown; weekly_scoped_shares?: unknown } | null
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return undefined
  }
  if (!body || !Array.isArray(body.limits)) return undefined
  const entries = body.limits as (Entry | null)[]
  const read = (entry: Entry, kind: string) => {
    const resetsAt = isoOf(entry.resets_at)
    return { kind, percentUsed: entry.percent as number, ...(resetsAt ? { resetsAt } : {}) }
  }
  const limits: { kind: string; percentUsed: number; resetsAt?: string }[] = []
  for (const [theirs, ours] of [['session', 'five_hour'], ['weekly_all', 'seven_day']] as const) {
    const entry = entries.find(l => l?.kind === theirs && typeof l.percent === 'number')
    // With no reset time there is no telling which window it reads.
    if (entry && isoOf(entry.resets_at) !== undefined) limits.push(read(entry, ours))
  }
  const at = entries.findIndex(
    l => l?.kind === 'weekly_scoped' && typeof l.percent === 'number' && /fable/i.test(String(l.scope?.model?.display_name ?? '')),
  )
  if (at < 0) return { limits }
  limits.push(read(entries[at]!, FABLE_KIND))
  const shares = Array.isArray(body.weekly_scoped_shares) ? (body.weekly_scoped_shares as (Share | null)[]) : []
  const allowance = shares.find(s => s?.limit_index === at)?.allowance_percent_of_weekly
  return typeof allowance === 'number' && allowance > 0 ? { limits, allowance } : { limits }
}

/** Week points as a % of Fable's own allowance (a % of the week); a reset (negative) stays as it is. */
export const toAllowance = (pts: number, allowance: number): number =>
  pts < 0 ? pts : Math.min(100, Math.round((pts * 1000) / allowance) / 10)

const HOUR_MS = 60 * 60_000

/** A limit's window length, for its pace; undefined when it has none (Spend). */
export const windowOf = (kind: string): number | undefined =>
  kind.includes('five_hour') ? 5 * HOUR_MS : kind.includes('seven_day') || kind.includes('week') ? 7 * 24 * HOUR_MS : undefined

/** $ each family's replies cost in one window of the parent limit (Week, or a gateway's Spend). */
export type ModelLedger = { usd: Record<string, number>; resetsAt?: string }

/** Books `usd` to a family; a ledger of another window starts over first. */
export const bookModel = (ledger: ModelLedger, family: string, usd: number, resetsAt: string | undefined): ModelLedger => {
  const kept = sameWindow(ledger.resetsAt, resetsAt) ? ledger.usd : {}
  const spent = usd > 0 ? { ...kept, [family]: (kept[family] ?? 0) + usd } : kept
  return resetsAt === undefined ? { usd: spent } : { usd: spent, resetsAt }
}

/** Every ledger of the window that resets at `resetsAt`, added up; none when it has no reset time. */
export const sumLedgers = (ledgers: readonly ModelLedger[], resetsAt: string | undefined): Record<string, number> => {
  const out: Record<string, number> = {}
  if (resetsAt === undefined) return out
  for (const l of ledgers) {
    if (!sameWindow(l.resetsAt, resetsAt)) continue
    for (const [family, usd] of Object.entries(l.usd)) out[family] = (out[family] ?? 0) + usd
  }
  return out
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Fable's points of the parent: $ × rate, or the parent split by $; families scaled to the parent; ≥ 0.1. */
export const fableShare = (usd: Readonly<Record<string, number>>, parentPct: number, rate: number | undefined): number => {
  const fable = usd[FABLE] ?? 0
  if (fable <= 0 || parentPct <= 0) return 0
  const spent = Object.values(usd).filter(n => n > 0)
  const total = spent.reduce((n, x) => n + x, 0)
  const ptsOf = (x: number) => (rate !== undefined ? Math.max(0.1, x * rate) : (parentPct * x) / total)
  const sum = spent.reduce((n, x) => n + ptsOf(x), 0)
  const scale = sum > parentPct ? parentPct / sum : 1
  return Math.min(parentPct, Math.max(0.1, round1(ptsOf(fable) * scale)))
}

/**
 * Fable's part of a turn's parent change; never more than the parent moved;
 * a reset reads negative. A turn with no Fable is 0 even when the parent's
 * change can't be told (undefined otherwise), so no older figure stays.
 */
export const fableTurn = (fableUsd: number, turnUsd: number, parentDelta: number | undefined, rate: number | undefined): number | undefined => {
  if (parentDelta !== undefined && parentDelta < 0) return parentDelta
  if (fableUsd <= 0) return 0
  if (parentDelta === undefined) return undefined
  const pts = rate !== undefined ? Math.max(0.1, round1(fableUsd * rate)) : turnUsd > 0 ? round1((parentDelta * fableUsd) / turnUsd) : 0
  return Math.min(pts, parentDelta)
}

/** One terminal cell of a bar: a block glyph in `fg` over `bg`; `fg` undefined is the default text color. */
export type Cell = { glyph: string; fg?: string; bg: string }

const eighths = (ch: string) => (ch === '█' ? 8 : ch === ' ' ? 0 : EIGHTHS.indexOf(ch))

/** A bar of rising parts (each by `usageCells`); `sliver`: part 0 shows ≥ ▏; `pace` (0–1): one cell a │. */
export const barCells = (
  parts: readonly { to: number; color: string }[],
  width: number,
  track: string,
  opts: { sliver?: boolean; pace?: number } = {},
): Cell[] => {
  const strs = parts.map(p => usageCells(p.to, width))
  const cellAt = (i: number, from: number): Cell => {
    for (let j = from; j < parts.length; j++) {
      const k = eighths(strs[j]![i]!)
      if (k === 0) continue
      const over = parts.findIndex((_, m) => m > j && eighths(strs[m]![i]!) > k)
      return { glyph: strs[j]![i]!, fg: parts[j]!.color, bg: over < 0 ? track : parts[over]!.color }
    }
    return { glyph: ' ', bg: track }
  }
  const cells = Array.from({ length: width }, (_, i) => cellAt(i, 0))
  const first = parts[0]
  // Anything used at all shows a sliver, over whatever else reaches into the first cell.
  if (opts.sliver && first && first.to > 0 && width > 0 && eighths(strs[0]![0]!) === 0) {
    const under = cellAt(0, 1)
    cells[0] = { glyph: '▏', fg: first.color, bg: eighths(under.glyph) > 1 ? under.fg! : track }
  }
  if (opts.pace !== undefined && width > 0) {
    const at = Math.min(width - 1, Math.floor(opts.pace * width))
    const c = cells[at]!
    cells[at] = eighths(c.glyph) >= 4 ? { glyph: '│', fg: track, bg: c.fg! } : { glyph: '│', bg: c.bg }
  }
  return cells
}

/** Neighbor cells drawn alike as one piece; a blank cell joins any piece on its background. */
export const runs = (cells: readonly Cell[]): { text: string; fg?: string; bg: string }[] => {
  const out: { text: string; fg?: string; bg: string; blank: boolean }[] = []
  for (const c of cells) {
    const last = out.at(-1)
    const blank = c.glyph === ' '
    if (last && last.bg === c.bg && (blank || last.blank || last.fg === c.fg)) {
      last.text += c.glyph
      if (last.blank && !blank) last.fg = c.fg
      last.blank &&= blank
    } else out.push({ text: c.glyph, fg: c.fg, bg: c.bg, blank })
  }
  return out.map(({ text, fg, bg }) => (fg === undefined ? { text, bg } : { text, fg, bg }))
}

/** How far through its window a limit is (0–1); undefined with no reset time. */
export const paceAt = (resetsAt: string | undefined, now: number, lengthMs: number): number | undefined => {
  if (resetsAt === undefined) return undefined
  const left = Date.parse(resetsAt) - now
  if (Number.isNaN(left)) return undefined
  return Math.max(0, Math.min(1, 1 - left / lengthMs))
}

/** A piece of a band row; shown while the row's tidy level is in [`from`, `upTo`). */
export type Piece = { text: string; color?: string; bg?: string; bold?: boolean; dim?: boolean; from?: number; upTo?: number }

// The pieces of one level, without the blanks (column padding) left at the row's end.
const shownAt = (pieces: readonly Piece[], level: number): Piece[] => {
  const shown = pieces.filter(p => level >= (p.from ?? 0) && (p.upTo === undefined || level < p.upTo))
  while (shown.length > 0 && shown.at(-1)!.bg === undefined && shown.at(-1)!.text.trim() === '') shown.pop()
  return shown
}

/** The fullest version of a row that fits `cols`; the last level if none fits. */
export const tidy = (pieces: readonly Piece[], cols: number): Piece[] => {
  const top = Math.max(0, ...pieces.map(p => p.upTo ?? 0))
  for (let level = 0; level < top; level++) {
    const shown = shownAt(pieces, level)
    if (shown.reduce((n, p) => n + p.text.length, 0) <= cols) return shown
  }
  return shownAt(pieces, top)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A short weekday, in local time: "Thu". */
export const fmtDay = (ms: number): string => DAYS[new Date(ms).getDay()]!

/**
 * How many items fit on a line `cols` wide after `head`, leaving room for
 * the "+N more" that names the rest.
 */
export const fitItems = (head: number, items: readonly number[], cols: number): number => {
  let used = head
  for (let i = 0; i < items.length; i++) {
    const rest = items.length - i - 1
    const more = rest > 0 ? `  +${rest} more`.length : 0
    if (used + items[i]! + more > cols) return i
    used += items[i]!
  }
  return items.length
}
