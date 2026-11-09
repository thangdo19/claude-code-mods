// The holiday decorations (approved rounds 6 and 7): along the top of the wall, by the plant on the Manager's desk,
// in the window, on the door, on the Manager's desk front, and the plant corner dressed for the season (the Christmas
// fir, gifts, the poinsettia, the Easter bunny, a turkey). Flat, bright, made of what the office already has. Pure
// drawing; which ones show on a date is `decorAt` in world.ts, where they go is in `layout.ts`.

import type { FB } from '../gfx/fb'
import type { Decor, DeskDecor, Wall } from '../world'
import { art, bush, fern, wateringCan } from './extras'
import { P } from './palette'

const LIGHTS = ['#ff5050', '#ffd84a', '#5fb8ff', '#5ff08a']
const CONF = ['#e04b4b', '#ffd84a', '#3a6fd6', '#2f9e57', '#ffffff', '#d787af', '#f08a24']

/* ===== the wall ===== */

/**
 * Along the top of the wall (rows 0–1; a few drops on row 2, clear of the board from x `board[0]` to `board[1]`),
 * never where `skip` says (the frame, the rack, the window). Tết adds its two lanterns.
 */
export function wallDecor(
  fb: FB, kind: Wall, f: number, skip: (x: number) => boolean, board: readonly [number, number], lanterns: readonly { x: number; y: number }[],
): void {
  const px = (x: number, y: number, c: string) => {
    if (x >= 0 && x < fb.w && !skip(x) && !(y >= 2 && x >= board[0] - 1 && x <= board[1] + 1)) fb.s(x, y, c)
  }
  const w = fb.w
  switch (kind) {
    case 'halloween':
      // Orange and purple bunting (approved round 6).
      for (let x = 0; x < w; x++) px(x, 0, '#4a3510')
      for (let x = 1; x < w - 1; x += 3) {
        if (skip(x) || skip(x + 1)) continue
        const c = Math.floor(x / 3) % 2 ? '#7b4bb5' : '#f08a24'
        px(x, 1, c)
        px(x + 1, 1, c)
      }
      break
    case 'tet':
      // A red string with gold beads and two red lanterns (approved round 6).
      for (let x = 0; x < w; x++) px(x, 0, '#c62828')
      for (let x = 1; x < w - 1; x += 3) if (!skip(x + 1) && Math.floor(x / 3) % 2) px(x, 1, '#e8c25a')
      for (const { x: lx, y: ly } of lanterns) {
        if (skip(lx)) continue
        art(fb, lx, ly, ['.g.', 'rrr', (f >> 2) % 2 ? 'rRr' : 'rrr', 'rrr', '.g.'], { g: '#e8c25a', r: '#d62828', R: '#ff6b5a' })
      }
      break
    case 'garland':
      // A fir garland with a light every 3 px (low and high in turn), blinking, and a red bow every 16 px.
      for (let x = 0; x < w; x++) {
        px(x, 0, x % 2 ? '#2f6b3a' : '#3f8f4c')
        px(x, 1, x % 3 === 1 ? '#3f8f4c' : '#2f6b3a')
      }
      for (let x = 1; x < w; x += 3) {
        const k = (x / 3) | 0
        px(x, 1 + (k % 2), (k + (f >> 1)) % 3 ? LIGHTS[k % 4]! : '#3b414d')
      }
      for (let x = 7; x < w; x += 16) {
        px(x - 1, 0, '#d63a3a')
        px(x + 1, 0, '#d63a3a')
        px(x, 1, '#a82a2a')
      }
      break
    case 'tinsel':
      // Gold and silver tinsel, twinkling.
      for (let x = 0; x < w; x++) {
        px(x, 0, (x >> 1) % 2 ? '#e8c25a' : '#d9dee6')
        if ((x + (f >> 1)) % 6 === 0) px(x, 1, '#ffffff')
        else if (x % 3 === 0) px(x, 1, x % 2 ? '#e8c25a' : '#c9cfd8')
      }
      break
    case 'hearts':
      for (let x = 0; x < w; x++) px(x, 0, '#c94f6d')
      for (let x = 1; x < w - 2; x += 5) {
        const c = ((x / 5) | 0) % 2 ? '#ff8fb1' : '#e04b6b'
        for (const [a, b] of [[0, 1], [1, 1], [2, 1], [1, 2]] as const) px(x + a, b, c)
      }
      break
    case 'shamrock':
      // Shamrocks with a gold coin between, twinkling.
      for (let x = 0; x < w; x++) px(x, 0, '#2f7d44')
      for (let x = 1; x < w - 2; x += 5) {
        px(x, 1, '#3fae5a')
        px(x + 2, 1, '#3fae5a')
        px(x + 1, 1, '#2f8a48')
        px(x + 1, 2, '#2f8a48')
        px(x + 3, 1, (x + (f >> 1)) % 4 ? '#e8c25a' : '#fff3c4')
      }
      break
    case 'eggs': {
      const pastel = ['#ffb3c8', '#a8d8ff', '#fff0a0', '#b8f0b0', '#d9c2ff']
      for (let x = 0; x < w; x++) px(x, 0, '#c9ced6')
      for (let x = 1; x < w - 1; x += 4) {
        const c = pastel[((x / 4) | 0) % pastel.length]!
        for (const [a, b] of [[0, 1], [1, 1], [0, 2], [1, 2]] as const) px(x + a, b, c)
      }
      break
    }
    case 'usa':
      // Red, white and blue bunting: a blue band with white stars, red and white below, a fan now and then.
      for (let x = 0; x < w; x++) {
        px(x, 0, x % 3 === 1 ? '#ffffff' : '#2c4a9a')
        px(x, 1, (x >> 1) % 2 ? '#ffffff' : '#d63a3a')
      }
      for (let x = 2; x < w; x += 6) {
        px(x, 2, '#d63a3a')
        px(x + 1, 2, '#ffffff')
        px(x + 2, 2, '#d63a3a')
      }
      break
    case 'leaves': {
      const fall = ['#e07a2e', '#c9452e', '#e8b23a', '#8a5a32']
      for (let x = 0; x < w; x++) px(x, 0, '#7a5230')
      for (let x = 0; x < w; x += 2) {
        const c = fall[(x / 2) % 4]!
        px(x, 1, c)
        if ((x / 2) % 3 === 1) px(x + 1, 2, c)
      }
      break
    }
  }
}

