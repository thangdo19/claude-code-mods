// People: 7 wide, 13 tall (approved art). Front, back and side, walking, talking, at work, on a break; drawn on a
// small grid once per pose and frame phase, then copied. Pure drawing.

import { FB } from '../gfx/fb'
import type { Look } from './looks'

const SPR = ['..hhh..', '.hHhhh.', '.hsssh.', '.seseS.', '..sms..', '.ckTkc.', 'cccTccC', 'cccTccC', 's.ccC.s', '..ppP..', '..p.P..', '..p.P..', '.ff.ff.']

export type Arms = 'down' | 'type' | 'up' | 'chin' | 'raise' | 'phone' | 'deskPhone' | 'mug' | 'folder' | 'magnify' | 'point' | 'broom' | 'sleep' | 'walk' | 'walkMug' | 'water' | 'talk' | 'read' | 'tidy' | 'stretch' | 'walkBroom' | 'eat'
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

/**
 * The scratch grid a person is drawn on: one char code per pixel (0 none), x -16..23 and y -8..20 around the sprite's
 * top-left (a person and what they hold reach x -6..14, y -2..12).
 */
const GX = 16
const GY = 8
const GW = 40
const GH = 29
const grid = new Uint8Array(GW * GH)
const nodded = new Uint8Array(GW * GH)
const inGrid = (px: number, py: number) => px >= -GX && px < GW - GX && py >= -GY && py < GH - GY
const gput: Put = (px, py, ch) => {
  if (inGrid(px, py)) grid[px + GX + (py + GY) * GW] = ch.charCodeAt(0)
}
const gdel: Del = (px, py) => {
  if (inGrid(px, py)) grid[px + GX + (py + GY) * GW] = 0
}

/** Each look's palette by char code (-1: none), and a number for the cache key. */
const looks = new WeakMap<Look, { id: number; pal: Int32Array }>()
const lookInfo = (L: Look) => {
  let i = looks.get(L)
  if (!i) {
    const pal = new Int32Array(128).fill(-1)
    for (const [ch, col] of Object.entries(L.pal)) if (ch.length === 1 && ch.charCodeAt(0) < 128) pal[ch.charCodeAt(0)] = col
    i = { id: nextLook++, pal }
    looks.set(L, i)
  }
  return i
}
let nextLook = 0
const ARMS: readonly (Arms | undefined)[] = [
  undefined, 'down', 'type', 'up', 'chin', 'raise', 'phone', 'deskPhone', 'mug', 'folder', 'magnify', 'point', 'broom', 'sleep', 'walk', 'walkMug', 'water',
  'talk', 'read', 'tidy', 'stretch', 'walkBroom', 'eat',
]
const FACES: readonly Face[] = ['down', 'up', 'left', 'right']
/**
 * Drawn people by everything their pixels depend on (approved art, drawn once): the look, the frame mod 48 (every
 * other use of the frame is mod 2, 3, 4, 8, 16 or a bit of it), whether the eyes are closed (a blink), the talker's
 * mouth and hand, the listener's nod, and the options (the seed only moves the blink, the hand and the nod). Each pixel: (x + GX) + (y + GY) * GW, its char code << 11.
 */
const drawn = new Map<number, Uint32Array>()
/** The cache starts over past this many (a long session). */
const DRAWN_MAX = 4096
/** A frame's phase as the drawing sees it. */
const PHASE = 48

