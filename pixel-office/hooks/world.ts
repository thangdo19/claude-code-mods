// What the office knows about the world outside it (approved rounds 6 and 7): who works from home, what each front desk is
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

/** A pinned clock: the hour (0–23), the minute and the date [year, month 1–12, day]; unset parts come from the real time. */
let pinned: { hour?: number; minute?: number; date?: readonly [number, number, number] } = {}
export const setClock = (c: { hour?: number; minute?: number; date?: readonly [number, number, number] }): void => {
  pinned = c
  decorMemo = null
  rainMemo = null
}

/** The date [year, month 1–12, day] at `now` (ms). */
export const dateAt = (now: number): readonly [number, number, number] => {
  const d0 = new Date(now)
  return pinned.date ?? [d0.getFullYear(), d0.getMonth() + 1, d0.getDate()]
}
/** The hour at `now` (ms). */
export const hourAt = (now: number): number => pinned.hour ?? new Date(now).getHours()
/**
 * The minute at `now` (round 11: the wall clock tells the time). A clock pinned to an hour alone is on the hour, so
 * pinned frames never change with the real minute.
 */
export const minuteAt = (now: number): number => pinned.minute ?? (pinned.hour !== undefined ? 0 : new Date(now).getMinutes())
/** A day number well mixed (two xorshift-multiply rounds): days next to each other share nothing. */
const mixed = (n: number): number => {
  let h = (n ^ 0x2545f491) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}
const wet = (day: number): boolean => mixed(day) % 5 === 0
/**
 * Round 11: about one day in five is rainy, by the date alone (the same all day, the same for everyone), never more
 * than 3 days in a row: a fourth wet day is dry.
 */
export const rainyOn = (y: number, m: number, d: number): boolean => {
  const t = dayNo(y, m, d)
  return wet(t) && !(wet(t - 1) && wet(t - 2) && wet(t - 3))
}
/** Is the day at `now` rainy? (Asked every frame, worked out once a minute, as `decorAt`.) */
export function rainyDay(now: number): boolean {
  const minute = Math.floor(now / 60_000)
  if (rainMemo?.minute !== minute) rainMemo = { minute, rainy: rainyOn(...dateAt(now)) }
  return rainMemo.rainy
}
let rainMemo: { minute: number; rainy: boolean } | null = null
/** The window's sky by the clock (night after 10 idle minutes stays as it was). */
export function skyAt(now: number): 'morning' | 'day' | 'sunset' | 'night' {
  const h = hourAt(now)
  return h >= 6 && h < 10 ? 'morning' : h >= 10 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'sunset' : 'night'
}
/** Breaks around noon are lunch. */
export const lunchAt = (now: number): boolean => hourAt(now) === 12

/* ===== holidays (approved round 7: every US holiday plus Tết; Christmas builds up from November) ===== */

/** The holidays the office dresses up for (Columbus / Indigenous Peoples' Day was left out, round 7). */
export type Holiday =
  | 'newyear' | 'mlk' | 'presidents' | 'valentine' | 'tet' | 'stpatrick' | 'easter' | 'memorial' | 'juneteenth' | 'july4' | 'labor'
  | 'halloween' | 'veterans' | 'thanksgiving' | 'christmas'
export type Wall = 'halloween' | 'tet' | 'garland' | 'tinsel' | 'hearts' | 'shamrock' | 'eggs' | 'usa' | 'leaves'
export type DeskDecor = 'xmas' | 'tet' | 'flag' | 'juneteenth' | 'rose' | 'clover' | 'confetti' | 'leaf'
/** On the floor of the plant corner (the Manager's desk has no room beside the hotline). */
export type Floor = 'turkey' | 'basket' | 'gold' | 'pumpkin'
/** What the office is dressed in on a date. */
export type Decor = {
  /** The holiday on, if any (the Christmas season counts from Nov 1). */
  holiday: Holiday | null
  /** Along the top of the wall. */
  wall: Wall | null
  /** By the plant on the Manager's desk. */
  desk: DeskDecor | null
  window: 'snow' | 'fireworks' | 'rainbow' | null
  /** The fir in the plant corner, in place of the fern: 0 none, 1 bare, 2 with lights, 3 with ornaments and a star. */
  tree: 0 | 1 | 2 | 3
  /** Gifts under the tree (0–4). */
  gifts: number
  /** A wreath on the door, stockings on the Manager's desk, the bush as a poinsettia. */
  wreath: boolean
  stockings: boolean
  poinsettia: boolean
  /** On everyone but the Janitor. */
  hats: 'santa' | 'party' | null
  /** Easter: a bunny behind the bush and eggs by the pots. */
  eggs: boolean
  floor: Floor | null
  /** December: snow lies on the windowsill, also under New Year's fireworks (round 9). */
  snowy: boolean
}

