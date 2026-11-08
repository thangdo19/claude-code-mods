// The big office's art (the design approved in the plan artifact): square pixels,
// two per terminal cell, people 7 × 13 pixels, furniture, bubbles. Pure drawing.

import { plain } from './labels'
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
  /**
   * Printable ASCII only (accents dropped), so no character can be wider than its cell in any terminal. The cell's
   * two pixels take the background color, so anything drawn over them later hides the letter (see settle).
   */
  text(x: number, row: number, str: string, fg: Paint, bg: Paint): void {
    let i = 0
    for (const raw of plain(str)) {
      const code = raw.charCodeAt(0)
      const ch = raw.length === 1 && code >= 0x20 && code <= 0x7e ? raw : '?'
      if (x + i >= 0 && x + i < this.fb.w) {
        this.texts.push({ x: x + i, row, ch, fg: C(fg), bg: C(bg) })
        this.fb.s(x + i, row * 2, bg)
        this.fb.s(x + i, row * 2 + 1, bg)
      }
      i++
    }
  }
  /** A bubble is about to be drawn over pixels x0..x1, y0..y1: the letters under it go (none show through). */
  cover(x0: number, y0: number, x1: number, y1: number): void {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]!
      if (t.x >= x0 && t.x <= x1 && t.row * 2 + 1 >= y0 && t.row * 2 <= y1) this.texts.splice(i, 1)
    }
  }
  /** After drawing: a letter something was drawn over (a person in front of a sign or the board) goes. */
  settle(): void {
    const { p, w } = this.fb
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]!
      if (p[t.row * 2 * w + t.x] !== t.bg || p[(t.row * 2 + 1) * w + t.x] !== t.bg) this.texts.splice(i, 1)
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
/** The Courier's red desk phone (approved round 4, "Red phone"); its handset is also in everyone's palette ('R'). */
const PHONE = { body: '#b83232', hand: '#e86060', key: '#f4e1c1', cord: '#7a2222' } as const

/* ===== people: 7 wide, 13 tall ===== */

const SPR = ['..hhh..', '.hHhhh.', '.hsssh.', '.seseS.', '..sms..', '.ckTkc.', 'cccTccC', 'cccTccC', 's.ccC.s', '..ppP..', '..p.P..', '..p.P..', '.ff.ff.']

export type Look = {
  pal: Record<string, number>
  /** 'pony': a fuller crown, side-swept bangs and a high ponytail tied with a band (color `accent`) that swings. */
  style?: 'long' | 'bun' | 'cap' | 'pony'
  /** A skirt (the pants color) over legs of color `legs` (the skin by default). */
  skirt?: boolean
  /** Rosy cheeks. */
  blush?: boolean
  glasses?: boolean
  /** Thin round glasses: a gold bridge. */
  wire?: boolean
  headset?: boolean
  /** The headset as silver headphones over the head, with a mic by the mouth (reads apart from dark hair). */
  silver?: boolean
  badge?: boolean
  bag?: boolean
  tie?: boolean
}
type LookDef = { skin: string; hair: string; shirt: string; inner?: string; tie?: string; pants?: string; cap?: string; legs?: string; accent?: string } & Omit<Look, 'pal' | 'tie'>

const look = (d: LookDef): Look => {
  const inner = d.inner ?? '#f4f4f4'
  const pants = d.pants ?? '#2f3443'
  return {
    style: d.style, glasses: d.glasses, wire: d.wire, silver: d.silver, headset: d.headset, badge: d.badge, bag: d.bag, tie: d.tie !== undefined,
    skirt: d.skirt, blush: d.blush,
    pal: {
      h: C(d.hair), H: shade(d.hair, 1.45), s: C(d.skin), S: shade(d.skin, 0.86), e: C(OUT), m: mix(d.skin, '#a8434a', 0.45),
      c: C(d.shirt), C: shade(d.shirt, 0.78), k: C(inner), T: C(d.tie ?? inner), p: C(pants), P: shade(pants, 0.75), f: C('#1a1d24'),
      g: C('#2b2f38'), G: C('#bfe3ff'), w: C('#ffffff'), K: C('#6b4226'), B: C('#7a4a2a'), q: C(d.cap ?? d.hair), y: C('#e8c47a'), Y: C('#c9a256'),
      r: C('#e04b4b'), n: C('#d4ecff'), M: C('#9aa3ae'), W: C('#8a5a32'), Z: C('#d9b75e'), v: C('#e3e8ee'),
      L: C('#3fa37a'), D: C('#5bb8f0'), j: C('#d3dae3'), J: C('#8d97a5'),
      l: C(d.legs ?? d.skin), b: mix(d.skin, '#ff6f91', 0.5), i: C(d.accent ?? '#ff7eb6'), R: C(PHONE.hand), o: mix(d.skin, '#3a1014', 0.7),
    },
  }
}

