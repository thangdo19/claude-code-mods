// The small view: the full office at its own pixel size, seen through a window
// smaller than it (at most 64 × 32 pixels = 64 columns × 16 rows) that glides to
// where things happen. Pure.

import { Scene } from './gfx/fb'
import { BIG_COLS, CAMERA, OFFICE_H, type SpotId } from './layout'
import { isMeeting, isUrgent } from './moods'
import type { View } from './office'
import type { Actor, BigSim } from './walk'

/** The window's tallest: 16 terminal rows. */
export const CAM_ROWS = 16
export const CAM_COLS = BIG_COLS

const { back: BACK, middle: MIDDLE, front: FRONT, center: CENTER } = CAMERA

/** How long the camera looks at each break spot on its tour, ms. */
const TOUR_MS = 20_000

/** The break spots the camera tours between turns. */
const TOUR: readonly SpotId[] = ['chatA', 'chatC', 'coffee', 'plant', 'visitCourier', 'visitTypist']
/** The first one in the office who `is` (no copy of everyone). */
const someone = (sim: BigSim, is: (a: Actor) => boolean): Actor | undefined => {
  for (const a of sim.actors.values()) if (is(a)) return a
  return undefined
}

/** The part of the office (top row) where pixel row `feet` is. */
const partOf = (feet: number) => (feet <= CAMERA.backTo ? BACK : feet <= CAMERA.middleTo ? MIDDLE : FRONT)

/** Where to look: the top row and the column to center, in pixels. */
export function focusOf(v: View, sim?: BigSim): { top: number; center: number } {
  const busy = (r: 'archivist' | 'it') => v.workers[r]?.state === 'work'
  // Plan mode: the meeting at the board, its dialogs too.
  if (v.planning && isMeeting(v.mood)) return { top: BACK, center: CENTER.board }
  // The Manager needs you or just finished: look at the Manager.
  if (isUrgent(v.mood)) return { top: MIDDLE, center: CENTER.boss }
  // Compacting: follow the Janitor's round (everyone else stepped out).
  const j = v.janitor ? sim?.actors.get('janitor') : undefined
  if (sim && j) {
    const [x, y] = sim.at(j)
    return { top: partOf(y), center: x + 3 }
  }
  if (v.secs.some(s => s.status === 'run') || (['researcher', 'planner', 'librarian'] as const).some(r => v.workers[r]?.state === 'work')) return { top: FRONT, center: CENTER.frontDesks }
  if (busy('archivist') || busy('it'))
    return { top: BACK, center: busy('archivist') && !busy('it') ? CENTER.files : busy('it') && !busy('archivist') ? CENTER.rack : CENTER.filesAndRack }
  // Plan mode: the Manager walks to the board.
  if (v.mood === 'plan') return { top: BACK, center: CENTER.board }
  const m = sim?.actors.get('manager')
  if (sim && m && m.dest !== 'chair') {
    const [x, y] = sim.at(m)
    return { top: partOf(y), center: x + 3 }
  }
  // Between turns: now and then a look at whoever is chatting or making coffee, then back to the Manager.
  if (sim && v.mood === 'idle' && !v.night) {
    const spots = TOUR.filter(d => someone(sim, a => a.dest === d && a.arrivedAt >= 0))
    const k = Math.floor(v.now / TOUR_MS) % (spots.length + 1)
    const d = spots[k - 1]
    if (d) {
      const a = someone(sim, x => x.dest === d)!
      const [x, y] = sim.at(a)
      return { top: partOf(y), center: d === 'chatA' ? CENTER.cooler : d === 'chatC' ? CENTER.boardChat : x + 3 }
    }
  }
  return { top: MIDDLE, center: CENTER.boss }
}

export class Camera {
  top: number = MIDDLE
  left = 0
  private ready = false
  /** Where the last step was headed (the focus is worked out once a step). */
  private goal: { top: number; left: number } = { top: MIDDLE, left: 0 }

  /** One step toward what `v` shows in a window `w` × `h` pixels: a row (2 pixels) and a column at a time. */
  step(v: View, w: number, h: number, sim?: BigSim): void {
    const f = focusOf(v, sim)
    const top = Math.max(0, Math.min(OFFICE_H - h, f.top)) & ~1
    const left = Math.max(0, Math.min(BIG_COLS - w, f.center - Math.floor(w / 2)))
    this.goal = { top, left }
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

  /** Still gliding toward where the last step was headed. */
  moving(): boolean {
    return this.ready && (this.goal.top !== this.top || this.goal.left !== this.left)
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
