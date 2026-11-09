// The art round 6 added (approved round 6): the cat, the printer, the test lamp, the party, employee of the month, the
// window by the time of day, hold music, the video-call screen, the board doodles, the parcel, paper planes and the
// plant corner. (The holidays are in holidays.ts.) Flat, bright, the same palette. Pure drawing; where each goes is in `layout.ts`.

import type { FB } from '../gfx/fb'
import { P } from './palette'
import type { CatPose } from '../cat'

/** A pixel picture from rows of letters ('.' is nothing); `pal` gives each letter's color. Mirrored with `flip`. */
export function art(fb: FB, x: number, y: number, rows: readonly string[], pal: Record<string, string>, flip = false): void {
  rows.forEach((r, j) => {
    const n = r.length
    for (let i = 0; i < n; i++) {
      const ch = r[i]!
      if (ch !== '.' && pal[ch]) fb.s(flip ? x + n - 1 - i : x + i, y + j, pal[ch])
    }
  })
}

/* ===== the cat ===== */

const CAT = { o: '#f0a050', d: '#c06a2a', k: '#2a2230', n: '#f08aa0', w: '#fff1e0' }
const CAT_WALK = [
  ['.......d.d', 'd......ooo', '.d.ooooook', '..oooooo..', '..o.o..o.o'],
  ['.......d.d', '.d.....ooo', 'd..ooooook', '..oooooo..', '...o.o.o..'],
]
const CAT_SIT = ['d...d', 'ooooo', 'okoko', '.ono.', 'ooooo', 'ow.wo']
const CAT_NAP = ['.d.d....', '.oooood.', 'okkooooo', 'oooooodo']

/** The cat with its feet at (x, feet): walking (facing right or left), sitting, or napping (with z's). */
export function cat(fb: FB, x: number, feet: number, pose: CatPose, right: boolean, step: number, f: number): void {
  if (pose === 'walk') art(fb, x - 1, feet - 4, CAT_WALK[step % 2]!, CAT, !right)
  else if (pose === 'sit') {
    art(fb, x + 1, feet - 5, CAT_SIT, CAT)
    // The tail flicks now and then.
    fb.s(x + 6, feet - 1 - ((f >> 2) % 2), CAT.d)
  } else {
    art(fb, x, feet - 3, CAT_NAP, CAT)
    if ((f >> 1) % 3) fb.s(x + 7, feet - 1, CAT.d)
    const z = f % 8
    fb.s(x + 8 + (z >> 2), feet - 5 - (z >> 1), '#ffffff')
  }
}

/* ===== the printer ===== */

export function printer(fb: FB, x: number, y: number, mode: 'idle' | 'print' | 'jam', f: number): void {
  fb.r(x, y, 7, 1, '#c9ced6')
  fb.r(x, y + 1, 7, 8, '#e6e9ee')
  fb.r(x + 6, y + 1, 1, 8, '#cfd4dc')
  fb.r(x + 1, y + 3, 5, 1, '#3b414d')
  fb.r(x, y + 6, 7, 1, '#cfd4dc')
  fb.r(x, y + 8, 7, 1, '#9aa3ae')
  // A stack of paper on top.
  fb.r(x + 1, y - 1, 4, 1, '#fbfbf7')
  const light = mode === 'jam' ? (f % 2 ? P.red : '#7a2222') : mode === 'print' ? (f % 2 ? '#3fd273' : '#1f7a3f') : '#3fd273'
  fb.s(x + 5, y + 1, light)
  if (mode === 'print') {
    // The page comes out of the slot.
    const h = 1 + (f % 4)
    fb.r(x + 1, y + 4, 5, h, '#fbfbf7')
    for (let j = 1; j < h; j += 2) fb.r(x + 2, y + 4 + j, 3, 1, '#c9ced6')
  } else if (mode === 'jam') {
    // A crumpled page and smoke.
    fb.r(x + 2, y + 4, 3, 1, '#fbfbf7')
    fb.s(x + 3, y + 5, '#d5d9e0')
    for (let i = 0; i < 3; i++) {
      const sy = y - 2 - ((f + i * 3) % 7)
      fb.r(x + 1 + i * 2, sy, 2, 2, i % 2 ? '#b8bec8' : '#9aa3ae')
    }
  }
}

/* ===== the test lamp ===== */

export function testLamp(fb: FB, x: number, y: number, state: 'off' | 'run' | 'pass' | 'fail', f: number): void {
  const on = f % 2 === 0
  const c =
    state === 'pass' ? (on ? '#5ff08a' : '#3fd273') : state === 'fail' ? (on ? '#ff5050' : '#a52a2a') : state === 'run' ? (on ? '#ffc94a' : '#8a6a1a') : '#454b57'
  // A dark panel with a wide lamp across it.
  fb.r(x - 1, y - 1, 6, 4, '#1d2129')
  fb.r(x, y, 4, 2, c)
  if (state !== 'off' && on) fb.r(x + 1, y, 2, 1, state === 'pass' ? '#c8ffd8' : state === 'fail' ? '#ffc8c8' : '#fff0b8')
}

