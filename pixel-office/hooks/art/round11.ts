// Round 11's art (approved Nov 13 2026): the party's cake slices and the cat's hat, sunlight and rain, the clock's real
// time, the water bottle as memory, cups and pages, the cat's eyes, a sparkle and a sweat drop. Made of what the office
// already has (its colors, its shapes). Pure.

import type { FB, Scene } from '../gfx/fb'
import { C, mix } from '../gfx/color'
import { OUT, P } from './palette'
import { art } from './extras'

/* ===== A: the party ===== */

/** A slice of cake held up in the right hand of someone cheering (person's top-left at x, top; `f` their frame). */
export function slice(fb: FB, x: number, top: number, f: number): void {
  const y = top + (f % 2) - 1
  fb.s(x + 6, y, '#f2a7c3')
  fb.s(x + 7, y, '#fff3f6')
  fb.s(x + 6, y + 1, '#e8869f')
  fb.s(x + 7, y + 1, '#f2a7c3')
  fb.s(x + 7, y - 1, '#e04b4b')
}
/** A party hat for the cat: on its head at (x, y) = the hat's tip. */
export function catHat(fb: FB, x: number, y: number): void {
  fb.s(x, y, '#ffd84a')
  fb.s(x, y + 1, '#3a6fd6')
  fb.r(x - 1, y + 2, 3, 1, '#3a6fd6')
  fb.s(x, y + 2, '#ffd84a')
}

/* ===== B: the window and the light ===== */

const SUN_INK = { morning: '#ffe0a8', day: '#ffeaa8', sunset: '#ff9a5a' } as const
/** Sunlight through the two panes, slanting down to the left across the floor (the twin of the moonlight). */
export function sunPatch(fb: FB, at: { x: number; y: number }, sky: 'morning' | 'day' | 'sunset'): void {
  const ink = SUN_INK[sky]
  const t = sky === 'sunset' ? 0.5 : 0.55
  for (let k = 0; k <= 10; k++) {
    if (k === 5) continue
    for (let x = at.x - 4 - k; x <= at.x - k; x++) {
      const i = (at.y + k) * fb.w + x
      const c = fb.p[i]
      if (c !== undefined && c >= 0) fb.p[i] = mix(c, ink, t)
    }
  }
}
/** A rainy day in the window: a gray sky, drops running down the panes. */
export function rainPane(fb: FB, x: number, y: number, w: number, h: number, f: number): void {
  const ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2
  fb.clip = [ix, iy, ix + iw - 1, iy + ih - 1]
  fb.r(ix, iy, iw, ih, '#8496ad')
  fb.r(ix, iy, iw, 2, '#6f8198')
  for (let i = 0; i < 5; i++) {
    const dx = ix + ((i * 3 + 1) % iw)
    const dy = iy + ((f * 2 + i * 3) % (ih + 2)) - 1
    fb.s(dx, dy, '#d6e6f5')
    fb.s(dx, dy + 1, '#b9cde2')
  }
  fb.clip = null
  fb.r(x, y + Math.floor(h / 2), w, 1, '#eef1f4')
  fb.r(x - 1, y + h, w + 2, 1, '#9aa3ae')
}
/** Two wet umbrellas leaning by the door (their tips on the floor at y). */
export function umbrellas(fb: FB, x: number, y: number): void {
  art(fb, x, y - 7, ['k.', 'r.', 'r.', 'R.', 'r.', 'r.', 'r.', 'k.'], { r: '#d63a3a', R: '#a52a2a', k: OUT })
  art(fb, x + 1, y - 6, ['k', 'b', 'b', 'B', 'b', 'b', 'k'], { b: '#3a6fd6', B: '#2c4a9a', k: OUT })
}
/** The 8 places a hand can point to on the clock's 3 × 3 face, clockwise from 12. */
export const CLOCK_HANDS = [[2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2], [1, 1]] as const
/** Where the clock's hands point at a time: [hour hand, minute hand], each 0–7 into `CLOCK_HANDS`. */
export const clockHands = (hour: number, minute: number): readonly [number, number] => [Math.round((((hour % 12) + minute / 60) / 12) * 8) % 8, Math.round(minute / 7.5) % 8]
/** The wall clock at the real time: the dark hand the hour, the red hand the minute (the hour hand on top). */
export function clockAt(fb: FB, x: number, y: number, hour: number, minute: number): void {
  fb.r(x + 1, y, 3, 1, '#4d5563')
  fb.r(x, y + 1, 5, 3, '#4d5563')
  fb.r(x + 1, y + 4, 3, 1, '#4d5563')
  fb.r(x + 1, y + 1, 3, 3, '#f6f7f9')
  const [hi, mi] = clockHands(hour, minute)
  const m = CLOCK_HANDS[mi]!
  const h = CLOCK_HANDS[hi]!
  fb.s(x + 2, y + 2, OUT)
  fb.s(x + m[0], y + m[1], P.red)
  fb.s(x + h[0], y + h[1], OUT)
}

