// The holiday the office is dressed for (approved round 10): its name, its first and last day, and the words the
// whiteboard shows them in when it has no to-dos (the only place that names it: a list row, a TV card, a banner and a
// wall calendar were built and cut, "too many places"). Pure; the date comes from `now` (world.ts), so tests pin it
// with `setClock`.

import { dateAt, dayNo, holidaysOf, thanksgiving, type Holiday } from './world'

/** A holiday the office is dressed for: its first and last day and the day asked about, as day numbers. */
export type Theme = {
  holiday: Holiday
  from: number
  to: number
  today: number
  /** Christmas builds up: what comes next (for the list, and in a word for the art), and the day it comes. */
  next?: { what: string; short: string; on: number }
}

/** Each holiday's name, the full one first, then shorter ones for a narrow place. */
const NAMES: Record<Holiday, readonly string[]> = {
  newyear: ['New Year'], mlk: ['MLK Day'], presidents: ["Presidents' Day", 'Presidents'], valentine: ["Valentine's Day", "Valentine's"], tet: ['Tết'],
  stpatrick: ["St. Patrick's Day", "St Patrick's Day", "St Patrick's"], easter: ['Easter'], memorial: ['Memorial Day'], juneteenth: ['Juneteenth'],
  july4: ['July 4th'], labor: ['Labor Day'], halloween: ['Halloween'], veterans: ['Veterans Day'], thanksgiving: ['Thanksgiving'], christmas: ['Christmas'],
}
/** The longest name that fits `most` letters. */
export const nameOf = (h: Holiday, most = 99): string => NAMES[h].find(n => n.length <= most) ?? NAMES[h][NAMES[h].length - 1]!.slice(0, most)

/** Each holiday's color: the marker its name is written in on the board. */
export const THEME_INK: Record<Holiday, string> = {
  newyear: '#b58a1f', mlk: '#2c4a9a', presidents: '#2c4a9a', valentine: '#d63a6a', tet: '#c62828', stpatrick: '#2f8a48', easter: '#8a5fd0',
  memorial: '#2c4a9a', juneteenth: '#c62828', july4: '#2c4a9a', labor: '#2c4a9a', halloween: '#d9701a', veterans: '#2c4a9a', thanksgiving: '#b5561e',
  christmas: '#2f8a4a',
}
/** The dates and the other small words on the board. */
const GRAY = '#5a6472'
/** The widest words a row of the board takes. */
const BOARD_COLS = 14

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ymd = (t: number): [number, number, number] => {
  const d = new Date(t * 86_400_000)
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}
/** A day as "Nov 8", or short as "11/8". */
export const dayWords = (t: number, short = false): string => {
  const [, m, d] = ymd(t)
  return short ? m + '/' + d : MON[m - 1] + ' ' + d
}

/** What Christmas adds next in season `sy` after day `t` (see `decorAt`). */
function xmasNext(sy: number, t: number): Theme['next'] {
  const steps: [number, string, string][] = [
    [dayNo(sy, 11, 8), 'tree lights', 'lights'],
    [dayNo(sy, 11, 15), 'a garland', 'garland'],
    [dayNo(sy, 11, thanksgiving(sy)) + 1, 'ornaments and a wreath', 'wreath'],
    [dayNo(sy, 12, 1), 'snow and gifts', 'snow'],
    [dayNo(sy, 12, 24), 'Santa hats', 'hats'],
  ]
  const s = steps.find(([on]) => on > t)
  return s ? { on: s[0], what: s[1], short: s[2] } : undefined
}

/**
 * What the office is dressed for on a date: the day's holiday first (the one `decorAt` gives the wall, the desk and
 * the window), then the Christmas season under it (Nov 1 – Jan 1). A holiday whose things are not up that day (Tết on
 * Feb 14) is not named.
 */