/* ===== the party ===== */

const CONF = ['#e04b4b', '#ffd84a', '#3a6fd6', '#2f9e57', '#ffffff', '#d787af', '#f08a24']
export function confetti(fb: FB, f: number): void {
  for (let i = 0; i < 44; i++) {
    const x = (i * 37 + 11 + (((f >> 1) + i) % 3 === 0 ? 1 : 0)) % fb.w
    const y = (i * 23 + f * (1 + (i % 2))) % fb.h
    fb.s(x, y, CONF[i % CONF.length]!)
  }
}
export function cake(fb: FB, x: number, y: number, f: number): void {
  fb.r(x, y + 6, 7, 1, '#f4f6f8')
  fb.r(x + 1, y + 3, 5, 3, '#f2a7c3')
  fb.r(x + 1, y + 3, 5, 1, '#fff3f6')
  fb.r(x + 1, y + 5, 5, 1, '#e8869f')
  fb.s(x + 2, y + 4, '#e04b4b')
  fb.s(x + 4, y + 4, '#e04b4b')
  fb.r(x + 3, y + 1, 1, 2, '#f4f6f8')
  fb.s(x + 3, y, f % 2 ? '#ffd84a' : '#f2b33d')
}

/* ===== employee of the month ===== */

/** The gold frame (7 × 8); `face` draws the winner inside (clipped to the frame's inside). */
export function starFrame(fb: FB, x: number, y: number, f: number, face: ((fb: FB) => void) | null): void {
  fb.r(x, y, 7, 8, '#c9a227')
  fb.r(x, y, 7, 1, '#e8c25a')
  fb.r(x + 1, y + 1, 5, 6, face ? '#f6e7b0' : '#e9dcae')
  if (face) {
    fb.clip = [x + 1, y + 1, x + 5, y + 6]
    face(fb)
    fb.clip = null
  } else art(fb, x + 2, y + 2, ['.y.', 'yyy', '.y.'], { y: '#c9a227' })
  // A twinkle on the corner.
  if ((f >> 1) % 4 !== 3) fb.s(x + 6, y, '#fff6c8')
}

/* ===== the window by the time of day ===== */

export function skyPane(fb: FB, x: number, y: number, w: number, h: number, sky: 'morning' | 'day' | 'sunset' | 'night', f: number): void {
  fb.r(x, y, w, h, '#eef1f4')
  const ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2
  fb.clip = [ix, iy, ix + iw - 1, iy + ih - 1]
  if (sky === 'morning') {
    fb.r(ix, iy, iw, ih, '#ffe2c0')
    fb.r(ix, iy, iw, 3, '#ffc58f')
    fb.r(ix, iy + ih - 2, 2, 2, '#ffd23f')
    fb.r(ix + ((f >> 2) % (iw + 4)) - 2, iy + 2, 3, 1, '#ffffff')
  } else if (sky === 'day') {
    fb.r(ix, iy, iw, ih, P.sky)
    fb.r(ix + iw - 2, iy, 2, 2, '#ffd23f')
    const cx = ix + ((f >> 1) % (iw + 5)) - 3
    fb.r(cx, iy + 3, 3, 1, P.cloud)
    fb.s(cx + 1, iy + 2, P.cloud)
  } else if (sky === 'sunset') {
    fb.r(ix, iy, iw, 3, '#8b5fa8')
    fb.r(ix, iy + 3, iw, 2, '#e2738f')
    fb.r(ix, iy + 5, iw, ih - 5, '#ff9a6b')
    fb.r(ix + 1, iy + ih - 2, 2, 2, '#ffd23f')
  } else {
    fb.r(ix, iy, iw, ih, P.night)
    ;[[0, 1], [2, 3], [1, 5], [3, 6]].forEach(([a = 0, b = 0], k) => {
      if ((f + k) % 5) fb.s(ix + a, iy + b, P.star)
    })
    fb.r(ix + iw - 2, iy + 1, 2, 2, P.moon)
  }
  fb.clip = null
  fb.r(x, y + Math.floor(h / 2), w, 1, '#eef1f4')
  fb.r(x - 1, y + h, w + 2, 1, '#9aa3ae')
}

/* ===== hold music ===== */

export function holdNotes(fb: FB, x: number, y: number, f: number): void {
  for (let i = 0; i < 2; i++) {
    const t = (f + i * 4) % 8
    const nx = x + i * 3 + ((f >> 1) % 2)
    const ny = y - t
    art(fb, nx, ny - 2, ['.##', '.#.', '##.'], { '#': '#3a6fd6' })
  }
}

/* ===== the video call desk ===== */

