// The furniture (approved art): walls and floor, desks, chairs, monitors, the rack, cabinets, the door, the window,
// the clock, the plant, the coffee machine, the water cooler, the brass signs. Pure drawing.

import { shade } from '../gfx/color'
import { FB, type Scene } from '../gfx/fb'
import { OUT, P, PHONE } from './palette'

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
/** The Manager's leather chair, 11 × 14: a rounded top, a buttoned back. */
export function bossChair(fb: FB, x: number, y: number): void {
  fb.r(x + 1, y, 9, 1, '#8a4a35')
  fb.r(x, y + 1, 11, 13, P.chair)
  fb.r(x + 1, y + 2, 9, 11, P.chair2)
  fb.r(x + 1, y + 1, 9, 1, '#7a4230')
  for (const [a, b] of [[5, 4], [3, 6], [7, 6], [5, 8], [3, 10], [7, 10]] as const) fb.s(x + a, y + b, '#4a2a1e')
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
/** A name tag (approved round 8, "Black and gold"): a black nameplate with gold letters, as wide as the name, centered on cx. */
export function nameplate(sc: Scene, cx: number, row: number, name: string): void {
  sc.text(cx - Math.floor(name.length / 2), row, name, '#f0cf6a', '#2b2420')
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
