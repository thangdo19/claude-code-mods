// The limit rows of the band (Session, Week, Fable, Spend) as pieces of
// text. Pure: register.tsx draws them, tests and scripts read them directly.

import type { Limit, TotalFrom, Weather } from '../types'
import {
  barCells,
  FABLE,
  fableShare,
  fableTurn,
  fmtDay,
  fmtLeft,
  fmtLimitDelta,
  fmtLimitTotal,
  fmtPct,
  fmtReset,
  HOT_PCT,
  isFableKind,
  LIMIT_KINDS,
  LIMIT_LABELS,
  paceAt,
  parentOf,
  runs,
  sameWindow,
  sumLedgers,
  tidy,
  toAllowance,
  turnDelta,
  windowOf,
} from './weather'
import type { Cell, Piece } from './weather'

export const TRACK = '#4a2e25'
export const LABEL_WIDTH = 9
export const MODEL_COLOR = 'permission'
// The Fable row: the Week's part other models took, and a real Fable limit's own track.
export const SHADOW = '#8f5540'
export const FABLE_TRACK = '#2c3050'
export const FABLE_LABEL = '└ Fable'
// A limit used this much draws amber (red from HOT_PCT).
export const WARN_PCT = 75
export const WARN = 'warning'

/** This session's Fable $ since its count read `start`: all of it if the count started over since. */
export const fableUsdSince = (w: Weather, start: number | null): number => {
  const now = w.modelSpent?.usd[FABLE] ?? 0
  const from = start ?? now
  return now >= from ? now - from : now
}

/** This session's Fable $ over the running turn. */
export const fableTurnUsd = (w: Weather): number => fableUsdSince(w, w.turnStartFable)

/** A limit's change over the running turn: this session's share once a rate is learned, the account's before. */
export const thisDeltaOf = (w: Weather, working: boolean, limit: Limit): number | undefined => {
  if (!working) return undefined
  const spent = w.turnStartSpent == null ? null : w.spent - w.turnStartSpent
  return turnDelta(limit.percentUsed, w.turnStartLimits?.[limit.kind], spent, w.rates[limit.kind])
}

// A reading this fresh (or a live one) is a fair start for a total's %.
const FAIR_MS = 60_000

/**
 * Where each limit's session total counts from, kept up with the readings: a limit seen for the first time counts
 * from now; one whose window reset counts again from the reset (its % from then unknown); a lower reading in the same
 * window is the start. The same object when nothing changed. The Fable limit has none: it counts from its parent's.
 */
export const rebaseTotals = (w: Weather): Weather => {
  const from = w.totalFrom ?? {}
  const fair = w.limitsAsOf === null || w.now - w.limitsAt < FAIR_MS
  const fable = w.modelSpent?.usd[FABLE] ?? 0
  let changed: Record<string, TotalFrom> | undefined
  for (const l of w.limits) {
    if (isFableKind(l.kind)) continue
    const f = from[l.kind]
    const window = l.resetsAt === undefined ? {} : { resetsAt: l.resetsAt }
    let next: TotalFrom | undefined
    if (!f || (!l.isReset && !f.isReset && !sameWindow(f.resetsAt, l.resetsAt))) next = { spent: w.spent, fable, ...(fair && !f ? { pct: l.percentUsed } : {}), ...window }
    else if (l.isReset) next = f.isReset ? undefined : { spent: w.spent, fable, isReset: true }
    // The new window's first reading: what was spent since the reset counts.
    else if (f.isReset) next = { spent: f.spent, fable: f.fable, ...window }
    // Nothing spent yet: a fair reading is the start.
    else if (f.pct === undefined && fair && w.spent === f.spent) next = { ...f, pct: l.percentUsed }
    else if (f.pct !== undefined && l.percentUsed < f.pct) next = { ...f, pct: l.percentUsed }
    if (next) (changed ??= { ...from })[l.kind] = next
  }
  return changed ? { ...w, totalFrom: changed } : w
}

/** What this session used of a limit since its total's start: its share once a rate is learned, the account's change before. */
export const totalOf = (w: Weather, limit: Limit): number | undefined => {
  const f = w.totalFrom?.[limit.kind]
  if (!f || f.isReset || limit.isReset) return undefined
  const d = turnDelta(limit.percentUsed, f.pct, w.spent - f.spent, w.rates[limit.kind])
  return d === undefined || d < 0 ? undefined : d
}

/** Fable's part of the parent's session total, in the parent's points. */
const fableTotalOf = (w: Weather, parent: Limit): number | undefined => {
  const f = w.totalFrom?.[parent.kind]
  if (!f || f.isReset || parent.isReset) return undefined
  const d = fableTurn(fableUsdSince(w, f.fable), w.spent - f.spent, totalOf(w, parent), w.rates[parent.kind])
  return d === undefined || d <= 0 ? undefined : d
}

/** The bar's width: 10 cells up to 99 columns, 30 from 119. */
export const barWidth = (cols: number) => Math.max(10, Math.min(30, cols - LABEL_WIDTH - 80))