const NO_DECOR: Decor = {
  holiday: null, wall: null, desk: null, window: null, tree: 0, gifts: 0, wreath: false, stockings: false, poinsettia: false, hats: null, eggs: false, floor: null, snowy: false,
}

/**
 * Tết, its first day [month, day], by year, by Vietnam's own calendar (UTC+7): 2030 is Feb 2 there, Feb 3 in China
 * (round 9; worked out with Hồ Ngọc Đức's lunar calendar rules, which give every year here).
 */
const TET: Record<number, readonly [number, number]> = {
  2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 2], 2031: [1, 23], 2032: [2, 11], 2033: [1, 31], 2034: [2, 19], 2035: [2, 8],
  2036: [1, 28], 2037: [2, 15], 2038: [2, 4], 2039: [1, 24], 2040: [2, 12], 2041: [2, 1], 2042: [1, 22], 2043: [2, 10], 2044: [1, 30], 2045: [2, 17],
}
/** A date as a day number (days since 1970), so ranges cross months and years. */
export const dayNo = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay()
/** The day of month `m` that is its `n`th weekday `wd` (0 Sunday). */
export const nthWeekday = (y: number, m: number, wd: number, n: number): number => 1 + ((wd - weekday(y, m, 1) + 7) % 7) + (n - 1) * 7
/** The day of month `m` that is its last weekday `wd`. */
export const lastWeekday = (y: number, m: number, wd: number): number => {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return last - ((weekday(y, m, last) - wd + 7) % 7)
}
/** Easter Sunday [month, day] (the Gregorian computus). */
export function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1]
}
/** Thanksgiving: the fourth Thursday of November. */
export const thanksgiving = (y: number): number => nthWeekday(y, 11, 4, 4)

/**
 * Year `y`'s holidays as [holiday, first day, last day], the most important first: on its days it wins the wall, the
 * desk and the window. Monday holidays show the long weekend (Saturday to Monday).
 */
export function holidaysOf(y: number): readonly (readonly [Exclude<Holiday, 'christmas'>, number, number])[] {
  // (Asked every frame; a year's holidays never change.)
  if (yearMemo?.y === y) return yearMemo.all
  const out: [Exclude<Holiday, 'christmas'>, number, number][] = []
  const on = (h: Exclude<Holiday, 'christmas'>, m: number, d: number, before = 0, after = 0) => out.push([h, dayNo(y, m, d) - before, dayNo(y, m, d) + after])
  on('newyear', 12, 31, 0, 1)
  on('newyear', 1, 1)
  const t = TET[y]
  if (t) on('tet', t[0], t[1], 7, 7)
  on('valentine', 2, 14, 4)
  // (Monday to Thursday: on Friday the office is all Christmas, round 9.)
  on('thanksgiving', 11, thanksgiving(y), 3)
  on('july4', 7, 4, 3)
  on('memorial', 5, lastWeekday(y, 5, 1), 2)
  on('presidents', 2, nthWeekday(y, 2, 1, 3), 2)
  on('labor', 9, nthWeekday(y, 9, 1, 1), 2)
  on('mlk', 1, nthWeekday(y, 1, 1, 3), 2)
  on('juneteenth', 6, 19)
  on('veterans', 11, 11)
  on('stpatrick', 3, 17, 3)
  const [em, ed] = easter(y)
  on('easter', em, ed, 6)
  on('halloween', 10, 31, 11)
  yearMemo = { y, all: out }
  return out
}
let yearMemo: { y: number; all: readonly (readonly [Exclude<Holiday, 'christmas'>, number, number])[] } | null = null
const DAY_DECOR: Record<Exclude<Holiday, 'christmas'>, Pick<Decor, 'wall' | 'desk' | 'window' | 'floor'>> = {
  newyear: { wall: 'tinsel', desk: 'confetti', window: 'fireworks', floor: null },
  mlk: { wall: null, desk: 'flag', window: null, floor: null },
  presidents: { wall: 'usa', desk: 'flag', window: null, floor: null },
  valentine: { wall: 'hearts', desk: 'rose', window: null, floor: null },
  tet: { wall: 'tet', desk: 'tet', window: null, floor: null },
  stpatrick: { wall: 'shamrock', desk: 'clover', window: 'rainbow', floor: 'gold' },
  easter: { wall: 'eggs', desk: null, window: null, floor: 'basket' },
  memorial: { wall: 'usa', desk: 'flag', window: null, floor: null },
  juneteenth: { wall: null, desk: 'juneteenth', window: null, floor: null },
  july4: { wall: 'usa', desk: 'flag', window: 'fireworks', floor: null },
  labor: { wall: 'usa', desk: 'flag', window: null, floor: null },
  // (The jack-o'-lantern stands in the plant corner: on the desk it sat on the hotline, round 9.)
  halloween: { wall: 'halloween', desk: null, window: null, floor: 'pumpkin' },
  veterans: { wall: null, desk: 'flag', window: null, floor: null },
  thanksgiving: { wall: 'leaves', desk: 'leaf', window: null, floor: 'turkey' },
}