export const LOOK = {
  manager: look({ skin: '#f1c7a2', hair: '#3a2a1e', shirt: '#2c3550', tie: '#d97757', pants: '#232a3d' }),
  archivist: look({ skin: '#d9a47e', hair: '#d3d3d8', style: 'bun', shirt: '#8a64bd', inner: '#efe6d6', pants: '#3d3550', glasses: true }),
  typist: look({ skin: '#f2cfb0', hair: '#b8452e', style: 'long', shirt: '#e07fa6', inner: '#fff0f5', pants: '#3b3f4f' }),
  // The IT girl (approved Nov 2026, round 4 "Ponytail": she read as a guy before): dark-brown hair with bangs and a high
  // ponytail tied with a pink band, thin round glasses, rosy cheeks, the silver headset with its mic, the IT teal top,
  // a navy skirt.
  it: look({
    skin: '#f3d3bd', hair: '#4a2c1e', style: 'pony', accent: '#ff6fae', shirt: '#3a9a84', inner: '#2f7566', pants: '#2b3a55',
    skirt: true, blush: true, headset: true, silver: true, glasses: true, wire: true,
  }),
  courier: look({ skin: '#e8b58e', hair: '#6b3e1e', style: 'cap', cap: '#e8a33d', shirt: '#d0603c', inner: '#f2e2c4', pants: '#3b4a6b', bag: true }),
  janitor: look({ skin: '#c98f6a', hair: '#4a3a2a', style: 'cap', cap: '#2f5f9e', shirt: '#3c6fb4', inner: '#e8eef7', pants: '#335f9c' }),
  researcher: look({ skin: '#f0c8a0', hair: '#2b2b2b', shirt: '#e6b432', inner: '#fff6dc', pants: '#3b3f4f', glasses: true }),
  planner: look({ skin: '#b97a56', hair: '#3b2418', style: 'long', shirt: '#5fa04e', inner: '#eef7e8', pants: '#2f3443' }),
  librarian: look({ skin: '#f3d6c0', hair: '#c9a24a', style: 'bun', shirt: '#9c6b43', inner: '#f5ead8', pants: '#4a3b30' }),
  // Agents ("secretaries"): eight looks, so up to 8 in the office at once never look alike (4 desks + 3 in line + one
  // walking out). Each differs from every staff member in shirt color and hair; all wear the agency badge.
  sec: [
    look({ skin: '#f1c9a5', hair: '#1b1512', style: 'long', shirt: '#c8384e', inner: '#fbe4e8', badge: true }),
    look({ skin: '#f3d0b4', hair: '#7a4a26', style: 'bun', shirt: '#56b4e9', inner: '#e6f5ff', badge: true }),
    look({ skin: '#f6d8c2', hair: '#e07b39', shirt: '#5b52d1', inner: '#e4e2fb', badge: true }),
    look({ skin: '#7a4a30', hair: '#121010', style: 'bun', shirt: '#b3cf32', inner: '#f3f9dc', badge: true }),
    // Short hair: long dark hair and a blue-green top would look like the IT girl.
    look({ skin: '#e2ae84', hair: '#3a2216', shirt: '#2fc4d6', inner: '#e3fbfd', badge: true }),
    look({ skin: '#a86b48', hair: '#1c1714', shirt: '#7f8a99', inner: '#e6eaef', badge: true, glasses: true }),
    look({ skin: '#f7e0d0', hair: '#efe3b8', shirt: '#d04bb8', inner: '#fbe3f6', badge: true }),
    look({ skin: '#5e3a26', hair: '#141110', shirt: '#8c2f47', inner: '#f3dde3', badge: true }),
  ],
}
export const secLook = (n: number): Look => LOOK.sec[((n % LOOK.sec.length) + LOOK.sec.length) % LOOK.sec.length] ?? LOOK.manager

export type Arms = 'down' | 'type' | 'up' | 'chin' | 'raise' | 'phone' | 'deskPhone' | 'mug' | 'folder' | 'magnify' | 'point' | 'broom' | 'sleep' | 'walk' | 'walkMug' | 'water' | 'talk' | 'read' | 'tidy' | 'stretch' | 'walkBroom'
/**
 * Which way someone faces (approved round 5, "Face the way they walk"): the front ('down', at rest and walking down),
 * the back ('up', walking up an aisle), or a side (walking, or standing turned to whoever they talk to).
 */
export type Face = 'down' | 'up' | 'left' | 'right'
/**
 * `busy`: on a job — typing hands hop out and in (see workFx for the paper bits). `f`: the walk step while walking
 * (0 one foot forward, 1 passing, 2 the other foot, 3 passing), else the frame. `talk` ('talk' arms): 'speak' or 'listen'.
 */