// A row before its columns are lined up with the other rows': the %, the running turn's figure, the last turn's.
type Row = { head: Piece[]; pct: Piece; over: Piece[]; now?: Piece; last?: Piece; total?: Piece; tail: Piece[] }
// `last` goes at this tidy level, after the reset time.
const LAST_UPTO = 3

const blank = (n: number, upTo?: number): Piece[] =>
  n <= 0 ? [] : [upTo === undefined ? { text: ' '.repeat(n) } : { text: ' '.repeat(n), upTo }]

/** Rows as pieces, each figure under the one above: padded to the widest, a gap where a row has none. */
const lineUp = (rows: readonly Row[], withLast: boolean, withTotal: boolean): { pieces: Piece[]; last?: Piece; total?: Piece }[] => {
  const widest = (of: (r: Row) => Piece | undefined) => Math.max(0, ...rows.map(r => of(r)?.text.length ?? 0))
  const pctW = widest(r => r.pct)
  const nowW = widest(r => r.now)
  const lastW = withLast ? widest(r => r.last) : 0
  const totalW = withTotal ? widest(r => r.total) : 0
  // " ▲ +0.4% last", " Σ +6.2%": the mark stays put, the figure moves right.
  const markFirst = (p: Piece, w: number) => ({ ...p, text: p.text.slice(0, 3) + p.text.slice(3).padStart(w - 3) })
  return rows.map(r => {
    const last = lastW > 0 && r.last ? markFirst(r.last, lastW) : undefined
    const total = totalW > 0 && r.total ? markFirst(r.total, totalW) : undefined
    const pieces = [
      ...r.head,
      ...blank(pctW - r.pct.text.length),
      r.pct,
      ...r.over,
      ...blank(nowW - (r.now?.text.length ?? 0)),
      ...(r.now ? [r.now] : []),
      ...(last ? [last] : blank(lastW, LAST_UPTO)),
      ...(total ? [total] : blank(totalW, LAST_UPTO)),
      ...r.tail,
    ]
    return { pieces, ...(last ? { last } : {}), ...(total ? { total } : {}) }
  })
}

/**
 * Each row made to fit `cols`. The total, then `last`, leaves every row together (after the reset time), so the
 * columns stay lined up.
 */
const fit = (rows: readonly Row[], cols: number): Piece[][] => {
  for (const [withLast, withTotal] of [[true, true], [true, false]] as const) {
    const lined = lineUp(rows, withLast, withTotal)
    const tidied = lined.map(l => tidy(l.pieces, cols))
    const isCut = lined.some((l, i) => (l.last !== undefined && !tidied[i]!.includes(l.last)) || (l.total !== undefined && !tidied[i]!.includes(l.total)))
    if (!isCut) return tidied
  }
  return lineUp(rows, false, false).map(l => tidy(l.pieces, cols))
}

// Getting close: amber, then red, as the context line does.
const fillOf = (pct: number, base: string) => (pct >= HOT_PCT ? 'red' : pct >= WARN_PCT ? WARN : base)
const barPieces = (cells: readonly Cell[]): Piece[] => runs(cells).map(r => ({ text: r.text, color: r.fg, bg: r.bg }))

/**
 * Session, Week, Fable, Spend, their figures lined up in columns and each
 * made to fit `cols`; with no Week, Fable under Spend. A real Fable limit
 * (the account's answer) takes the count's place.
 */
