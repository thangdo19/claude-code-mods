// What the office knows about the world outside it (approved round 6): who works from home, what each front desk is
// for, the time of day (the window, lunch) and the date (holidays). Pure. Tests and the picks page pin the clock with
// `setClock`, so the same office draws the same frames anywhere.

import type { Role } from '../types'

/** The two staff with the fewest jobs work from home: they show up on the video-call desk when they have one. */
export const REMOTE: readonly Role[] = ['researcher', 'librarian']
export const remote = (r: Role): boolean => REMOTE.includes(r)

/** What each front desk is (left to right): the plant corner, the Planner's, the video-call desk, an agent's. */
export type DeskKind = 'plants' | 'staff' | 'call' | 'agent'
export const DESK_KIND: readonly DeskKind[] = ['plants', 'staff', 'call', 'agent']
/** Who owns each front desk (an agent may borrow it while they have no job). */
export const DESK_OWNER: readonly (Role | null)[] = [null, 'planner', null, null]
/** The order agents take desks: the free one first, then the Planner's. */
export const AGENT_DESKS: readonly number[] = [3, 1]

/** A pinned clock: the hour (0–23) and the date [year, month 1–12, day]; unset parts come from the real time. */
let pinned: { hour?: number; date?: readonly [number, number, number] } = {}
export const setClock = (c: { hour?: number; date?: readonly [number, number, number] }): void => {
  pinned = c
}

/** The hour at `now` (ms). */
export const hourAt = (now: number): number => pinned.hour ?? new Date(now).getHours()
/** The window's sky by the clock (night after 10 idle minutes stays as it was). */
export function skyAt(now: number): 'morning' | 'day' | 'sunset' | 'night' {
  const h = hourAt(now)
  return h >= 6 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'sunset' : 'night'
}
/** Breaks around noon are lunch. */
export const lunchAt = (now: number): boolean => hourAt(now) === 12

/** Lunar New Year (Tết), its first day [month, day], by year. */
const TET: Record<number, readonly [number, number]> = { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3] }
/** The decorations for the date at `now`: Halloween (Oct 20–31), Christmas (December), Tết (a week each side), or none. */
export function holidayAt(now: number): 'halloween' | 'christmas' | 'tet' | null {
  const d = new Date(now)
  const [y, m, day] = pinned.date ?? [d.getFullYear(), d.getMonth() + 1, d.getDate()]
  if (m === 10 && day >= 20) return 'halloween'
  if (m === 12) return 'christmas'
  const t = TET[y]
  if (t) {
    const at = (mm: number, dd: number) => Date.UTC(y, mm - 1, dd) / 86_400_000
    const diff = at(m, day) - at(t[0], t[1])
    if (diff >= -7 && diff <= 7) return 'tet'
  }
  return null
}
