// The lights are off (approved round 9, "Moonlight"): everyone has gone home for the night. The whole picture goes
// dark navy; what glows keeps its light (the window, the rack's lights, the Christmas lights); a pale patch of
// moonlight lies on the floor by the window. Nobody is inside then, so no person is ever dimmed. Pure.

import { C, mix } from '../gfx/color'
import type { Scene } from '../gfx/fb'

const NAVY = C('#0b1230')
/** How far toward navy, in percent: the room, and the floor in the moonlight. */
const DARK = 64
const MOONLIT = 30
const luts = new Map<number, Map<number, number>>()
/** Colors mixed `t`% toward navy, each worked out once. */
const toward = (t: number) => {
  let m = luts.get(t)
  if (!m) luts.set(t, (m = new Map()))
  const lut = m
  return (c: number): number => {
    let d = lut.get(c)
    if (d === undefined) lut.set(c, (d = mix(c, NAVY, t / 100)))
    return d
  }
}
const dark = toward(DARK)
const lit = toward(MOONLIT)

/** Darkens the finished picture and its letters; `glow` pixels stay as they are, `moon` pixels are only half dark. */
export function lightsOff(sc: Scene, glow: (x: number, y: number, c: number) => boolean, moon: (x: number, y: number) => boolean): void {
  const { p, w, h } = sc.fb
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const c = p[i]!
      if (c < 0 || glow(x, y, c)) continue
      p[i] = moon(x, y) ? lit(c) : dark(c)
    }
  for (const t of sc.texts) {
    t.fg = dark(t.fg)
    t.bg = dark(t.bg)
  }
}
