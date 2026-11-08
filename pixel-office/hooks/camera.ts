// The small view: the full office at its own pixel size, seen through a window
// smaller than it (at most 64 × 32 pixels = 64 columns × 16 rows) that glides to
// where things happen. Pure.

import { BIG_COLS } from './big-scene'
import { Scene } from './big-sprites'
import type { View } from './office'

/** The full office's height in pixels. */
const OFFICE_H = 62
/** The window's tallest: 16 terminal rows. */
export const CAM_ROWS = 16
export const CAM_COLS = BIG_COLS

/** Where the window's top sits for each part of the office (even: whole terminal rows). */
const BACK = 0 // the back wall: door, cabinets, rack, board
const MIDDLE = 14 // the Manager's row, with the Courier and the Typist
const FRONT = 30 // the agents' desks

/** Where to look: the top row and the column to center, in pixels. */
export function focusOf(v: View): { top: number; center: number } {
  const busy = (r: 'archivist' | 'it') => v.workers[r]?.state === 'work'
  // The Manager needs you or just finished: look at the Manager.
  if (['permission', 'ask', 'done', 'stopped', 'hold'].includes(v.mood)) return { top: MIDDLE, center: 32 }
  if (v.secs.some(s => s.status === 'run')) return { top: FRONT, center: 32 }
  if (busy('archivist') || busy('it')) return { top: BACK, center: busy('archivist') && !busy('it') ? 22 : busy('it') && !busy('archivist') ? 46 : 34 }
  // Plan mode: the Manager walks to the board.
  if (v.mood === 'plan') return { top: BACK, center: 38 }
  return { top: MIDDLE, center: 32 }
}

export class Camera {
  top = MIDDLE
  left = 0
  private ready = false

  /** One step toward what `v` shows in a window `w` × `h` pixels: a row (2 pixels) and a column at a time. */
  step(v: View, w: number, h: number): void {
    const f = focusOf(v)
    const top = Math.max(0, Math.min(OFFICE_H - h, f.top)) & ~1
    const left = Math.max(0, Math.min(BIG_COLS - w, f.center - Math.floor(w / 2)))
    if (!this.ready) {
      // The first look (a new pane, a reload) is already in place.
      this.ready = true
      this.top = top
      this.left = left
      return
    }
    this.top += Math.sign(top - this.top) * Math.min(2, Math.abs(top - this.top))
    this.left += Math.sign(left - this.left) * Math.min(1, Math.abs(left - this.left))
  }

  /** Still gliding toward its spot. */
  moving(v: View, w: number, h: number): boolean {
    const f = focusOf(v)
    const top = Math.max(0, Math.min(OFFICE_H - h, f.top)) & ~1
    const left = Math.max(0, Math.min(BIG_COLS - w, f.center - Math.floor(w / 2)))
    return this.ready && (top !== this.top || left !== this.left)
  }

  /** The part of the full office in the window: its pixels and the words of its bubbles. */
  view(full: Scene, w: number, h: number): Scene {
    const out = new Scene(w, h)
    const src = full.fb
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) out.fb.p[y * w + x] = src.p[(y + this.top) * src.w + x + this.left] ?? -1
    const rowOff = this.top / 2
    for (const t of full.texts) {
      const row = t.row - rowOff
      const x = t.x - this.left
      if (row >= 0 && row < h / 2 && x >= 0 && x < w) out.texts.push({ ...t, row, x })
    }
    return out
  }
}
