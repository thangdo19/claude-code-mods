// The big office's art (the design approved in the plan artifact): square pixels,
// two per terminal cell, people 7 × 13 pixels, furniture, bubbles. Pure drawing.

import type { Tone } from './office'

/** A color as #rrggbb or 0xRRGGBB. */
export type Paint = string | number

const cache = new Map<string, number>()
export const C = (v: Paint): number => {
  if (typeof v === 'number') return v
  let n = cache.get(v)
  if (n === undefined) {
    n = parseInt(v.slice(1), 16)
    cache.set(v, n)
  }
  return n
}
export const shade = (c: Paint, f: number): number => {
  const n = C(c)
  const ch = (s: number) => Math.min(255, Math.floor(((n >> s) & 255) * f))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
export const mix = (a: Paint, b: Paint, t: number): number => {
  const x = C(a)
  const y = C(b)
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** A grid of pixels, -1 where nothing is drawn. Two pixel rows make one terminal row. */
export class FB {
  readonly p: Int32Array
  clip: [number, number, number, number] | null = null
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.p = new Int32Array(w * h).fill(-1)
  }
  s(x: number, y: number, c: Paint | null | undefined): void {
    if (c == null) return
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    if (this.clip && (x < this.clip[0] || y < this.clip[1] || x > this.clip[2] || y > this.clip[3])) return
    this.p[y * this.w + x] = C(c)
  }
  r(x: number, y: number, w: number, h: number, c: Paint): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.s(x + i, y + j, c)
  }
}

/** A character drawn in one terminal cell (two pixel rows) over the pixels. */
export type TextCell = { x: number; row: number; ch: string; fg: number; bg: number }

export class Scene {
  readonly fb: FB
  readonly texts: TextCell[] = []
  constructor(w: number, h: number) {
    this.fb = new FB(w, h)
  }
  /** Printable ASCII only, so no character can be wider than its cell in any terminal. */
  text(x: number, row: number, str: string, fg: Paint, bg: Paint): void {
    let i = 0
    for (const raw of str) {
      const code = raw.charCodeAt(0)
      const ch = raw.length === 1 && code >= 0x20 && code <= 0x7e ? raw : '?'
      if (x + i >= 0 && x + i < this.fb.w) this.texts.push({ x: x + i, row, ch, fg: C(fg), bg: C(bg) })
      i++
    }
  }
}

export const OUT = '#1d2129'
export const P = {
  wall: '#c6ceda', wall2: '#bac3cf', base: '#4d5563', baseHi: '#646d7c', floor: '#66728a', floor2: '#5e6982', seam: '#535d74',
  woodTop: '#d49b5f', wood: '#b07a45', front: '#9a6a3c', drawer: '#7c5430', shadow: '#5a3a22',
  mon: '#262a33', monHi: '#3c424e', screen: '#79d0ea', screenOff: '#3a4352', code: '#effcff',
  sky: '#8fd0f2', cloud: '#ffffff', night: '#1a2242', star: '#fff4b8', moon: '#f3eeda',
  board: '#f4f6f8', boardFrame: '#8d97a4', ink: '#3a6fd6', red: '#e04b4b', green: '#2f9e57', amber: '#f2b33d',
  rack: '#2d323c', rack2: '#3b414d', cab: '#8a96a5', cab2: '#76828f', cabHi: '#a6b1be', handle: '#d7dde4',
  door: '#8c5d3b', door2: '#7a5032', doorFrame: '#5f4029', doorHi: '#a06c46', knob: '#e6c35c',
  plant: '#3f9b56', plant2: '#2f7d44', pot: '#b8653a', chair: '#5a3a2c', chair2: '#6b4535', chairS: '#383c46', chairS2: '#474c58',
  gold: '#e8c25a', spot: '#ffd84a',
} as const

/* ===== people: 7 wide, 13 tall ===== */