export type PersonOpts = {
  f?: number; seat?: boolean; maxRow?: number; arms?: Arms; eyes?: 'closed'; smile?: boolean; seed?: number; busy?: boolean
  face?: Face; talk?: 'speak' | 'listen'
}

/** Seen from behind: hair instead of a face, no tie or open collar. */
const BACK = ['..hhh..', '.hhHhh.', '.hhhhh.', '.hhhhh.', '..sSs..', '.ccccc.', 'cccccCC', 'cccccCC', 's.cCC.s', '..ppP..', '..p.P..', '..p.P..', '.ff.ff.']
/**
 * Seen from the side, facing right (mirrored for left), approved round 5 "Chunky profile": as wide as the front (a
 * stick body looked ugly), a round face with the eye a pixel from the front edge, no nose, the hair at the back.
 */
const SIDE = ['..hhh..', '.hhhHh.', '.hhsss.', '.hhses.', '..hss..', '..ccck.', '..cccc.', '..cccc.', '..cccc.', '..pppP.', '...pP..', '...pP..', '...fff.']

type Put = (x: number, y: number, ch: string) => void
type Del = (x: number, y: number) => void

/** Draws a person with their top-left at (x, y). Seated people show rows 0–8 (the desk hides the rest). */
export function drawPerson(fb: FB, x: number, y: number, L: Look, o: PersonOpts = {}): void {
  const f = o.f ?? 0
  const seed = o.seed ?? 0
  const arms = o.arms
  const walking = arms === 'walk' || arms === 'walkMug' || arms === 'walkBroom'
  // The back only while walking; a side while walking, or standing to talk.
  let face: Face = o.face ?? 'down'
  if (o.seat || (face === 'up' && !walking) || (face !== 'down' && !walking && arms !== 'talk' && arms !== 'down')) face = 'down'
  const side = face === 'left' || face === 'right'
  /** The walk step (approved round 5): one foot forward, passing, the other foot, passing. */
  const step = walking ? f % 4 : 1
  let g = new Map<string, string>()
  ;(side ? SIDE : face === 'up' ? BACK : SPR).forEach((row, ry) => {
    if (o.seat && ry > 8) return
    if (o.maxRow !== undefined && ry > o.maxRow) return
    Array.from(row).forEach((ch, rx) => {
      if (ch !== '.') g.set(rx + ',' + ry, ch)
    })
  })
  const put: Put = (px, py, ch) => g.set(px + ',' + py, ch)
  const del: Del = (px, py) => g.delete(px + ',' + py)
  /** A step, front or back: the foot swinging forward lifts, the other arm swings forward (its hand shows higher). */
  const steps = (handBusy: boolean) => {
    if (step % 2) return
    const right = step === 0
    del(right ? 4 : 2, 11)
    for (const fx of right ? [4, 5] : [1, 2]) {
      del(fx, 12)
      put(fx, 11, 'f')
    }
    if (!right && handBusy) return
    const hx = right ? 0 : 6
    del(hx, 8)
    put(hx, 7, 's')
  }
  // The ponytail swings with her steps and hangs still at rest (approved round 5; it flipped 4 times a second).
  const sw = walking ? (f >> 1) % 2 : 0
  const blink = (f + seed * 5) % 19 === 0
  const closed = (o.eyes === 'closed' || blink) && !L.glasses
  // Talking, taking turns (approved round 5): the talker's mouth opens and shuts and a hand comes up now and then;
  // the listener nods now and then (the head a pixel down for a moment).
  const speaking = arms === 'talk' && o.talk !== 'listen'
  const gesture = speaking && (f + seed * 3) % 12 < 4
  const nod = arms === 'talk' && o.talk === 'listen' && (f + seed * 7) % 10 === 0

  if (side) {
    sideLook(L, sw, closed, speaking && f % 2 === 1, put)
    sideMoves(f, step, walking, arms, gesture, !!o.seat, put, del)
  } else {
    if (!L.tie && face === 'down') {
      put(3, 6, 'c')
      put(3, 7, 'c')
    }
    if (face === 'up') backLook(L, sw, put)
    else frontLook(L, sw, put)
    if (closed && face === 'down') {
      put(2, 3, 'S')
      put(4, 3, 'S')
    }
    if (o.smile && face === 'down') {
      put(2, 4, 'm')
      put(4, 4, 'm')
    }
    if (speaking && f % 2 && face === 'down') put(3, 4, 'o')
    switch (arms) {
      case 'type':
        del(0, 8)
        del(6, 8)
        if (o.busy) {
          // On a job: both hands hop on the keys, out and in.
          if (f % 2) {
            put(0, 7, 's')
            put(5, 8, 's')
          } else {
            put(1, 8, 's')
            put(6, 7, 's')
          }
        } else if (f % 2) {
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
      case 'deskPhone':
        // The desk phone's handset at the ear, the hand under it (deskPhone draws the cord down to the phone).
        del(6, 8)
        del(6, 7)
        put(6, 5, 'C')
        put(6, 4, 's')
        for (const [a, b] of [[6, 2], [6, 3], [7, 2], [5, 4]] as const) put(a, b, 'R')
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
      case 'broom':
      case 'walkBroom': {
        // Sweeping (standing, or along the hallway): the bristles swish (with the steps on the way), dust flies off.
        del(6, 8)
        put(6, 6, 's')
        for (const [a, b] of [[7, 4], [7, 5], [7, 6], [8, 7], [8, 8], [8, 9], [9, 10], [9, 11]] as const) put(a, b, 'W')
        const bx = walking ? (f >> 1) % 2 : f % 2
        for (let i = 0; i < 4; i++) put(8 + i + bx, 12, 'Z')
        put(9 + bx, 11, 'Z')
        put(10 + bx, 11, 'Z')
        if (face === 'down') {
          put(12 + (f % 3), 11 - ((f >> 1) % 2), 'M')
          if (f % 3 === 1) put(13, 9, 'v')
        }
        if (walking) steps(true)
        break
      }
      case 'sleep':
        del(0, 8)
        del(6, 8)
        put(2, 7, 's')
        put(4, 7, 's')
        break
      case 'water': {
        // A watering can held out to the left, a drop falling.
        del(0, 8)
        put(0, 6, 's')
        for (const [a, b] of [[-3, 6], [-2, 6], [-1, 6], [-3, 7], [-2, 7], [-1, 7]] as const) put(a, b, 'L')
        put(-4, 5, 'L')
        put(-5, 4, 'L')
        put(-5, 5 + 1 + (f % 2), 'D')
        if (f % 2) put(-6, 8, 'D')
        break
      }
      case 'read':
        // A newspaper held up, a page turning now and then.
        for (const [a, b] of [[0, 6], [0, 7], [0, 8], [6, 6], [6, 7], [6, 8]] as const) del(a, b)
        for (let yy = 5; yy <= 8; yy++) for (let xx = 0; xx <= 6; xx++) put(xx, yy, 'v')
        for (const [a, b] of [[1, 6], [2, 6], [4, 6], [5, 6], [1, 8], [2, 8], [4, 8], [3, 5], [3, 6], [3, 7], [3, 8]] as const) put(a, b, 'M')
        if ((f >> 3) % 2) for (let yy = 5; yy <= 8; yy++) put(5, yy, 'w')
        put(-1, 7, 's')
        put(7, 7, 's')
        break
      case 'tidy': {
        // Squaring a stack of papers: tap, tap.
        del(0, 8)
        del(6, 8)
        const up = (f >> 1) % 2
        for (let xx = 1; xx <= 5; xx++) {
          put(xx, 7 - up, 'w')
          put(xx, 8 - up, 'v')
        }
        put(3, 8 - up, 'M')
        put(0, 8 - up, 's')
        put(6, 8 - up, 's')
        break
      }
      case 'stretch': {
        // A slow stretch (approved round 5, "Smooth"): arms out, halfway, up and held, halfway, back.
        for (const [a, b] of [[0, 6], [0, 7], [0, 8], [6, 6], [6, 7], [6, 8]] as const) del(a, b)
        const p = f % 8
        if (p >= 3 && p <= 5) {
          for (let r = 2; r <= 5; r++) {
            put(0, r, 'c')
            put(6, r, 'C')
          }
          put(0, 1, 's')
          put(6, 1, 's')
        } else if (p === 2 || p === 6) {
          for (const [a, b, ch] of [[0, 5, 'c'], [0, 6, 'c'], [-1, 4, 'c'], [6, 5, 'C'], [6, 6, 'C'], [7, 4, 'C']] as const) put(a, b, ch)
          put(-2, 3, 's')
          put(8, 3, 's')
        } else {
          for (const [a, ch] of [[-1, 'c'], [0, 'c'], [6, 'C'], [7, 'C']] as const) put(a, 6, ch)
          put(-2, 6, 's')
          put(8, 6, 's')
        }
        break
      }
      case 'talk':
        // The talker's hand comes up now and then.
        if (gesture) {
          del(6, 8)
          put(6, 5, 'C')
          put(7, 4, 's')
        }
        break
      case 'walk':
      case 'walkMug':
        if (arms === 'walkMug') {
          del(6, 8)
          put(7, 7, 's')
          put(7, 5, 'K')
          put(8, 5, 'K')
          put(7, 6, 'w')
          put(8, 6, 'w')
        }
        steps(arms === 'walkMug')
        break
    }
  }
  if (L.skirt && !o.seat) skirt(step, side, put, del)
  if (nod) {
    // The head (rows 0–4, hair and all) a pixel down for a moment.
    const n = new Map<string, string>()
    for (const [k, ch] of g) if (Number(k.split(',')[1]) > 4) n.set(k, ch)
    for (const [k, ch] of g) {
      const [px = 0, py = 0] = k.split(',').map(Number)
      if (py <= 4) n.set(px + ',' + (py + 1), ch)
    }
    g = n
  }
  const flip = face === 'left'
  for (const [k, ch] of g) {
    const [px = 0, py = 0] = k.split(',').map(Number)
    const col = L.pal[ch]
    if (col !== undefined) fb.s(x + (flip ? 6 - px : px), y + py, col)
  }
}

/** Hair, glasses, headset and the rest, seen from the front. */
function frontLook(L: Look, sw: number, put: Put): void {
  if (L.style === 'pony') {
    // A fuller crown, side-swept bangs, the hair down to the ears (the ponytail comes after the headset).
    for (let i = 1; i <= 5; i++) put(i, 0, 'h')
    for (let i = 0; i <= 6; i++) put(i, 1, i === 2 ? 'H' : 'h')
    for (const [a, b] of [[2, 2], [3, 2], [0, 2], [6, 2]] as const) put(a, b, 'h')
  } else if (L.style === 'long') for (const [a, b] of [[1, 3], [5, 3], [1, 4], [5, 4], [0, 4], [6, 4], [0, 5], [6, 5]] as const) put(a, b, 'h')
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
    put(3, 3, L.wire ? 'Y' : 'g')
  }
  if (L.blush) {
    put(1, 4, 'b')
    put(5, 4, 'b')
  }
  if (L.headset && L.silver) {
    // Silver headphones: a band curving over the head down to the ear cups, a mic by the mouth.
    for (const [a, b] of [[2, -1], [3, -1], [4, -1], [1, 0], [5, 0], [0, 1], [6, 1]] as const) put(a, b, 'j')
    for (const [a, b] of [[0, 2], [0, 3], [6, 2], [6, 3], [5, 4]] as const) put(a, b, 'J')
  } else if (L.headset) {
    for (let i = 1; i <= 5; i++) put(i, -1, 'g')
    for (const [a, b] of [[0, 2], [0, 3], [6, 2], [6, 3]] as const) put(a, b, 'g')
  }
  // The ponytail behind the head, tied high with the band.
  if (L.style === 'pony') for (const [a, b, ch] of [[6, 0, 'i'], [7, 0, 'h'], [7, 1, 'h'], [7 + sw, 2, 'H'], [7 + sw, 3, 'h'], [7 + sw, 4, 'h']] as const) put(a, b, ch)
  if (L.badge) put(5, 6, 'w')
  if (L.bag) for (const [a, b] of [[1, 5], [2, 6], [3, 7]] as const) put(a, b, 'B')
}