/** The TV on the call desk: dark when nobody calls; else the caller's face (drawn by `face`, clipped to the screen). */
export function callScreen(fb: FB, dx: number, f: number, face: ((fb: FB) => void) | null): void {
  fb.r(dx + 2, 45, 11, 9, '#20242c')
  fb.r(dx + 2, 45, 11, 1, '#3c424e')
  fb.r(dx + 6, 54, 3, 1, '#20242c')
  if (!face) {
    fb.r(dx + 3, 46, 9, 7, '#3a4352')
    art(fb, dx + 6, 48, ['.#.', '###', '#.#'], { '#': '#4d5768' })
    return
  }
  fb.r(dx + 3, 46, 9, 7, '#cdeaf6')
  // Their room at home: a shelf behind them.
  fb.r(dx + 3, 48, 2, 1, '#b07a45')
  fb.s(dx + 10, 47, '#3f9b56')
  fb.s(dx + 10, 48, '#3f9b56')
  fb.clip = [dx + 3, 46, dx + 11, 52]
  face(fb)
  fb.clip = null
  // The red "live" dot.
  fb.s(dx + 11, 46, f % 2 ? '#e04b4b' : '#ff8a8a')
}

/* ===== the board doodles ===== */

/** The Manager's doodles on the board while thinking there (more the longer they stay). */
export function doodle(fb: FB, x: number, y: number, n: number): void {
  const marks: [number, number][] = [[0, 2], [1, 1], [2, 1], [3, 2], [4, 3], [6, 1], [7, 1], [7, 2], [6, 3], [8, 3], [2, 5], [3, 5], [4, 5], [5, 5], [9, 5], [10, 4], [11, 5]]
  for (let i = 0; i < Math.min(n, marks.length); i++) fb.s(x + marks[i]![0], y + marks[i]![1], i % 5 === 4 ? '#e04b4b' : '#3a6fd6')
}
/* ===== the parcel, the paper plane ===== */

/** A parcel held in front (person's top-left at x, top), its tape running on while it is packed. */
export function parcel(fb: FB, x: number, top: number, f: number, packing: boolean, skin: string): void {
  fb.r(x + 1, top + 6, 5, 3, '#c08a4e')
  fb.r(x + 1, top + 6, 5, 1, '#d9a566')
  fb.r(x + 3, top + 6, 1, 3, '#f0d08a')
  if (packing) fb.s(x + 1 + (f % 5), top + 6, '#fff3c4')
  fb.s(x, top + 7, skin)
  fb.s(x + 6, top + 7, skin)
}
export function plane(fb: FB, x: number, y: number, right: boolean): void {
  art(fb, Math.round(x), Math.round(y) - 1, ['#..', '###'], { '#': '#ffffff' }, !right)
  fb.s(Math.round(x) + (right ? 1 : 1), Math.round(y) + 1, '#d5d9e0')
}

/* ===== the plant corner ===== */

/** The plant corner: a tall fern and a round bush in the office's pots, a watering can on the floor (or in use). */
export function gardenArt(fb: FB, dx: number, f: number, watering: boolean): void {
  fern(fb, dx)
  bush(fb, dx, f, false)
  if (!watering) wateringCan(fb, dx + 6)
}
/** The plant corner's tall fern in its pot (desk 0 from x = dx). */
export function fern(fb: FB, dx: number): void {
  art(fb, dx, 44, ['..g..', '.gGg.', 'gGgGg', '.gGg.', 'gGgGg', 'GgGgG', '.gGg.', 'gGgGg', '.gGg.', 'gGgGg', '..G..', '..G..'], { g: P.plant, G: P.plant2 })
  fb.r(dx, 56, 5, 5, P.pot)
  fb.r(dx, 56, 5, 1, '#cf7a4a')
  fb.r(dx, 61, 5, 1, P.shadow)
}
/** The round bush in its pot: a pink flower, or red bracts as a poinsettia (approved round 7, Christmas). */
export function bush(fb: FB, dx: number, f: number, poinsettia: boolean): void {
  art(fb, dx + 10, 49, ['..ggg.', '.gGgGg', 'gGgGgG', 'GgGgGg', '.gGgG.', '..gG..'], { g: P.plant, G: P.plant2 })
  if (poinsettia) for (const [a, b] of [[12, 49], [14, 50], [11, 51], [13, 51], [15, 52], [12, 53]] as const) fb.s(dx + a, b, a === 13 ? '#ffd84a' : '#d62828')
  else fb.s(dx + 12 + (f >> 3) % 2, 50, '#ff8ad0')
  fb.r(dx + 11, 55, 5, 5, P.pot)
  fb.r(dx + 11, 55, 5, 1, '#cf7a4a')
  fb.r(dx + 11, 60, 5, 1, P.shadow)
}
/** The watering can, waiting on the floor. */
export function wateringCan(fb: FB, x: number): void {
  art(fb, x, 59, ['.LL.', 'LLLL', 'LLL.'], { L: '#3fa37a' })
}