const SPR = ['..hhh..', '.hHhhh.', '.hsssh.', '.seseS.', '..sms..', '.ckTkc.', 'cccTccC', 'cccTccC', 's.ccC.s', '..ppP..', '..p.P..', '..p.P..', '.ff.ff.']

export type Look = {
  pal: Record<string, number>
  style?: 'long' | 'bun' | 'cap'
  glasses?: boolean
  headset?: boolean
  badge?: boolean
  bag?: boolean
  tie?: boolean
}
type LookDef = { skin: string; hair: string; shirt: string; inner?: string; tie?: string; pants?: string; cap?: string } & Omit<Look, 'pal' | 'tie'>

const look = (d: LookDef): Look => {
  const inner = d.inner ?? '#f4f4f4'
  const pants = d.pants ?? '#2f3443'
  return {
    style: d.style, glasses: d.glasses, headset: d.headset, badge: d.badge, bag: d.bag, tie: d.tie !== undefined,
    pal: {
      h: C(d.hair), H: shade(d.hair, 1.45), s: C(d.skin), S: shade(d.skin, 0.86), e: C(OUT), m: mix(d.skin, '#a8434a', 0.45),
      c: C(d.shirt), C: shade(d.shirt, 0.78), k: C(inner), T: C(d.tie ?? inner), p: C(pants), P: shade(pants, 0.75), f: C('#1a1d24'),
      g: C('#2b2f38'), G: C('#bfe3ff'), w: C('#ffffff'), K: C('#6b4226'), B: C('#7a4a2a'), q: C(d.cap ?? d.hair), y: C('#e8c47a'), Y: C('#c9a256'),
      r: C('#e04b4b'), n: C('#d4ecff'), M: C('#9aa3ae'), W: C('#8a5a32'), Z: C('#d9b75e'), v: C('#e3e8ee'),
    },
  }
}

export const LOOK = {
  manager: look({ skin: '#f1c7a2', hair: '#3a2a1e', shirt: '#2c3550', tie: '#d97757', pants: '#232a3d' }),
  archivist: look({ skin: '#d9a47e', hair: '#d3d3d8', style: 'bun', shirt: '#8a64bd', inner: '#efe6d6', pants: '#3d3550', glasses: true }),
  typist: look({ skin: '#f2cfb0', hair: '#b8452e', style: 'long', shirt: '#e07fa6', inner: '#fff0f5', pants: '#3b3f4f' }),
  it: look({ skin: '#8d5a3b', hair: '#1e1a17', shirt: '#3a9a84', inner: '#2f7566', pants: '#2b2f3a', headset: true }),
  courier: look({ skin: '#e8b58e', hair: '#6b3e1e', style: 'cap', cap: '#e8a33d', shirt: '#d0603c', inner: '#f2e2c4', pants: '#3b4a6b', bag: true }),
  janitor: look({ skin: '#c98f6a', hair: '#4a3a2a', style: 'cap', cap: '#2f5f9e', shirt: '#3c6fb4', inner: '#e8eef7', pants: '#335f9c' }),
  sec: [
    look({ skin: '#f3d0b4', hair: '#2a1d14', style: 'long', shirt: '#2fa39a', badge: true }),
    look({ skin: '#c58a63', hair: '#151210', style: 'bun', shirt: '#9a6fd6', badge: true }),
    look({ skin: '#f0c9a8', hair: '#e2b85c', style: 'long', shirt: '#e58b3a', badge: true }),
    look({ skin: '#8e5b3c', hair: '#2b211a', shirt: '#4d86d9', badge: true, glasses: true }),
  ],
}
export const secLook = (n: number): Look => LOOK.sec[((n % 4) + 4) % 4] ?? LOOK.manager

export type Arms = 'down' | 'type' | 'up' | 'chin' | 'raise' | 'phone' | 'mug' | 'folder' | 'magnify' | 'point' | 'broom' | 'sleep' | 'walk'
export type PersonOpts = { f?: number; seat?: boolean; maxRow?: number; arms?: Arms; eyes?: 'closed'; smile?: boolean; seed?: number }

