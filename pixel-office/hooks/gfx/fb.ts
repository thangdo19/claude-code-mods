// The pixel grid a picture is drawn on (FB), the text cells over it (Scene), and copies of art that never changes
// (`still`). Two pixel rows make one terminal row. Pure.

import { plain } from '../labels'
import { C, type Paint } from './color'

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

/**
 * Art that never changes (a desk, a chair, the walls), drawn once and then copied: each run of drawn pixels in a row
 * order, put back with `Int32Array.set`. `key` names the drawing and every argument it takes. The drawing must only
 * paint (never read what is under it, as a bubble's shadow does).
 */
const stamps = new Map<string, { at: number[]; runs: Int32Array[] }>()
export function still(fb: FB, key: string, draw: (fb: FB) => void): void {
  if (fb.clip) return draw(fb)
  const k = fb.w + 'x' + fb.h + ' ' + key
  let st = stamps.get(k)
  if (!st) {
    const tmp = new FB(fb.w, fb.h)
    draw(tmp)
    st = { at: [], runs: [] }
    const p = tmp.p
    for (let i = 0; i < p.length; ) {
      if (p[i]! < 0) {
        i++
        continue
      }
      let j = i
      while (j < p.length && p[j]! >= 0) j++
      st.at.push(i)
      st.runs.push(p.slice(i, j))
      i = j
    }
    stamps.set(k, st)
  }
  for (let r = 0; r < st.runs.length; r++) fb.p.set(st.runs[r]!, st.at[r]!)
}

/** A character drawn in one terminal cell (two pixel rows) over the pixels. */
export type TextCell = { x: number; row: number; ch: string; fg: number; bg: number }

export class Scene {
  readonly fb: FB
  readonly texts: TextCell[] = []
  constructor(w: number, h: number) {
    this.fb = new FB(w, h)
  }
  /** Blank again, to draw the next frame on (the pane keeps one Scene; see `renderBig`'s `into`). */
  reset(): void {
    this.fb.p.fill(-1)
    this.fb.clip = null
    this.texts.length = 0
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