/* ===== the Manager's desk ===== */

/** By the plant on the Manager's desk (the plant's top-left at x, y). */
export function deskDecor(fb: FB, x: number, y: number, kind: DeskDecor, f: number): void {
  const flag = (rows: string[]) => {
    fb.r(x + 5, y - 2, 1, 6, '#8d97a5')
    art(fb, x + 6, y - 2, rows, { B: '#2c4a9a', r: '#d63a3a', w: '#ffffff' })
  }
  switch (kind) {
    case 'pumpkin':
      // A jack-o'-lantern by the plant (approved round 6).
      art(fb, x - 4, y + 3, ['..g..', '.ooo.', 'oyoyo', 'ooooo'], { o: '#f08a24', g: '#2f7d44', y: f % 2 ? '#ffd23f' : '#f2b33d' })
      break
    case 'xmas':
      // A star and lights on the plant (approved round 6).
      fb.s(x + 2, y - 1, '#ffd84a')
      ;[[1, 1], [3, 1], [0, 2], [4, 2], [2, 3]].forEach(([a = 0, b = 0], k) => fb.s(x + a, y + b, (k + f) % 3 ? ['#ff5050', '#ffd84a', '#5fb8ff'][k % 3]! : P.plant))
      break
    case 'tet':
      // Peach blossom and a red envelope (approved round 6).
      ;[[2, 0], [1, 1], [3, 1], [0, 2], [4, 2], [2, 2]].forEach(([a = 0, b = 0], k) => fb.s(x + a, y + b, k % 2 ? '#ffd6e5' : '#f7a8c4'))
      fb.r(x + 3, y + 2, 2, 2, '#d62828')
      fb.s(x + 3, y + 2, '#e8c25a')
      break
    case 'flag':
      flag(['BBrrr', 'Bwwww', 'rrrrr'])
      break
    case 'juneteenth':
      // The Juneteenth flag: blue over red, a white star across the middle.
      flag(['BBBBB', 'BBwBB', 'rwwwr', 'rrrrr'])
      break
    case 'rose':
      art(fb, x + 1, y - 1, ['.r.', 'rRr'], { r: '#e04b6b', R: '#a8243f' })
      art(fb, x - 4, y + 3, ['p.p', 'ppp', '.p.'], { p: (f >> 2) % 2 ? '#ff8fb1' : '#e04b6b' })
      break
    case 'clover':
      art(fb, x + 1, y - 2, ['g.g', '.g.', '.d.'], { g: '#3fae5a', d: '#2f7d44' })
      break
    case 'confetti':
      // Streamers over the plant, confetti falling.
      for (const [a, b, c] of [[0, 1, '#e8c25a'], [1, 2, '#d9dee6'], [3, 1, '#e8c25a'], [4, 2, '#d9dee6']] as const) fb.s(x + a, y + b, c)
      for (let i = 0; i < 5; i++) fb.s(x - 1 + ((i * 3 + (f >> 1)) % 7), y - 4 + ((f + i * 2) % 5), CONF[i % CONF.length]!)
      break
    case 'leaf':
      for (const [a, b, c] of [[0, 2, '#e07a2e'], [4, 2, '#c9452e'], [2, 0, '#e8b23a']] as const) fb.s(x + a, y + b, c)
      break
  }
}