/** Draws a person with their top-left at (x, y). Seated people show rows 0–8 (the desk hides the rest). */
export function drawPerson(fb: FB, x: number, y: number, L: Look, o: PersonOpts = {}): void {
  const f = o.f ?? 0
  const g = new Map<string, string>()
  SPR.forEach((row, ry) => {
    if (o.seat && ry > 8) return
    if (o.maxRow !== undefined && ry > o.maxRow) return
    Array.from(row).forEach((ch, rx) => {
      if (ch !== '.') g.set(rx + ',' + ry, ch)
    })
  })
  const put = (px: number, py: number, ch: string) => g.set(px + ',' + py, ch)
  const del = (px: number, py: number) => g.delete(px + ',' + py)
  if (!L.tie) {
    put(3, 6, 'c')
    put(3, 7, 'c')
  }
  if (L.style === 'long') for (const [a, b] of [[1, 3], [5, 3], [1, 4], [5, 4], [0, 4], [6, 4], [0, 5], [6, 5]] as const) put(a, b, 'h')
  else if (L.style === 'bun') {
    put(2, -1, 'h')
    put(3, -1, 'H')
    put(4, -1, 'h')
    put(3, -2, 'h')
  } else if (L.style === 'cap') {
    for (let i = 2; i <= 4; i++) put(i, 0, 'q')
    for (let i = 1; i <= 6; i++) put(i, 1, 'q')
  }
  if (L.glasses) {
    put(2, 3, 'G')
    put(4, 3, 'G')
    put(3, 3, 'g')
  }
  if (L.headset) {
    for (let i = 1; i <= 5; i++) put(i, -1, 'g')
    for (const [a, b] of [[0, 2], [0, 3], [6, 2], [6, 3]] as const) put(a, b, 'g')
  }
  if (L.badge) put(5, 6, 'w')
  if (L.bag) for (const [a, b] of [[1, 5], [2, 6], [3, 7]] as const) put(a, b, 'B')
  const blink = (f + (o.seed ?? 0) * 5) % 19 === 0
  if ((o.eyes === 'closed' || blink) && !L.glasses) {
    put(2, 3, 'S')
    put(4, 3, 'S')
  }
  if (o.smile) {
    put(2, 4, 'm')
    put(4, 4, 'm')
  }
  switch (o.arms) {
    case 'type':
      del(0, 8)
      del(6, 8)
      if (f % 2) {
        put(1, 7, 's')
        put(5, 8, 's')
      } else {
        put(1, 8, 's')
        put(5, 7, 's')
      }
      break
    case 'up':
      for (const [a, b] of [[0, 6], [0, 7], [0, 8], [6, 6], [6, 7], [6, 8]] as const) del(a, b)
      for (let r = 3; r <= 5; r++) {
        put(0, r, 'c')
        put(6, r, 'C')
      }
      put(0, 2 - (f % 2), 's')
      put(6, 1 + (f % 2), 's')
      break
    case 'chin':
      del(6, 8)
      put(5, 4, 's')
      break
    case 'raise':
      del(6, 8)
      del(6, 7)
      for (let r = 3; r <= 5; r++) put(6, r, 'C')
      put(6 + (f % 2), 2, 's')
      break
    case 'phone':
      del(6, 8)
      put(6, 4, 's')
      put(6, 2, 'g')
      put(6, 3, 'g')
      break
    case 'mug':
      del(6, 8)
      put(7, 6, 's')
      put(7, 4, 'K')
      put(8, 4, 'K')
      put(7, 5, 'w')
      put(8, 5, 'w')
      put(7 + (f % 2), 2, 'v')
      put(8 - (f % 2), 1, 'v')
      break
    case 'folder':
      del(0, 8)
      del(6, 8)
      for (let xx = 1; xx <= 5; xx++) {
        put(xx, 6, 'y')
        put(xx, 7, 'y')
        put(xx, 8, 'Y')
      }
      put(1 + (f % 4), 6, 'w')
      put(0, 7, 's')
      put(6, 7, 's')
      break
    case 'magnify': {
      del(6, 8)
      const dx = f % 2
      put(6, 5, 's')
      put(7, 4, 'W')
      for (const [a, b] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]] as const) put(7 + a + dx, 1 + b, 'M')
      put(8 + dx, 2, 'n')
      break
    }
    case 'point':
      del(6, 8)
      del(6, 7)
      put(6, 5, 'C')
      put(6, 4, 'C')
      put(7, 3, 'C')
      put(8, 2, 's')
      put(9, 1, 'r')
      break
    case 'broom': {
      del(6, 8)
      put(6, 6, 's')
      for (const [a, b] of [[7, 4], [7, 5], [7, 6], [8, 7], [8, 8], [8, 9], [9, 10], [9, 11]] as const) put(a, b, 'W')
      const bx = f % 2
      for (let i = 0; i < 4; i++) put(8 + i + bx, 12, 'Z')
      put(9 + bx, 11, 'Z')
      put(10 + bx, 11, 'Z')
      break
    }
    case 'sleep':
      del(0, 8)
      del(6, 8)
      put(2, 7, 's')
      put(4, 7, 's')
      break
    case 'walk':
      if (f % 2) {
        for (const [a, b] of [[2, 10], [4, 10], [2, 11], [4, 11], [1, 12], [2, 12], [4, 12], [5, 12]] as const) del(a, b)
        for (const [a, b, ch] of [[2, 10, 'p'], [1, 11, 'p'], [4, 10, 'P'], [5, 11, 'P'], [0, 12, 'f'], [1, 12, 'f'], [5, 12, 'f'], [6, 12, 'f']] as const) put(a, b, ch)
        del(0, 8)
        put(0, 7, 's')
      }
      break
  }
  for (const [k, ch] of g) {
    const [px = 0, py = 0] = k.split(',').map(Number)
    const col = L.pal[ch]
    if (col !== undefined) fb.s(x + px, y + py, col)
  }
}