/* ===== C: things that mean something ===== */

/**
 * The cooler's bottle (4 rows of water over the cooler at x, y) with `left` rows of water (4 full … 0 empty: the memory
 * still free, `bottleLeft` in office.ts): clear glass above the water, the last row blinking red.
 */
export function bottle(fb: FB, x: number, y: number, left: number, f: number): void {
  // The empty part of the bottle: clear glass.
  fb.r(x + 1, y, 2, 1, '#e3f1fb')
  fb.r(x, y + 1, 4, 4 - left, '#e3f1fb')
  fb.s(x, y + 1, '#f4faff')
  if (left > 0 && left < 4) fb.r(x, y + 5 - left, 4, 1, '#a9dbf7')
  // Nearly empty: the last of the water blinks.
  if (left <= 1) fb.r(x, y + 4, 4, 1, left === 1 && (f >> 1) % 2 ? '#79c4ef' : '#f08a8a')
}
/**
 * Empty coffee cups on the Manager's desk (their feet on row y, the first at x): two side by side, the next two piled
 * on them. Only two fit left of the "Claude" nameplate: a row of four painted over its letters.
 */
export function cups(fb: FB, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const cx = x + (i % 2) * 3
    const cy = y - (i >> 1) * 2
    fb.r(cx, cy - 1, 2, 2, '#f4f6f8')
    fb.r(cx, cy - 1, 2, 1, '#6b4535')
    fb.s(cx + 1, cy, '#d5d9e0')
  }
}
/**
 * The Typist's finished pages: a stack `n` high at the desk's left end, its lowest page on row y. (It starts above
 * the "Mary-Beth" nameplate's two rows: one row lower it painted over "Mar".)
 */
export function pages(fb: FB, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) fb.r(x, y - i, 3, 1, i % 2 ? '#e3e7ed' : '#fbfbf7')
  if (n) fb.s(x + 1, y - n + 1, '#b9bfc8')
}

/* ===== D: the cat ===== */

/** The napping cat's eyes, open and glowing in the dark (the cat's top-left at x, its feet at `feet`); a slow blink. */
export function catEyes(sc: Scene, x: number, feet: number, f: number): void {
  if ((f >> 2) % 9 === 8) return
  const glow = C('#d8ff7a')
  sc.fb.s(x + 1, feet - 1, glow)
  sc.fb.s(x + 2, feet - 1, glow)
}

/* ===== E: small moments ===== */

/** Sparkles around the rack's test lamp (lamp at x, y) for a pass. */
export function sparkle(fb: FB, x: number, y: number, f: number): void {
  const spots = [[-2, -3], [5, -2], [2, -5], [6, 3], [-3, 2], [1, 5]] as const
  spots.forEach(([a, b], i) => {
    const ph = (f + i * 2) % 6
    if (ph >= 3) return
    const c = ph === 1 ? '#ffffff' : '#ffe27a'
    fb.s(x + a, y + b, c)
    if (ph === 1) {
      fb.s(x + a - 1, y + b, '#ffe27a')
      fb.s(x + a + 1, y + b, '#ffe27a')
      fb.s(x + a, y + b - 1, '#ffe27a')
      fb.s(x + a, y + b + 1, '#ffe27a')
    }
  })
}
/** A sweat drop by the head of someone whose job failed (person's top-left at x, top). */
export function sweat(fb: FB, x: number, top: number, f: number): void {
  const k = f % 4
  fb.s(x - 1, top + 1 + k, '#ffffff')
  fb.s(x - 1, top + 2 + k, '#3aa0ff')
}