/** Three stockings hanging on the Manager's desk front, at `xs` from row `y`. */
export function stockings(fb: FB, xs: readonly number[], y: number): void {
  xs.forEach((sx, i) => art(fb, sx, y, ['ww.', 'cc.', 'cc.', 'ccc'], { w: '#f4f6f8', c: i % 2 ? '#2f8a4a' : '#d63a3a' }))
}

/* ===== the window, the door ===== */

/** Over the window's panes (its frame at x, y, w × h): falling snow (snow on the sill), fireworks, a rainbow. */
export function windowFx(fb: FB, x: number, y: number, w: number, h: number, kind: 'snow' | 'fireworks' | 'rainbow', f: number): void {
  const ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2
  fb.clip = [ix, iy, ix + iw - 1, iy + ih - 1]
  if (kind === 'snow') {
    for (let i = 0; i < 6; i++) fb.s(ix + ((i * 3 + (f >> 2)) % iw), iy + ((f + i * 3) % ih), '#ffffff')
    fb.r(ix, iy + ih - 1, iw, 1, '#f4f8fc')
  } else if (kind === 'fireworks') {
    // A burst grows in the top pane, then in the bottom one.
    const p = f % 8
    const cx = ix + (p < 4 ? 1 : 2)
    const cy = iy + (p < 4 ? 2 : 6)
    const c = CONF[(f >> 3) % CONF.length]!
    const r = p % 4
    const dots: readonly (readonly [number, number])[] =
      r === 0 ? [[0, 1]] : r === 1 ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] : r === 2 ? [[1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]] : [[2, 2], [-2, -2], [2, -2], [-2, 2]]
    for (const [a, b] of dots) fb.s(cx + a, cy + b, r === 0 ? '#fff3c4' : c)
  } else {
    const bands = ['#e04b4b', '#f08a24', '#ffd84a', '#2f9e57', '#3a6fd6']
    for (let k = 0; k < bands.length; k++) for (let j = 0; j < iw; j++) fb.s(ix + j, iy + ih - 1 - k - (j === 0 || j === iw - 1 ? 0 : 1), bands[k]!)
  }
  fb.clip = null
  if (kind === 'snow') fb.r(x - 1, y + h, w + 2, 1, '#f4f8fc')
}

/** A wreath on the closed door, its top-left at (x, y). */
export function wreath(fb: FB, x: number, y: number): void {
  art(fb, x, y, ['.gGg.', 'g...G', 'G...g', '.gRg.', '.R.R.'], { g: '#2f7d44', G: '#3f9b56', R: '#d63a3a' })
  fb.s(x + 1, y, '#d63a3a')
  fb.s(x + 4, y + 2, '#d63a3a')
}

/* ===== the plant corner ===== */