/* ===== furniture ===== */

export function room(fb: FB): void {
  fb.r(0, 0, fb.w, 19, P.wall)
  for (let x = 3; x < fb.w; x += 8) fb.r(x, 0, 1, 19, P.wall2)
  fb.r(0, 19, fb.w, 1, P.baseHi)
  fb.r(0, 20, fb.w, 1, P.base)
  for (let y = 21, k = 0; y < fb.h; y += 4, k++) {
    fb.r(0, y, fb.w, 4, k % 2 ? P.floor2 : P.floor)
    fb.r(0, y + 3, fb.w, 1, P.seam)
    for (let x = (k % 2) * 6; x < fb.w; x += 12) fb.r(x, y, 1, 3, P.seam)
  }
}
export function desk(fb: FB, x: number, y: number, w: number, h: number): void {
  fb.r(x, y, w, 1, P.woodTop)
  fb.r(x, y + 1, w, 1, P.wood)
  fb.r(x, y + 2, w, h - 3, P.front)
  fb.r(x + 1, y + 3, w - 2, 1, P.drawer)
  fb.r(x, y + h - 1, w, 1, P.shadow)
  fb.s(x + Math.floor(w / 2), y + 4, P.knob)
}
export function monitor(fb: FB, x: number, y: number, on: boolean, f: number): void {
  fb.r(x, y, 5, 4, P.mon)
  fb.r(x, y, 5, 1, P.monHi)
  if (on) {
    fb.r(x + 1, y + 1, 3, 2, P.screen)
    for (let i = 0; i < 3; i++) if ((f + i * 3 + x) % 4 < 2) fb.s(x + 1 + i, y + 1 + ((f + i) % 2), P.code)
  } else fb.r(x + 1, y + 1, 3, 2, P.screenOff)
  fb.s(x + 2, y + 4, P.mon)
  fb.r(x + 1, y + 5, 3, 1, P.mon)
}
export function officeChair(fb: FB, x: number, y: number, w: number, h: number): void {
  fb.r(x, y, w, h, P.chairS)
  fb.r(x + 1, y + 1, w - 2, h - 2, P.chairS2)
  fb.r(x + 1, y, w - 2, 1, '#5a5f6b')
}
export function typewriter(fb: FB, x: number, y: number, active: boolean, f: number): void {
  const len = active ? 1 + (f % 3) : 2
  fb.r(x + 1, y - 2 - len, 4, len + 1, '#fbfbf7')
  if (active) for (let i = 0; i < len; i++) fb.r(x + 2, y - 2 - len + i, 1 + ((i + f) % 2), 1, '#b9bfc8')
  fb.r(x, y - 2, 6, 2, '#3b404a')
  fb.r(x + 1, y - 2, 4, 1, '#5b6170')
  fb.s(x, y - 2, '#9aa3ae')
  fb.s(x + 5, y - 2, '#9aa3ae')
}
export function globe(fb: FB, x: number, y: number, active: boolean, f: number): void {
  const o = active ? f % 5 : 0
  const sea = '#3d7fd1'
  fb.r(x + 1, y, 3, 1, sea)
  fb.r(x, y + 1, 5, 3, sea)
  fb.r(x + 1, y + 4, 3, 1, sea)
  for (const [a, b] of [[1, 1], [2, 2], [3, 1], [0, 2], [4, 3], [2, 3]] as const) fb.s(x + ((a + o) % 5), y + b, '#4fae5a')
  fb.s(x + 1, y + 1, '#a8d4ff')
  fb.s(x + 2, y + 5, '#c9a24a')
  fb.r(x + 1, y + 6, 3, 1, P.shadow)
}
export function cabinet(fb: FB, x: number, y: number, w: number, h: number, open: boolean, f: number): void {
  fb.r(x, y, w, h, P.cab)
  fb.r(x, y, w, 1, P.cabHi)
  fb.r(x + w - 1, y + 1, 1, h - 1, P.cab2)
  const step = Math.floor((h - 1) / 3)
  for (let k = 0; k < 3; k++) {
    const dy = y + 1 + k * step
    fb.r(x, dy + step - 1, w, 1, P.cab2)
    fb.r(x + 1, dy + 1, w - 2, 1, P.handle)
  }
  if (open) {
    fb.r(x, y + 1, w, 3, '#566170')
    fb.s(x + 1, y - (f % 2), '#fbfbf7')
    fb.s(x + 2, y - ((f + 1) % 2), '#e85d5d')
  }
}
/** The server rack: green lights, fast while a command runs, red on a failure, one amber light per command left running. */
export function rack(fb: FB, x: number, y: number, w: number, h: number, mode: 'idle' | 'busy' | 'error', f: number, background: number): void {
  fb.r(x, y, w, h, P.rack)
  fb.r(x, y, w, 1, '#4a5160')
  let n = 0
  for (let r = y + 2; r < y + h - 1; r += 3) {
    fb.r(x + 1, r, w - 2, 2, P.rack2)
    for (let k = 0; k < 2; k++) {
      const i = n * 7 + k * 13
      let on: boolean
      let c: string = '#3fd273'
      if (mode === 'busy') on = (i + f * 5) % 3 !== 0
      else if (mode === 'error') {
        on = (f + k) % 2 === 0
        c = P.red
      } else on = i % 4 !== 0 && (f + i) % 9 !== 0
      fb.s(x + 1 + k * 2, r, on ? c : '#1f3a2a')
    }
    if (n < background) fb.s(x + w - 2, r, (f + n) % 2 ? P.amber : '#7a5a18')
    n++
  }
}
export function door(fb: FB, x: number, y: number, w: number, h: number, open: boolean): void {
  fb.r(x - 1, y - 1, w + 2, h + 1, P.doorFrame)
  if (open) {
    fb.r(x, y, w, h, '#241f2a')
    fb.r(x, y + h - 1, w, 1, '#3a3340')
    fb.r(x, y, 2, h, P.doorHi)
  } else {
    fb.r(x, y, w, h, P.door)
    fb.r(x + 1, y + 1, w - 2, h - 2, P.door2)
    fb.r(x + 2, y + 2, w - 4, 4, '#bfe0f0')
    fb.s(x + 2, y + 2, '#e8f6ff')
    fb.s(x + w - 2, y + Math.floor(h / 2) + 1, P.knob)
  }
}
export function windowPane(fb: FB, x: number, y: number, w: number, h: number, night: boolean, f: number): void {
  fb.r(x, y, w, h, '#eef1f4')
  const ix = x + 1
  const iy = y + 1
  const iw = w - 2
  const ih = h - 2
  fb.r(ix, iy, iw, ih, night ? P.night : P.sky)
  fb.clip = [ix, iy, ix + iw - 1, iy + ih - 1]
  if (night) {
    ;[[0, 1], [2, 3], [1, 5], [3, 6]].forEach(([a = 0, b = 0], k) => {
      if ((f + k) % 5) fb.s(ix + a, iy + b, P.star)
    })
    fb.r(ix + iw - 2, iy + 1, 2, 2, P.moon)
  } else {
    const cx = ix + ((f >> 1) % (iw + 5)) - 3
    fb.r(cx, iy + 2, 3, 1, P.cloud)
    fb.s(cx + 1, iy + 1, P.cloud)
  }
  fb.clip = null
  fb.r(x, y + Math.floor(h / 2), w, 1, '#eef1f4')
  fb.r(x - 1, y + h, w + 2, 1, '#9aa3ae')
}
export function clock(fb: FB, x: number, y: number, f: number): void {
  fb.r(x + 1, y, 3, 1, '#f6f7f9')
  fb.r(x, y + 1, 5, 3, '#f6f7f9')
  fb.r(x + 1, y + 4, 3, 1, '#f6f7f9')
  const hands = [[2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2], [1, 1]] as const
  const [a, b] = hands[(f >> 1) % 8] ?? hands[0]
  fb.s(x + 2, y + 1, OUT)
  fb.s(x + 2, y + 2, OUT)
  fb.s(x + a, y + b, P.red)
}
/** The to-do board: one line per task (green done, amber doing, blue next), or boxes and arrows in plan mode. */
export function board(fb: FB, x: number, y: number, w: number, h: number, todos: readonly ('done' | 'doing' | 'todo')[] | null, plan: boolean, f: number): void {
  fb.r(x, y, w, h, P.boardFrame)
  fb.r(x + 1, y + 1, w - 2, h - 2, P.board)
  fb.r(x + 2, y + h - 1, w - 4, 1, '#6d7682')
  fb.s(x + 3, y + h - 1, P.red)
  fb.s(x + 5, y + h - 1, P.ink)
  if (plan) {
    for (let i = 0; i < 3; i++) {
      if (i > ((f >> 1) % 4)) break
      const b = x + 2 + i * 4
      fb.r(b, y + 2, 3, 3, i === 2 ? P.green : P.ink)
      fb.s(b + 1, y + 3, P.board)
      if (i < 2) fb.s(b + 3, y + 3, '#555c66')
    }
    fb.r(x + 2, y + 6, Math.min(10, w - 4), 1, '#8a93a0')
    fb.r(x + 2, y + 8, 6, 1, '#8a93a0')
  } else if (todos && todos.length) {
    todos.slice(0, Math.floor((h - 2) / 2)).forEach((t, i) => {
      const ry = y + 2 + i * 2
      fb.s(x + 2, ry, t === 'done' ? P.green : t === 'doing' ? P.amber : '#8a93a0')
      fb.r(x + 4, ry, Math.min([9, 7, 10, 6][i % 4] ?? 8, w - 6), 1, t === 'done' ? '#b8c0cc' : t === 'doing' ? '#d9822b' : P.ink)
    })
  } else {
    fb.r(x + 3, y + 3, 7, 1, '#c5ccd6')
    fb.r(x + 3, y + 5, 4, 1, '#c5ccd6')
  }
}
export function plant(fb: FB, x: number, y: number): void {
  fb.r(x + 1, y + 4, 3, 3, P.pot)
  fb.r(x, y + 4, 5, 1, '#cf7a4a')
  fb.s(x + 2, y, P.plant)
  fb.r(x + 1, y + 1, 3, 1, P.plant)
  fb.r(x, y + 2, 5, 1, P.plant2)
  fb.r(x + 1, y + 3, 3, 1, P.plant)
}

