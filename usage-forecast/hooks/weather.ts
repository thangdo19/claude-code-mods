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

export const LIMIT_LABELS = { five_hour: 'Session', seven_day: 'Week' } as const

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
 * Limits saved by an earlier session: a window whose reset time has passed
 * is fresh again, so it reads 0% with no known reset.
 */
export const reviveLimits = <L extends { percentUsed: number; resetsAt?: string }>(limits: readonly L[], now: number): L[] =>
  limits.map(limit =>
    limit.resetsAt !== undefined && Date.parse(limit.resetsAt) <= now
      ? { ...limit, percentUsed: 0, resetsAt: undefined }
      : limit,
  )

/**
 * A limit's change over a turn, as the row writes it. A negative change means
 * its window reset mid-turn. Readings come in whole points, so a finished turn
 * that moved nothing reads "<1%"; a running one shows nothing until it moves.
 */
export const fmtLimitDelta = (delta: number, span: 'this' | 'last'): string => {
  if (delta < 0) return `↺ reset ${span} turn`
  if (delta > 0) return `${span === 'last' ? '▲ ' : ''}+${fmtPct(delta)}% ${span} turn`
  return span === 'last' ? '▲ <1% last turn' : ''
}

/**
 * This session's running spend after a new cost reading: `usd` is the
 * session's own total, which can start over (a /clear), so `spent` only grows.
 */
export const addSpend = (prev: { usd: number | null; spent: number }, usd: number): { usd: number; spent: number } => {
  if (prev.usd === null) return { usd, spent: prev.spent }
  return { usd, spent: prev.spent + (usd >= prev.usd ? usd - prev.usd : usd) }
}

/** Every running session's spend, by instance id, as the store holds it. */
export type Spend = Record<string, number>

/** What all sessions spent since `snap`; a session missing from `snap` began after it. */
export const spendSince = (snap: Readonly<Spend>, now: Readonly<Spend>): number =>
  Object.entries(now).reduce((sum, [id, usd]) => sum + Math.max(0, usd - (snap[id] ?? 0)), 0)

/** One window's learned % per dollar, and where its current measurement began. */
export type Anchor = { rate: number | null; pct: number; resetsAt?: string; snap: Spend }

const MIN_USD = 1
const MIN_PCT = 2
const SAME_RESET_MS = 30 * 60_000

const sameWindow = (a: string | undefined, b: string | undefined) =>
  a === b || (a !== undefined && b !== undefined && Math.abs(Date.parse(a) - Date.parse(b)) <= SAME_RESET_MS)

/**
 * Learns how many points of a window one dollar moves, from the account's
 * reading and every session's spend since the window's first reading. A
 * long span keeps the whole-point steps from skewing it; a new window keeps
 * the old rate until it has moved enough to measure again.
 */
export const learnRate = (
  prev: Anchor | undefined,
  limit: { percentUsed: number; resetsAt?: string },
  spend: Readonly<Spend>,
): Anchor => {
  if (!prev || limit.percentUsed < prev.pct || !sameWindow(prev.resetsAt, limit.resetsAt)) {
    const anchor: Anchor = { rate: prev?.rate ?? null, pct: limit.percentUsed, snap: { ...spend } }
    return limit.resetsAt === undefined ? anchor : { ...anchor, resetsAt: limit.resetsAt }
  }
  const usd = spendSince(prev.snap, spend)
  const pct = limit.percentUsed - prev.pct
  return usd >= MIN_USD && pct >= MIN_PCT ? { ...prev, rate: pct / usd } : prev
}

/**
 * A limit's change over a turn: this session's own share when a rate is
 * known (at least 0.1 once it spent anything), the account's change
 * otherwise. A window that reset since `startPct` reads negative either way.
 */
export const turnDelta = (
  percentUsed: number,
  startPct: number | undefined,
  spent: number | null,
  rate: number | undefined,
): number | undefined => {
  if (startPct !== undefined && percentUsed < startPct) return Math.round((percentUsed - startPct) * 10) / 10
  if (rate !== undefined && spent !== null) return spent > 0 ? Math.max(0.1, Math.round(spent * rate * 10) / 10) : 0
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