const TREE = [
  '....g....',
  '...gGg...',
  '..gGgGg..',
  '...gGg...',
  '..gGgGg..',
  '.gGgGgGg.',
  '..gGgGg..',
  '.gGgGgGg.',
  'gGgGgGgGg',
  '.gGgGgGg.',
  'gGgGgGgGg',
  'GgGgGgGgG',
]
const TREE_LIGHTS: readonly (readonly [number, number])[] = [[3, 45], [5, 45], [2, 47], [6, 47], [4, 48], [1, 49], [7, 49], [3, 50], [5, 50], [0, 51], [8, 51], [2, 52], [6, 52], [4, 53]]
const ORNAMENTS: readonly (readonly [number, number, string])[] = [[4, 46, '#e04b4b'], [3, 49, '#e8c25a'], [6, 50, '#5fb8ff'], [5, 52, '#e04b4b'], [1, 53, '#e8c25a'], [7, 53, '#5fb8ff'], [2, 50, '#d9c2ff']]
/** Gifts under the tree: x, y, width, height, paper, ribbon. */
const GIFTS: readonly (readonly [number, number, number, number, string, string])[] = [
  [7, 58, 3, 3, '#d63a3a', '#e8c25a'], [0, 58, 2, 3, '#3a6fd6', '#ffffff'], [9, 59, 3, 2, '#7b4bb5', '#ffd84a'], [3, 59, 3, 2, '#2f9e57', '#d63a3a'],
]

/**
 * The plant corner dressed for the season (desk 0, from x = dx; approved round 7): the fir in place of the fern (bare,
 * with lights, with ornaments and a star), the bush as a poinsettia, gifts under the tree; a turkey, an Easter basket
 * or a pot of gold between the pots; at Easter a bunny behind the bush and eggs by the pots. The watering can waits
 * on the floor when nothing stands there.
 */
export function plantCorner(fb: FB, dx: number, f: number, watering: boolean, d: Decor): void {
  if (d.tree) {
    art(fb, dx, 43, TREE, { g: '#2e7a42', G: P.plant })
    fb.s(dx + 4, 55, '#7a4a2a')
    fb.r(dx + 2, 56, 5, 5, P.pot)
    fb.r(dx + 2, 56, 5, 1, '#cf7a4a')
    fb.r(dx + 2, 61, 5, 1, P.shadow)
    if (d.tree >= 2)
      TREE_LIGHTS.forEach(([a, b], i) => {
        if ((i + (f >> 1)) % 3) fb.s(dx + a, b, LIGHTS[i % 4]!)
      })
    if (d.tree >= 3) {
      for (const [a, b, c] of ORNAMENTS) fb.s(dx + a, b, c)
      art(fb, dx + 3, 41, ['.z.', 'zZz'], { z: '#ffd84a', Z: f % 2 ? '#ffffff' : '#fff3c4' })
    }
  } else fern(fb, dx)
  bush(fb, dx, f, d.poinsettia)
  for (const [a, b, gw, gh, c, rb] of GIFTS.slice(0, d.gifts)) {
    fb.r(dx + a, b, gw, gh, c)
    fb.r(dx + a + (gw >> 1), b, 1, gh, rb)
    fb.s(dx + a + (gw >> 1), b - 1, rb)
  }
  if (d.floor === 'turkey')
    art(fb, dx + 6, 55, ['.ror.', 'royor', 'rBkBr', '.BYB.', '.BRB.', '.Y.Y.'], {
      r: '#c9452e', o: '#e07a2e', y: '#e8b23a', B: '#7a4a2a', k: '#2a2230', Y: '#f2b33d', R: '#e04b4b',
    })
  else if (d.floor === 'basket')
    art(fb, dx + 6, 57, ['..W..', '.W.W.', 'pbygp', 'WWWWW', '.WWW.'], { W: '#b07a45', p: '#ffb3c8', b: '#a8d8ff', y: '#fff0a0', g: '#b8f0b0' })
  else if (d.floor === 'gold') {
    art(fb, dx + 6, 57, ['.zZz.', 'zZzZz', 'kkkkk', '.kkk.'], { z: '#ffd84a', Z: '#e8c25a', k: '#2a2a30' })
    if ((f >> 1) % 4 === 0) fb.s(dx + 8, 56, '#ffffff')
  }
  if (d.eggs) {
    art(fb, dx + 13, 44, ['.w.w.', '.w.w.', 'wwwww', 'wkwkw', '.wnw.'], { w: '#f4f6f8', k: '#2a2230', n: '#ff8fb1' })
    for (const [a, c] of [[0, '#ffb3c8'], [5, '#a8d8ff']] as const) fb.r(dx + a, 60, 2, 1, c)
  }
  if (!watering && !d.gifts && !d.floor) wateringCan(fb, dx + (d.tree ? 7 : 6))
}