export const limitRows = (w: Weather, cols: number, working: boolean): Piece[][] => {
  const width = barWidth(cols)
  const turnSpent = w.turnStartSpent == null ? 0 : w.spent - w.turnStartSpent
  const parent = parentOf(w.limits)
  // Fable's part of the running turn, in Week points, from the mod's count.
  const fableThis =
    working && parent ? fableTurn(fableTurnUsd(w), turnSpent, thisDeltaOf(w, working, parent), w.rates[parent.kind]) : undefined
  // A real Fable limit's turn figures: the count's, in Fable's own % once its share of the week is known.
  const allowance = w.fableAllowance ?? undefined
  const realThis = allowance && fableThis !== undefined ? toAllowance(fableThis, allowance) : undefined
  const realLast = allowance && w.lastFableDelta ? toAllowance(w.lastFableDelta, allowance) : undefined
  // Fable's session total, the same way: the count's, in Fable's own % for a real limit.
  const fableTotal = parent ? fableTotalOf(w, parent) : undefined
  const realTotal = allowance && fableTotal !== undefined ? toAllowance(fableTotal, allowance) : undefined
  // The session's total, faint after `last`.
  const totalPiece = (total: number | undefined, isSpent: boolean, color: string): { total?: Piece } => {
    const text = total === undefined ? '' : fmtLimitTotal(total, isSpent)
    return text ? { total: { text: ` ${text}`, color, dim: true, upTo: LAST_UPTO } } : {}
  }

  // One limit's row. Pieces with `upTo` go first when the row is too wide.
  const limitPieces = (limit: Limit, label: string, base: string, track: string): Row => {
    const kind = limit.kind
    const pct = limit.percentUsed
    const fill = fillOf(pct, base)
    const length = windowOf(kind)
    // The mark: how far through its window the limit is.
    const pace = length === undefined ? undefined : paceAt(limit.resetsAt, w.now, length)
    const withDate = !kind.includes('five_hour')
    // A Fable limit is read between turns, never within one: its turn figures are the count's, or none.
    const isFable = isFableKind(kind)
    // This session's own share of the running turn, the account's change until a rate is learned.
    const thisDelta = isFable ? realThis : thisDeltaOf(w, working, limit)
    // Kept while the next turn runs, so the previous answer's cost stays readable.
    const lastDelta = isFable ? realLast : w.lastLimitDelta[kind]
    const thisText = thisDelta === undefined ? '' : fmtLimitDelta(thisDelta, 'this')
    const lastText = lastDelta === undefined ? '' : fmtLimitDelta(lastDelta, 'last')
    // Counted from the last refresh; the minute timer keeps it current.
    const at = limit.resetsAt ? fmtReset(limit.resetsAt, withDate) : ''
    const left = at ? fmtLeft(Date.parse(limit.resetsAt!) - w.now) : ''
    return {
      head: [
        { text: label.padEnd(LABEL_WIDTH), color: base, bold: true },
        ...barPieces(barCells([{ to: pct, color: fill }], width, track, pace === undefined ? {} : { pace })),
      ],
      pct: { text: ` ${fmtPct(pct)}%`, color: fill, bold: true },
      over: pct > 100 ? [{ text: ` over by ${fmtPct(pct - 100)}%`, color: 'red', bold: true }] : [],
      ...(thisText ? { now: { text: ` ${thisText}`, color: base } } : {}),
      ...(lastText ? { last: { text: ` ${lastText}`, color: base, upTo: LAST_UPTO } } : {}),
      ...(isFable ? totalPiece(realTotal, false, base) : totalPiece(totalOf(w, limit), w.spent > (w.totalFrom?.[kind]?.spent ?? w.spent), base)),
      tail: [
        ...(at
          ? [
              { text: ` · ${left} → ${at}`, dim: true, upTo: 1 },
              { text: ` · ${left}`, dim: true, from: 1, upTo: 2 },
            ]
          : // Only a window whose reset passed says so; a limit that names no reset time says nothing.
            limit.isReset
            ? [{ text: ' · window reset', dim: true, upTo: 2 }]
            : []),
      ],
    }
  }

  // The mod's own count of Fable: its $ this window (all sessions) in points of the parent.
  const fablePieces = (parent: Limit): Row => {
    const usd = sumLedgers([w.modelSpent ?? { usd: {} }, w.modelTotals ?? { usd: {} }], parent.resetsAt)
    const rate = w.rates[parent.kind]
    const isZero = (usd[FABLE] ?? 0) <= 0
    const pts = fableShare(usd, parent.percentUsed, rate)
    const fill = fillOf(pts, MODEL_COLOR)
    // Fable's part, then the other models' as a shadow up to the parent's figure.
    const cells = barCells([{ to: pts, color: fill }, { to: parent.percentUsed, color: SHADOW }], width, TRACK, { sliver: true })
    const head: Piece[] = [{ text: FABLE_LABEL.padEnd(LABEL_WIDTH), color: MODEL_COLOR, bold: true, dim: isZero }, ...barPieces(cells)]
    const figure: Piece = { text: ` ${fmtPct(pts)}%`, color: isZero ? undefined : fill, bold: !isZero, dim: isZero }
    if (isZero) {
      const none = ` · not used this ${parent.kind === 'seven_day' ? 'week' : 'period'}`
      return { head, pct: figure, over: [], tail: [{ text: none, dim: true, upTo: 1 }] }
    }
    const thisText = fableThis === undefined ? '' : fmtLimitDelta(fableThis, 'this')
    // A last turn that used no Fable says nothing.
    const lastText = w.lastFableDelta ? fmtLimitDelta(w.lastFableDelta, 'last') : ''
    return {
      head,
      pct: figure,
      over: [],
      ...(thisText ? { now: { text: ` ${thisText}`, color: MODEL_COLOR } } : {}),
      ...(lastText ? { last: { text: ` ${lastText}`, color: MODEL_COLOR, upTo: LAST_UPTO } } : {}),
      ...totalPiece(fableTotal, false, MODEL_COLOR),
      tail: w.fableSince != null ? [{ text: ` · since ${fmtDay(w.fableSince)}`, dim: true, upTo: 2 }] : [],
    }
  }

  const real = w.limits.filter(l => isFableKind(l.kind))
  const realRows = real.map(l => limitPieces(l, FABLE_LABEL, MODEL_COLOR, FABLE_TRACK))
  const rows: Row[] = []
  for (const kind of LIMIT_KINDS) {
    const limit = w.limits.find(l => l.kind === kind)
    if (!limit) continue
    rows.push(limitPieces(limit, LIMIT_LABELS[kind], 'claude', TRACK))
    if (limit === parent) rows.push(...(real.length > 0 ? realRows : [fablePieces(parent)]))
  }
  if (!parent) rows.push(...realRows)
  return fit(rows, cols)
}