export function themesOn(y: number, m: number, d: number): Theme[] {
  const t = dayNo(y, m, d)
  const out: Theme[] = []
  const all = holidaysOf(y)
  const day = (m === 2 && d === 14 ? all.find(([h]) => h === 'valentine') : undefined) ?? all.find(([, a, b]) => t >= a && t <= b)
  if (day) {
    const [h] = day
    let [, from, to] = day
    // (New Year is two entries, Dec 31 and Jan 1: one stretch.)
    if (h === 'newyear') {
      from = dayNo(m === 12 ? y : y - 1, 12, 31)
      to = from + 1
    }
    out.push({ holiday: h, from, to, today: t })
  }
  const sy = m >= 11 ? y : y - 1
  if (t >= dayNo(sy, 11, 1) && t <= dayNo(sy + 1, 1, 1)) out.push({ holiday: 'christmas', from: dayNo(sy, 11, 1), to: dayNo(sy + 1, 1, 1), today: t, next: xmasNext(sy, t) })
  return out
}

/** The day last asked about (every place asks each frame; a day's answer never changes). */
let memo: { t: number; themes: Theme[]; next?: (Theme & { inDays: number }) | null } | null = null
export function themesAt(now: number): Theme[] {
  const [y, m, d] = dateAt(now)
  const t = dayNo(y, m, d)
  if (memo?.t !== t) memo = { t, themes: themesOn(y, m, d) }
  return memo.themes
}
/** The next holiday after today, and in how many days (the teaser on a plain day). */
export function nextTheme(now: number): (Theme & { inDays: number }) | null {
  themesAt(now)
  const mo = memo!
  if (mo.next === undefined) {
    mo.next = null
    for (let k = 1; k <= 400 && !mo.next; k++) {
      const th = themesOn(...ymd(mo.t + k))[0]
      if (th) mo.next = { ...th, inDays: k }
    }
  }
  return mo.next
}

/** "Nov 1 – Jan 1", "Nov 23 – 26", "Nov 11". `ascii`: for letters in the art (no long dash): "Nov 1-Jan 1". */
export function datesOf(th: Theme, ascii = false): string {
  const a = dayWords(th.from)
  if (th.from === th.to) return a
  return a + (ascii ? '-' : ' – ') + (ymd(th.from)[1] === ymd(th.to)[1] ? '' + ymd(th.to)[2] : dayWords(th.to))
}
/** "51 days left", "last day", "today only". */
export const leftOf = (th: Theme): string => {
  const n = th.to - th.today
  return th.from === th.to ? 'today only' : n === 0 ? 'last day' : n === 1 ? '1 day left' : n + ' days left'
}
const inDays = (n: number) => (n === 1 ? 'tomorrow' : 'in ' + n + ' days')

/** The name, the dates, the days left, then Christmas's next step; each at most `most` letters. */
function words(th: Theme, most: number): string[] {
  const out = [nameOf(th.holiday, most), datesOf(th, true), leftOf(th)]
  if (th.next) {
    const long = th.next.short + ' ' + dayWords(th.next.on)
    out.push(long.length <= most ? long : th.next.short + ' ' + dayWords(th.next.on, true))
  }
  return out
}
/** The teaser's words. */
const teaser = (n: Theme & { inDays: number }, most: number): string[] => ['Next up', nameOf(n.holiday, most), datesOf(n, true), inDays(n.inDays)]

export type BoardLine = { text: string; ink: string }
/**
 * The whiteboard's rows (4 at most, 14 letters each): one holiday with its dates, days left and next step; two with
 * name and dates each; on a plain day the teaser.
 */
export function boardTheme(now: number): BoardLine[] | null {
  const ths = themesAt(now)
  if (!ths.length) {
    const n = nextTheme(now)
    return n ? teaser(n, BOARD_COLS).map((text, k) => ({ text, ink: k === 1 ? THEME_INK[n.holiday] : GRAY })) : null
  }
  return ths.flatMap(th => words(th, BOARD_COLS).slice(0, ths.length > 1 ? 2 : 4).map((text, k) => ({ text, ink: k === 0 ? THEME_INK[th.holiday] : GRAY })))
}
