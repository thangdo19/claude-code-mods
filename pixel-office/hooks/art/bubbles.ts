// Bubbles (approved art): thought, picture and word bubbles, white with cut corners and a soft shadow; and the
// napping Manager's "z z Z". Pure drawing.

import { plain } from '../labels'
import type { Tone } from '../office'
import { shade } from '../gfx/color'
import type { FB, Scene } from '../gfx/fb'
import { OUT, P } from './palette'

/*
 * Every bubble (approved round 4, "No outline, soft shadow"): plain white with its corners cut, and a soft shadow
 * under it and to its right: what is under it, a quarter darker. (A black outline looked ugly.)
 */
const dim = (fb: FB, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= fb.w || y >= fb.h) return
  const p = fb.p[y * fb.w + x]!
  fb.s(x, y, shade(p < 0 ? P.wall : p, 0.74))
}
/** A white box `w` × `h` with its corners cut, its shadow under and right of it. */
function roundBox(fb: FB, x: number, y: number, w: number, h: number): void {
  for (let i = x + 1; i <= x + w - 1; i++) dim(fb, i, y + h)
  for (let j = y + 1; j <= y + h - 1; j++) dim(fb, x + w, j)
  fb.r(x + 1, y, w - 2, h, '#ffffff')
  fb.r(x, y + 1, w, h - 2, '#ffffff')
}
/** One white dot of a bubble's tail, with its shadow. */
function tailDot(fb: FB, x: number, y: number): void {
  dim(fb, x + 1, y)
  dim(fb, x, y + 1)
  fb.s(x, y, '#ffffff')
}
/** The "…" in a thought bubble: soft gray (black read like a face). */
const DOTS = '#7d8aa0'

/**
 * The thought bubble, grown in `stage` steps so a short think never flashes it:
 * 1 a dot by the head, 2 a second dot, 3 the bubble.
 */
export function thinkBubble(fb: FB, x: number, y: number, f: number, stage = 3): void {
  const W = 9
  const H = 7
  x = Math.max(0, Math.min(x, fb.w - W))
  if (stage <= 0) return
  if (stage < 3) {
    tailDot(fb, x, y + H + 2)
    if (stage === 2) {
      tailDot(fb, x + 1, y + H)
      tailDot(fb, x + 2, y + H)
      roundBox(fb, x + 3, y + H - 3, 3, 3)
    }
    return
  }
  roundBox(fb, x, y, W, H)
  tailDot(fb, x + 1, y + H + 1)
  tailDot(fb, x, y + H + 2)
  const n = f % 4
  for (let i = 0; i < 3; i++) fb.s(x + 2 + i * 2, y + 3, i < n ? DOTS : '#d5d9e0')
}

/** A small bubble with a picture, not words: chatting, the meeting. Its tail points down at (cx, bottom). */
export function iconBubble(fb: FB, cx: number, bottom: number, icon: 'dots' | 'ha' | 'heart' | 'note' | 'bang' | 'ask' | 'check' | 'bulb'): void {
  const W = 7
  const H = 6
  const x = Math.max(0, Math.min(cx - 3, fb.w - W))
  const y = bottom - H - 1
  roundBox(fb, x, y, W, H)
  tailDot(fb, Math.max(x + 1, Math.min(cx, x + W - 2)), y + H)
  // (Soft gray "…": black dots in a white box read like a little face.)
  const ink: Record<string, string> = { dots: '#7d8aa0', ha: '#d9822b', heart: '#e04b4b', note: '#3a6fd6', bang: '#e04b4b', ask: '#3a6fd6', check: '#2f9e57' }
  const art: Record<string, string[]> = {
    dots: ['.....', '.....', '#.#.#', '.....'],
    ha: ['#.#..', '###.#', '#.#.#', '....#'],
    heart: ['##.##', '#####', '.###.', '..#..'],
    note: ['..##.', '..#.#', '###..', '##...'],
    bang: ['..#..', '..#..', '.....', '..#..'],
    ask: ['.###.', '...#.', '..#..', '..#..'],
    check: ['....#', '...#.', '#.#..', '.#...'],
  }
  // The lightbulb (approved round 6): an idea, yellow glass on a gray screw base.
  if (icon === 'bulb') {
    ;['.###.', '##o##', '.###.', '..g..'].forEach((r, j) =>
      Array.from(r).forEach((ch, i) => ch !== '.' && fb.s(x + 1 + i, y + 1 + j, ch === 'g' ? '#8d97a4' : ch === 'o' ? '#fff6c8' : '#f2b33d')),
    )
    return
  }
  ;(art[icon] ?? []).forEach((r, j) => Array.from(r).forEach((ch, i) => ch === '#' && fb.s(x + 1 + i, y + 1 + j, ink[icon] ?? OUT)))
}

/** "z z Z" rising from the napping Manager: the big Z's top-left 2 px right of (x, y), the small z's under it. */
export function zzz(fb: FB, x0: number, y0: number, f: number): void {
  const small = ['####', '..#.', '.#..', '####']
  const big = ['#####', '...#.', '..#..', '.#...', '#####']
  const marks = [[0, 13, small], [1, 7, small], [2, 0, big]] as const
  const n = 1 + (f % 3)
  marks.slice(0, n).forEach(([dx, dy, g]) => {
    const x = x0 + dx
    const y = y0 + dy
    g.forEach((r, j) => Array.from(r).forEach((ch, i) => ch === '#' && fb.s(x + i + 1, y + j + 1, '#2b3550')))
    g.forEach((r, j) => Array.from(r).forEach((ch, i) => ch === '#' && fb.s(x + i, y + j, '#ffffff')))
  })
}

const BUBBLE_INK: Record<Tone, string> = { '': '#2a2230', idle: '#2a2230', warn: '#b45309', bad: '#c62828', good: '#1f7a3f' }

/** A white bubble with up to 10 ASCII characters, its tail pointing down at (cx, row*2+5); it starts at `minX` or right of it. */
export function textBubble(sc: Scene, cx: number, row: number, words: string, tone: Tone, minX = 0): void {
  const fb = sc.fb
  const flat = plain(words).replace(/…/g, '..').replace(/×/g, 'x').replace(/[^\x20-\x7e]/g, '?')
  const str = flat.length <= 10 ? flat : flat.slice(0, 8) + '..'
  const w = str.length
  const y = row * 2
  const x = Math.min(fb.w - w - 2, Math.max(2, minX, cx - Math.floor(w / 2)))
  const tx = Math.max(x, Math.min(cx, x + w - 1))
  sc.cover(x - 2, y - 2, x + w + 2, y + 6)
  roundBox(fb, x - 2, y - 2, w + 4, 6)
  tailDot(fb, tx, y + 4)
  tailDot(fb, tx, y + 5)
  sc.text(x, row, str, BUBBLE_INK[tone], '#ffffff')
}