/* ===== bubbles ===== */

export function thinkBubble(fb: FB, x: number, y: number, f: number): void {
  const W = 9
  const H = 7
  x = Math.max(0, Math.min(x, fb.w - W))
  fb.r(x + 1, y, W - 2, 1, OUT)
  fb.r(x + 1, y + H - 1, W - 2, 1, OUT)
  fb.r(x, y + 1, 1, H - 2, OUT)
  fb.r(x + W - 1, y + 1, 1, H - 2, OUT)
  fb.r(x + 1, y + 1, W - 2, H - 2, '#ffffff')
  fb.s(x + 1, y + H + 1, OUT)
  fb.s(x, y + H + 2, OUT)
  const n = f % 4
  for (let i = 0; i < 3; i++) fb.s(x + 2 + i * 2, y + 3, i < n ? OUT : '#d5d9e0')
}

/** "z z Z" rising from the napping Manager. */
export function zzz(fb: FB, f: number): void {
  const small = ['####', '..#.', '.#..', '####']
  const big = ['#####', '...#.', '..#..', '.#...', '#####']
  const marks = [[37, 26, small], [38, 20, small], [39, 13, big]] as const
  const n = 1 + (f % 3)
  marks.slice(0, n).forEach(([x, y, g]) => {
    g.forEach((r, j) => Array.from(r).forEach((ch, i) => ch === '#' && fb.s(x + i + 1, y + j + 1, '#2b3550')))
    g.forEach((r, j) => Array.from(r).forEach((ch, i) => ch === '#' && fb.s(x + i, y + j, '#ffffff')))
  })
}