/** Draws a person with their top-left at (x, y). Seated people show rows 0–8 (the desk hides the rest). */
export function drawPerson(fb: FB, x: number, y: number, L: Look, o: PersonOpts = {}): void {
  const f = o.f ?? 0
  const seed = o.seed ?? 0
  const arms = o.arms
  const walking = arms === 'walk' || arms === 'walkMug' || arms === 'walkBroom'
  // The back only while walking; a side while walking, or standing to talk.
  let face: Face = o.face ?? 'down'
  if (o.seat || (face === 'up' && !walking) || (face !== 'down' && !walking && arms !== 'talk' && arms !== 'down')) face = 'down'
  const blink = (f + seed * 5) % 19 === 0
  const closed = (o.eyes === 'closed' || blink) && !L.glasses
  // Talking, taking turns (approved round 5): the talker's mouth opens and shuts and a hand comes up now and then;
  // the listener nods now and then (the head a pixel down for a moment).
  const speaking = arms === 'talk' && o.talk !== 'listen'
  const gesture = speaking && (f + seed * 3) % 12 < 4
  const nod = arms === 'talk' && o.talk === 'listen' && (f + seed * 7) % 10 === 0
  const info = lookInfo(L)
  // (Only a whole frame from 0 has a phase; anything else, or a cut-off person, is drawn afresh.)
  const cacheable = Number.isInteger(f) && f >= 0 && o.maxRow === undefined
  let key = -1
  let px: Uint32Array | undefined
  if (cacheable) {
    key = f % PHASE
    key = key * 2 + (closed ? 1 : 0)
    key = key * 2 + (speaking ? 1 : 0)
    key = key * 2 + (gesture ? 1 : 0)
    key = key * 2 + (nod ? 1 : 0)
    key = key * 2 + (o.seat ? 1 : 0)
    key = key * 2 + (o.smile ? 1 : 0)
    key = key * 2 + (o.busy ? 1 : 0)
    key = key * ARMS.length + ARMS.indexOf(arms)
    key = key * FACES.length + FACES.indexOf(face)
    key = key * 1e6 + info.id
    px = drawn.get(key)
  }
  if (!px) {
    px = person(L, f, arms, walking, face, closed, speaking, gesture, nod, o)
    if (cacheable) {
      if (drawn.size >= DRAWN_MAX) drawn.clear()
      drawn.set(key, px)
    }
  }
  const pal = info.pal
  const x0 = Math.round(x) - GX
  const y0 = Math.round(y) - GY
  const { w, h, p } = fb
  for (let k = 0; k < px.length; k++) {
    const v = px[k]!
    const pos = v & 2047
    const col = pal[v >>> 11]!
    const gx = pos % GW
    const gy = (pos - gx) / GW
    if (fb.clip) {
      fb.s(x0 + gx, y0 + gy, col)
      continue
    }
    const sx = x0 + gx
    const sy = y0 + gy
    if (sx >= 0 && sy >= 0 && sx < w && sy < h) p[sy * w + sx] = col
  }
}

/** A person's pixels on the scratch grid (see `drawn`). */
function person(
  L: Look, f: number, arms: Arms | undefined, walking: boolean, face: Face, closed: boolean, speaking: boolean, gesture: boolean, nod: boolean,
  o: PersonOpts,
): Uint32Array {
  const put = gput
  const del = gdel
  grid.fill(0)
  const side = face === 'left' || face === 'right'
  /** The walk step (approved round 5): one foot forward, passing, the other foot, passing. */
  const step = walking ? f % 4 : 1
  const rows = side ? SIDE : face === 'up' ? BACK : SPR
  for (let ry = 0; ry < rows.length; ry++) {
    if (o.seat && ry > 8) continue
    if (o.maxRow !== undefined && ry > o.maxRow) continue
    const row = rows[ry]!
    for (let rx = 0; rx < row.length; rx++) if (row[rx] !== '.') put(rx, ry, row[rx]!)
  }
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
      case 'eat':
        // Lunch (approved round 6): a sandwich in hand, at the mouth now and then.
        del(6, 8)
        if ((f >> 2) % 2) {
          put(6, 6, 's')
          for (const [a, b, ch] of [[6, 4, 'y'], [7, 4, 'y'], [6, 5, 'L'], [7, 5, 'y']] as const) put(a, b, ch)
        } else {
          put(7, 7, 's')
          for (const [a, b, ch] of [[7, 5, 'y'], [8, 5, 'y'], [7, 6, 'L'], [8, 6, 'y']] as const) put(a, b, ch)
        }
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
  let g = grid
  if (nod) {
    // The head (rows 0–4, hair and all) a pixel down for a moment.
    nodded.fill(0)
    const split = (4 + 1 + GY) * GW
    nodded.set(grid.subarray(split), split)
    for (let i = 0; i < split; i++) if (grid[i]) nodded[i + GW] = grid[i]!
    g = nodded
  }
  const flip = face === 'left'
  const pal = lookInfo(L).pal
  const out: number[] = []
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!
    if (!ch || pal[ch]! < 0) continue
    const gx = i % GW
    const gy = (i - gx) / GW
    const fx = flip ? 6 - (gx - GX) + GX : gx
    out.push((fx + gy * GW) | (ch << 11))
  }
  return Uint32Array.from(out)
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
