// The limit rows of the band (Session, Week, Fable, Spend) as pieces of
// text. Pure: register.tsx draws them, tests and scripts read them directly.

import type { Limit, Weather } from '../types'
import {
  barCells,
  FABLE,
  fableShare,
  fableTurn,
  fmtDay,
  fmtLeft,
  fmtLimitDelta,
  fmtPct,
  fmtReset,
  HOT_PCT,
  isFableKind,
  LIMIT_KINDS,
  LIMIT_LABELS,
  paceAt,
  parentOf,
  runs,
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

/** The bar's width: 10 cells up to 99 columns, 30 from 119. */
export const barWidth = (cols: number) => Math.max(10, Math.min(30, cols - LABEL_WIDTH - 80))

// A row before its columns are lined up with the other rows': the %, the running turn's figure, the last turn's.
type Row = { head: Piece[]; pct: Piece; over: Piece[]; now?: Piece; last?: Piece; tail: Piece[] }
// `last` goes at this tidy level, after the reset time.
const LAST_UPTO = 3

const blank = (n: number, upTo?: number): Piece[] =>
  n <= 0 ? [] : [upTo === undefined ? { text: ' '.repeat(n) } : { text: ' '.repeat(n), upTo }]

/** Rows as pieces, each figure under the one above: padded to the widest, a gap where a row has none. */
const lineUp = (rows: readonly Row[], withLast: boolean): { pieces: Piece[]; last?: Piece }[] => {
  const widest = (of: (r: Row) => Piece | undefined) => Math.max(0, ...rows.map(r => of(r)?.text.length ?? 0))
  const pctW = widest(r => r.pct)
  const nowW = widest(r => r.now)
  const lastW = withLast ? widest(r => r.last) : 0
  return rows.map(r => {
    // " ▲ +0.4% last": the mark stays put, the figure moves right.
    const last = lastW > 0 && r.last ? { ...r.last, text: r.last.text.slice(0, 3) + r.last.text.slice(3).padStart(lastW - 3) } : undefined
    const pieces = [
      ...r.head,
      ...blank(pctW - r.pct.text.length),
      r.pct,
      ...r.over,
      ...blank(nowW - (r.now?.text.length ?? 0)),
      ...(r.now ? [r.now] : []),
      ...(last ? [last] : blank(lastW, LAST_UPTO)),
      ...r.tail,
    ]
    return last ? { pieces, last } : { pieces }
  })
}

/** Each row made to fit `cols`. `last` leaves every row together, so the columns stay lined up. */
const fit = (rows: readonly Row[], cols: number): Piece[][] => {
  const lined = lineUp(rows, true)
  const tidied = lined.map(l => tidy(l.pieces, cols))
  const isCut = lined.some((l, i) => l.last !== undefined && !tidied[i]!.includes(l.last))
  return isCut ? lineUp(rows, false).map(l => tidy(l.pieces, cols)) : tidied
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