const BUBBLE_INK: Record<Tone, string> = { '': '#2a2230', idle: '#2a2230', warn: '#b45309', bad: '#c62828', good: '#1f7a3f' }

/** A white bubble with up to 10 ASCII characters, its tail pointing down at (cx, row*2+5). */
export function textBubble(sc: Scene, cx: number, row: number, words: string, tone: Tone): void {
  const fb = sc.fb
  const plain = words.replace(/…/g, '..').replace(/×/g, 'x').replace(/[^\x20-\x7e]/g, '?')
  const str = plain.length <= 10 ? plain : plain.slice(0, 8) + '..'
  const w = str.length
  const y = row * 2
  const x = Math.max(2, Math.min(cx - Math.floor(w / 2), fb.w - w - 2))
  fb.r(x - 1, y - 1, w + 2, 4, '#ffffff')
  fb.r(x - 1, y - 2, w + 2, 1, OUT)
  fb.r(x - 1, y + 3, w + 2, 1, OUT)
  fb.r(x - 2, y - 1, 1, 4, OUT)
  fb.r(x + w + 1, y - 1, 1, 4, OUT)
  const tx = Math.max(x, Math.min(cx, x + w - 1))
  fb.s(tx, y + 4, OUT)
  fb.s(tx, y + 5, OUT)
  sc.text(x, row, str, BUBBLE_INK[tone], '#ffffff')
}
