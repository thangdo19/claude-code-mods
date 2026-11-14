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
  fullAt,
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
const MIN_MS = 60_000

/** This session's Fable $ over the running turn: all of it if the count started over since. */
export const fableTurnUsd = (w: Weather): number => {
  const now = w.modelSpent?.usd[FABLE] ?? 0
  const start = w.turnStartFable ?? now
  return now >= start ? now - start : now
}

/** A limit's change over the running turn: this session's share once a rate is learned, the account's before. */
export const thisDeltaOf = (w: Weather, working: boolean, limit: Limit): number | undefined => {
  if (!working) return undefined
  const spent = w.turnStartSpent == null ? null : w.spent - w.turnStartSpent
  return turnDelta(limit.percentUsed, w.turnStartLimits?.[limit.kind], spent, w.rates[limit.kind])
}

/** The bar's width: 10 cells up to 99 columns, 30 from 119. */
export const barWidth = (cols: number) => Math.max(10, Math.min(30, cols - LABEL_WIDTH - 80))

// Getting close: amber, then red, as the context line does.
const fillOf = (pct: number, base: string) => (pct >= HOT_PCT ? 'red' : pct >= WARN_PCT ? WARN : base)
const barPieces = (cells: readonly Cell[]): Piece[] => runs(cells).map(r => ({ text: r.text, color: r.fg, bg: r.bg }))

/**
 * Session, Week, Fable, Spend, each made to fit `cols`; with no Week, Fable
 * under Spend. A real Fable limit, should one come, takes the count's place.
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
  const limitPieces = (limit: Limit, label: string, base: string, track: string): Piece[] => {
    const kind = limit.kind
    const pct = limit.percentUsed
    const fill = fillOf(pct, base)
    const length = windowOf(kind)
    // The mark: how far through its window the limit is.
    const pace = length === undefined ? undefined : paceAt(limit.resetsAt, w.now, length)
    const withDate = !kind.includes('five_hour')
    const isReal = isFableKind(kind) && allowance !== undefined
    // This session's own share of the running turn, the account's change until a rate is learned.
    const thisDelta = isReal ? realThis : thisDeltaOf(w, working, limit)
    // Kept while the next turn runs, so the previous answer's cost stays readable.
    const lastDelta = isReal ? realLast : w.lastLimitDelta[kind]
    const thisText = thisDelta === undefined ? '' : fmtLimitDelta(thisDelta, 'this')
    const lastText = lastDelta === undefined ? '' : fmtLimitDelta(lastDelta, 'last')
    // When it fills at this pace, if that is before the reset.
    const full = length === undefined ? undefined : fullAt(pct, limit.resetsAt, w.now, length, withDate ? 60 * MIN_MS : 10 * MIN_MS)
    // Counted from the last refresh; the minute timer keeps it current.
    const at = limit.resetsAt ? fmtReset(limit.resetsAt, withDate) : ''
    const left = at ? fmtLeft(Date.parse(limit.resetsAt!) - w.now) : ''
    return [
      { text: label.padEnd(LABEL_WIDTH), color: base, bold: true },
      ...barPieces(barCells([{ to: pct, color: fill }], width, track, pace === undefined ? {} : { pace })),
      { text: ` ${fmtPct(pct)}%`, color: fill, bold: true },
      ...(pct > 100 ? [{ text: ` over by ${fmtPct(pct - 100)}%`, color: 'red', bold: true }] : []),
      ...(thisText ? [{ text: ` ${thisText}`, color: base }] : []),
      ...(lastText ? [{ text: ` ${lastText}`, color: base, upTo: 3 }] : []),
      ...(full
        ? [
            { text: ' · ', dim: true, upTo: 4 },
            { text: `full ${fmtReset(full, withDate)}`, color: pct >= HOT_PCT ? 'red' : WARN, upTo: 4 },
          ]
        : []),
      ...(at
        ? [
            { text: ` · ${left} → ${at}`, dim: true, upTo: 1 },
            { text: ` · ${left}`, dim: true, from: 1, upTo: 2 },
          ]
        : [{ text: ' · window reset', dim: true, upTo: 2 }]),
    ]
  }

  // The mod's own count of Fable: its $ this window (all sessions) in points of the parent.
  const fablePieces = (parent: Limit): Piece[] => {
    const usd = sumLedgers([w.modelSpent ?? { usd: {} }, w.modelTotals ?? { usd: {} }], parent.resetsAt)
    const rate = w.rates[parent.kind]
    const isZero = (usd[FABLE] ?? 0) <= 0
    const pts = fableShare(usd, parent.percentUsed, rate)
    const fill = fillOf(pts, MODEL_COLOR)
    // Fable's part, then the other models' as a shadow up to the parent's figure.
    const cells = barCells([{ to: pts, color: fill }, { to: parent.percentUsed, color: SHADOW }], width, TRACK, { sliver: true })
    const head: Piece[] = [
      { text: FABLE_LABEL.padEnd(LABEL_WIDTH), color: MODEL_COLOR, bold: true, dim: isZero },
      ...barPieces(cells),
      { text: ` ${fmtPct(pts)}%`, color: isZero ? undefined : fill, bold: !isZero, dim: isZero },
    ]
    if (isZero) return [...head, { text: ` · not used this ${parent.kind === 'seven_day' ? 'week' : 'period'}`, dim: true, upTo: 1 }]
    const thisText = fableThis === undefined ? '' : fmtLimitDelta(fableThis, 'this')
    // A last turn that used no Fable says nothing.
    const lastText = w.lastFableDelta ? fmtLimitDelta(w.lastFableDelta, 'last') : ''
    return [
      ...head,
      ...(thisText ? [{ text: ` ${thisText}`, color: MODEL_COLOR }] : []),
      ...(lastText ? [{ text: ` ${lastText}`, color: MODEL_COLOR, upTo: 1 }] : []),
      ...(w.fableSince != null ? [{ text: ` · since ${fmtDay(w.fableSince)}`, dim: true, upTo: 2 }] : []),
    ]
  }

  const real = w.limits.filter(l => isFableKind(l.kind))
  const realRows = real.map(l => limitPieces(l, FABLE_LABEL, MODEL_COLOR, FABLE_TRACK))
  const rows: Piece[][] = []
  for (const kind of LIMIT_KINDS) {
    const limit = w.limits.find(l => l.kind === kind)
    if (!limit) continue
    rows.push(limitPieces(limit, LIMIT_LABELS[kind], 'claude', TRACK))
    if (limit === parent) rows.push(...(real.length > 0 ? realRows : [fablePieces(parent)]))
  }
  if (!parent) rows.push(...realRows)
  return rows.map(pieces => tidy(pieces, cols))
}