/**
 * The decorations for the date at `now`. Christmas (approved round 7, "Builds up"), from Nov 1 to Jan 1: the fir
 * comes Nov 1, its lights Nov 8, a garland on the wall Nov 15, after Thanksgiving ornaments and a star, a wreath,
 * stockings, a poinsettia; in December snow in the window and a gift more every 6 days; Dec 24–25 every gift and Santa
 * hats; after that the tree stays up to New Year. A holiday on its days wins the wall, the desk and the window; the
 * tree stays. On Feb 14 itself Valentine's wins over Tết (round 9).
 * Asked every frame, worked out once a minute (the date and the hour change no sooner; `setClock` starts it over):
 * the answer is shared, so only read it.
 */
export function decorAt(now: number): Readonly<Decor> {
  const minute = Math.floor(now / 60_000)
  if (decorMemo?.minute !== minute) decorMemo = { minute, decor: decorOn(now) }
  return decorMemo.decor
}
let decorMemo: { minute: number; decor: Decor } | null = null
function decorOn(now: number): Decor {
  const [y, m, d] = dateAt(now)
  const t = dayNo(y, m, d)
  const out: Decor = { ...NO_DECOR }
  const sy = m >= 11 ? y : y - 1
  if (t >= dayNo(sy, 11, 1) && t <= dayNo(sy + 1, 1, 1)) {
    const dec1 = dayNo(sy, 12, 1)
    const eve = dayNo(sy, 12, 24)
    const stage =
      t < dec1 ? (t < dayNo(sy, 11, 8) ? 1 : t < dayNo(sy, 11, 15) ? 2 : t <= dayNo(sy, 11, thanksgiving(sy)) ? 3 : 4)
      : t < eve ? 5 : t <= eve + 1 ? 6 : 7
    out.holiday = 'christmas'
    out.tree = stage === 1 ? 1 : stage <= 3 ? 2 : 3
    if (stage >= 3) out.wall = 'garland'
    if (stage >= 4) Object.assign(out, { wreath: true, stockings: true, desk: 'xmas', poinsettia: true })
    if (stage >= 5) out.window = 'snow'
    if (stage === 5) out.gifts = Math.min(4, 1 + Math.floor((t - dec1) / 6))
    if (stage === 6) Object.assign(out, { gifts: 4, hats: 'santa' })
    out.snowy = stage >= 5
  }
  const all = holidaysOf(y)
  const today = (m === 2 && d === 14 ? all.find(([h]) => h === 'valentine') : undefined) ?? all.find(([, a, b]) => t >= a && t <= b)
  if (today) {
    const [h] = today
    const dd = DAY_DECOR[h]
    out.holiday = h
    if (dd.wall) out.wall = dd.wall
    if (dd.desk) out.desk = dd.desk
    if (dd.window) out.window = dd.window
    out.floor = dd.floor
    // July 4th's fireworks: on the 4th all day, the evenings before.
    if (h === 'july4' && d !== 4 && hourAt(now) >= 6 && hourAt(now) < 17) out.window = null
    if (h === 'newyear') out.hats = 'party'
    if (h === 'easter') out.eggs = true
  }
  return out
}