/** Seen from behind: long hair down the back, the ponytail down the middle, the headset band, the bag strap. */
function backLook(L: Look, sw: number, put: Put): void {
  if (L.style === 'pony') {
    put(3, 0, 'i')
    for (const [a, b, ch] of [[3, 1, 'H'], [3, 2, 'H'], [3 + sw, 3, 'h'], [3 + sw, 4, 'h'], [3 + sw, 5, 'h']] as const) put(a, b, ch)
  } else if (L.style === 'long') for (const [a, b] of [[1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [2, 6], [3, 6], [4, 6]] as const) put(a, b, 'h')
  else if (L.style === 'bun') {
    put(2, -1, 'h')
    put(3, -1, 'H')
    put(4, -1, 'h')
    put(3, -2, 'h')
  } else if (L.style === 'cap') {
    for (let i = 2; i <= 4; i++) put(i, 0, 'q')
    for (let i = 1; i <= 5; i++) put(i, 1, 'q')
  }
  if (L.headset) {
    const band = L.silver ? 'j' : 'g'
    if (L.silver) for (const [a, b] of [[2, -1], [3, -1], [4, -1], [1, 0], [5, 0], [0, 1], [6, 1]] as const) put(a, b, band)
    else for (let i = 1; i <= 5; i++) put(i, -1, band)
    for (const [a, b] of [[0, 2], [0, 3], [6, 2], [6, 3]] as const) put(a, b, L.silver ? 'J' : 'g')
  }
  if (L.bag) for (const [a, b] of [[5, 5], [4, 6], [3, 7], [1, 8], [2, 8], [1, 9]] as const) put(a, b, 'B')
}

/** Seen from the side (facing right): hair at the back and bangs, glasses, headset, tie, badge, bag, the mouth. */
function sideLook(L: Look, sw: number, closed: boolean, mouthOpen: boolean, put: Put): void {
  if (L.style === 'long') for (const [a, b] of [[1, 4], [2, 4], [1, 5], [2, 5], [1, 6]] as const) put(a, b, 'h')
  else if (L.style === 'bun') for (const [a, b, ch] of [[2, -1, 'h'], [3, -1, 'H'], [1, -1, 'h'], [2, -2, 'h']] as const) put(a, b, ch)
  else if (L.style === 'cap') {
    for (let i = 2; i <= 4; i++) put(i, 0, 'q')
    for (let i = 1; i <= 6; i++) put(i, 1, 'q')
  } else if (L.style === 'pony') {
    for (let i = 1; i <= 5; i++) {
      put(i, 0, 'h')
      put(i, 1, 'h')
    }
    put(4, 1, 'H')
    put(5, 2, 'h')
  }
  if (L.glasses) {
    put(4, 3, 'G')
    put(3, 3, L.wire ? 'Y' : 'g')
  }
  if (L.blush) put(3, 4, 'b')
  if (L.headset) {
    for (const [a, b] of [[2, -1], [3, -1], [1, 0], [1, 1]] as const) put(a, b, L.silver ? 'j' : 'g')
    put(2, 2, L.silver ? 'J' : 'g')
    put(2, 3, L.silver ? 'J' : 'g')
    if (L.silver) put(3, 4, 'J')
  }
  // The ponytail behind the head, tied high with the band; it swings with the steps.
  if (L.style === 'pony') for (const [a, b, ch] of [[0, 0, 'i'], [-1, 0, 'h'], [-1, 1, 'H'], [-1 - sw, 2, 'h'], [-1 - sw, 3, 'h'], [-1 - sw, 4, 'h']] as const) put(a, b, ch)
  if (L.tie) {
    put(5, 6, 'T')
    put(5, 7, 'T')
  }
  if (L.badge) put(5, 6, 'w')
  if (L.bag) for (const [a, b] of [[4, 5], [3, 6], [1, 7], [1, 8], [2, 8]] as const) put(a, b, 'B')
  if (closed) put(4, 3, 'S')
  if (mouthOpen) put(4, 4, 'o')
}

/** The side walk: a short stride (front leg over the back one), the near arm swinging a pixel each way. */
function sideMoves(f: number, step: number, walking: boolean, arms: Arms | undefined, gesture: boolean, seat: boolean, put: Put, del: Del): void {
  if (!seat && step % 2 === 0) {
    for (const [a, b] of [[3, 10], [4, 10], [3, 11], [4, 11], [3, 12], [4, 12], [5, 12]] as const) del(a, b)
    const [fwd, back] = step === 0 ? ['p', 'P'] : ['P', 'p']
    for (const [a, b, ch] of [[3, 10, back], [2, 11, back], [1, 12, 'f'], [2, 12, 'f'], [4, 10, fwd], [5, 11, fwd], [5, 12, 'f'], [6, 12, 'f']] as const) put(a, b, ch)
  }
  if (arms === 'walkMug') {
    for (const [a, b, ch] of [[3, 6, 'C'], [4, 7, 'C'], [5, 7, 'C'], [6, 7, 's'], [6, 5, 'K'], [7, 5, 'K'], [6, 6, 'w'], [7, 6, 'w']] as const) put(a, b, ch)
  } else if (arms === 'walkBroom') {
    for (const [a, b, ch] of [[3, 6, 'C'], [4, 7, 'C'], [5, 7, 's']] as const) put(a, b, ch)
    for (const [a, b] of [[6, 6], [6, 7], [7, 8], [7, 9], [8, 10], [8, 11]] as const) put(a, b, 'W')
    const bx = (f >> 1) % 2
    for (let i = 0; i < 4; i++) put(7 + i + bx, 12, 'Z')
    put(8 + bx, 11, 'Z')
    put(9 + bx, 11, 'Z')
  } else if (arms === 'talk' && gesture) {
    for (const [a, b, ch] of [[3, 6, 'C'], [4, 6, 'C'], [5, 6, 'C'], [6, 5, 's']] as const) put(a, b, ch)
  } else {
    const hx = walking && step === 2 ? 4 : walking && step === 0 ? 2 : 3
    put(3, 6, 'C')
    put(hx, 7, 'C')
    put(hx, 8, 's')
    // The far hand peeks out in front as the near one swings back.
    if (hx === 2) put(6, 8, 'S')
  }
}

/** A skirt flaring out over the legs (rows 9–12); walking, the legs step under it. `step`: 1 or 3 when not stepping. */
function skirt(step: number, side: boolean, put: Put, del: Del): void {
  for (let yy = 9; yy <= 12; yy++) for (let xx = -1; xx <= 7; xx++) del(xx, yy)
  if (side) {
    for (let xx = 2; xx <= 5; xx++) put(xx, 9, xx === 5 ? 'P' : 'p')
    for (let xx = 1; xx <= 6; xx++) put(xx, 10, xx % 2 ? 'P' : 'p')
    const legs = step % 2 ? [[3, 11], [4, 11]] : [[2, 11], [5, 11]]
    for (const [a, b] of legs) put(a!, b!, 'l')
    for (const [a, b] of step % 2 ? [[3, 12], [4, 12], [5, 12]] : [[1, 12], [2, 12], [5, 12], [6, 12]]) put(a!, b!, 'f')
    return
  }
  for (let xx = 1; xx <= 5; xx++) put(xx, 9, xx >= 4 ? 'P' : 'p')
  for (let xx = 0; xx <= 6; xx++) put(xx, 10, xx % 2 ? 'P' : 'p')
  for (const xx of [2, 4]) put(xx, 11, 'l')
  for (const xx of [1, 2, 4, 5]) put(xx, 12, 'f')
  // A step: the foot swinging forward lifts.
  if (step % 2 === 0) {
    for (const xx of step === 0 ? [4, 5] : [1, 2]) {
      del(xx, 12)
      put(xx, 11, 'f')
    }
  }
}

/** On a job: two bits of paper fly up from the hands of the person drawn at (x, y). `f`: every tick. */
export function workFx(fb: FB, x: number, y: number, f: number): void {
  const a = f % 4
  const b = (f + 2) % 4
  fb.s(x + 7 + (a >> 1), y + 6 - a, '#ffffff')
  fb.s(x - 1 - (b >> 1), y + 6 - b, '#fff3c4')
}

/* ===== furniture ===== */

/**
 * The desk phone, 4 × 3 on the desk top: the handset across the top, cream keys, the base. In use, the handset is at
 * the Courier's ear (drawPerson 'deskPhone') and its coiled cord runs down to the phone. (Low, so a mug in hand shows.)
 */
export function deskPhone(fb: FB, x: number, y: number, inUse: boolean): void {
  fb.r(x, y + 1, 4, 1, PHONE.body)
  fb.s(x + 1, y + 1, PHONE.key)
  fb.s(x + 2, y + 1, PHONE.key)
  fb.r(x, y + 2, 4, 1, shade(PHONE.body, 0.75))
  if (inUse) {
    fb.s(x, y, PHONE.body)
    fb.s(x + 3, y, PHONE.body)
    fb.s(x - 1, y - 1, PHONE.cord)
    fb.s(x - 1, y, PHONE.hand)
    fb.s(x - 1, y + 1, PHONE.cord)
  } else fb.r(x, y, 4, 1, PHONE.hand)
}

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
export function monitor(fb: FB, x: number, y: number, on: boolean, f: number, game = false): void {
  fb.r(x, y, 5, 4, P.mon)
  fb.r(x, y, 5, 1, P.monHi)
  if (game) {
    // A little game: a bouncing ball and a paddle.
    fb.r(x + 1, y + 1, 3, 2, '#2a1f4a')
    fb.s(x + 1 + [0, 1, 2, 1][f % 4]!, y + 1, ['#ff5fa2', '#ffd84a', '#5fe0a0', '#5fb8ff'][f % 4]!)
    fb.s(x + 1 + [1, 2, 1, 0][f % 4]!, y + 2, '#ffffff')
  } else if (on) {
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
/** The wall clock: a dark rim round a white face, the hour hand up, the red second hand going round. */
export function clock(fb: FB, x: number, y: number, f: number): void {
  fb.r(x + 1, y, 3, 1, '#4d5563')
  fb.r(x, y + 1, 5, 3, '#4d5563')
  fb.r(x + 1, y + 4, 3, 1, '#4d5563')
  fb.r(x + 1, y + 1, 3, 3, '#f6f7f9')
  const hands = [[2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2], [1, 1]] as const
  const [a, b] = hands[(f >> 1) % 8] ?? hands[0]
  fb.s(x + 2, y + 1, OUT)
  fb.s(x + 2, y + 2, OUT)
  fb.s(x + a, y + b, P.red)
}
/** The board with nothing on it, or boxes and arrows in plan mode (the to-do words: boardWords). */
export function board(fb: FB, x: number, y: number, w: number, h: number, plan: boolean, f: number): void {
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

/** A small brass sign: a word on a desk front or on the wall over a station, one text row tall. */
export const PLATE = '#e8c25a'
const PLATE_INK = '#4a3510'
export function plate(sc: Scene, cx: number, row: number, word: string): void {
  const s = ' ' + word + ' '
  sc.text(cx - Math.floor(s.length / 2), row, s, PLATE_INK, PLATE)
}

export type BoardItem = { text: string; state: 'done' | 'doing' | 'todo' }
const BOARD_INK = { done: P.green, doing: '#d9822b', todo: P.ink } as const
/**
 * The to-do board with words (approved: "Words + Manager ticks"): one line per item, "v" done, ">" doing, "-" next,
 * about 12 letters each. More than fit: a top line says how many done are above, the current one stays in view, a
 * bottom line says how many more.
 */
export function boardWords(sc: Scene, x: number, y: number, w: number, h: number, items: readonly BoardItem[]): void {
  const fb = sc.fb
  fb.r(x, y, w, h, P.boardFrame)
  fb.r(x + 1, y + 1, w - 2, h - 2, P.board)
  fb.r(x + 2, y + h - 1, w - 4, 1, '#6d7682')
  fb.s(x + 3, y + h - 1, P.red)
  fb.s(x + 5, y + h - 1, P.ink)
  // Text rows fully inside the white (a cell is two pixel rows), letters from the frame's inner edge.
  const first = Math.ceil((y + 1) / 2)
  const rows = Math.floor((y + h - 1) / 2) - first
  const cols = w - 2
  const n = items.length
  let start = 0
  let end = n
  if (n > rows) {
    const open = items.findIndex(t => t.state !== 'done')
    const cur = open < 0 ? n : open
    start = Math.max(0, Math.min(cur - 1, n - (rows - 1)))
    let slots = start > 0 ? rows - 1 : rows
    end = Math.min(n, start + slots)
    if (end < n) end = start + --slots
  }
  const top = start > 0 ? 1 : 0
  if (top) sc.text(x + 1, first, ('v ' + start + ' done').padEnd(cols, ' '), BOARD_INK.done, P.board)
  items.slice(start, end).forEach((it, k) => {
    const mark = it.state === 'done' ? 'v' : it.state === 'doing' ? '>' : '-'
    const t = plain(it.text).replace(/\s+/g, ' ').trim()
    const words = t.length <= cols - 2 ? t : t.slice(0, cols - 4) + '..'
    sc.text(x + 1, first + top + k, (mark + ' ' + words).padEnd(cols, ' '), BOARD_INK[it.state], P.board)
  })
  if (end < n) sc.text(x + 1, first + top + (end - start), ('+ ' + (n - end) + ' more').padEnd(cols, ' '), '#8a93a0', P.board)
}

/* ===== bubbles ===== */

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
export function iconBubble(fb: FB, cx: number, bottom: number, icon: 'dots' | 'ha' | 'heart' | 'note' | 'bang' | 'ask' | 'check'): void {
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
  ;(art[icon] ?? []).forEach((r, j) => Array.from(r).forEach((ch, i) => ch === '#' && fb.s(x + 1 + i, y + 1 + j, ink[icon] ?? OUT)))
}

/** The coffee machine under the window; brewing: a cup under the spout, drips and steam. */
export function coffeeMachine(fb: FB, x: number, y: number, brewing: boolean, f: number): void {
  fb.r(x, y, 6, 8, '#3b404a')
  fb.r(x, y, 6, 1, '#5b6170')
  fb.r(x + 1, y + 1, 4, 2, '#262a33')
  fb.s(x + 4, y + 1, brewing ? '#3fd273' : '#e04b4b')
  fb.r(x + 1, y + 4, 4, 3, '#1d2129')
  fb.s(x + 2, y + 4, '#9aa3ae')
  fb.r(x, y + 7, 6, 1, '#5b6170')
  if (brewing) {
    fb.r(x + 2, y + 5, 2, 2, '#ffffff')
    fb.s(x + 2, y + 5 - 0, (f % 2) ? '#6b4226' : '#ffffff')
    if (f % 2) fb.s(x + 2, y + 4, '#6b4226')
    fb.s(x + 1 + (f % 2), y - 1, '#e3e8ee')
    fb.s(x + 2 - (f % 2), y - 2, '#e3e8ee')
  }
}

/** The water cooler by the door; someone chatting by it makes it bubble. */
export function waterCooler(fb: FB, x: number, y: number, busy: boolean, f: number): void {
  fb.r(x + 1, y, 2, 1, '#9fd6f5')
  fb.r(x, y + 1, 4, 4, '#79c4ef')
  fb.s(x, y + 1, '#c8ebff')
  fb.r(x, y + 5, 4, 5, '#e8ecf1')
  fb.r(x, y + 5, 4, 1, '#c5ccd6')
  fb.s(x + 1, y + 6, '#3a6fd6')
  fb.s(x + 2, y + 6, P.red)
  fb.r(x, y + 9, 4, 1, '#9aa3ae')
  if (busy) fb.s(x + 1 + (f % 2), y + 4 - (f % 3), '#ffffff')
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
