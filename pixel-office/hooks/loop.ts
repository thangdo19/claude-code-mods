// The pane's loop: everything the mod keeps while it runs (one Runtime), how it stores a change to the office, and
// the tick (8 a second) that moves everyone and repaints the picture when it changed.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Office } from '../types'
import { EMPTY, lines, view, type Line, type View } from './office'
import { CellCoder, type Cells } from './cells'
import { renderBig } from './scene'
import type { Scene } from './gfx/fb'
import { BigSim } from './walk'
import { Calm } from './calm'
import { Camera } from './camera'

/** The pane's id (the same as in pane.tsx). */
const PANE = 'office'

// Change the tag when Office's fields change: it declines what an older version stored. (Only this file reads and
// writes it: the mod's scan wants the atom in the file that uses it.)
const office = atom({ plugin: 'pixel-office', key: 'office' } as const, EMPTY, { shape: 'office-1' })

/** The full office (`rows` of it, `skip` rows left off the top), or the camera's window on it (see `shapeFor`). */
export type Shape = { kind: 'big'; rows: number; skip: number } | { kind: 'cam'; cols: number; rows: number; beside: boolean }

/** The list reads the same (names, words, tones): nothing to repaint for it. */
const sameList = (a: readonly Line[], b: readonly Line[]) =>
  a.length === b.length && a.every((l, i) => l.who === b[i]!.who && l.what === b[i]!.what && l.tone === b[i]!.tone)

/** Everything the mod keeps while it runs. A reload starts it over and rebuilds it from $.state. */
class Runtime {
  /** The office as last stored or read. */
  latest: Office = EMPTY
  /** The session's folder, for short paths in the list. */
  cwd: string | undefined
  /** What the pane last drew: the timer repaints the same Raster. */
  mounted: { shape: Shape; inline: boolean; viewing?: string } | null = null
  readonly sim = new BigSim()
  readonly camera = new Camera()
  /** What the Manager shows: a fast think/tool loop does not flash bubbles. */
  readonly calm = new Calm()
  /** The pane's frames as Raster cells: a frame like the last one is not encoded again. */
  private readonly coder = new CellCoder()
  /** The cells and the list the pane shows now. */
  lastCells = ''
  lastList: readonly Line[] = []
  /** Ticks so far (8 a second). */
  tick = 0
  /** Someone walked (or the camera glided) last tick: the frame where they stop is drawn too. */
  wasMoving = false
  /** Eco (approved round 11): a quiet office with nobody walking is drawn 2 times a second, not 4 (see `onTick`). */
  eco = false
  /**
   * The picture's frame, in quarters: a tick adds 2 (a frame every 2 ticks, 4 a second), an eco tick 1 (2 a second).
   * So every frame drawn is one on from the last, at either pace. (By the tick alone, a frame drawn every 4th tick
   * was always even, and whatever takes turns frame by frame froze: a talker's mouth, the cooler's bubbles.)
   */
  quarters = 0
  ticking = false
  timerStarted = false
  /** Calls the person said no to (the dialog's answer comes before the call ends). */
  readonly deniedCalls = new Set<string>()
  /** Whose call the open "Your OK?" is for: an agent's id, or undefined for the Manager's own. */
  askedBy: string | undefined
  /** AskUserQuestion calls open now (their "Question?" ends with them, not with another call). */
  asking = 0

  /** The picture every frame is drawn on (one, drawn over: no new one a frame). */
  private scene: Scene | undefined

  /** The office now, as the pane shows it (`shape`), with the desk of the agent being viewed framed. */
  draw(v: View, shape: Shape, viewing?: string): Cells {
    const full = (this.scene = renderBig(v, this.sim, this.quarters >> 2, this.tick, viewing, this.scene))
    // (The camera's window is read straight from the full office: no copy of it first.)
    return shape.kind === 'big' ? this.coder.encode(full, shape.skip, shape.rows) : this.coder.window(full, this.camera.left, this.camera.top, shape.cols, shape.rows)
  }
}

export const rt = new Runtime()

/** Reads the stored office (and keeps it as `rt.latest`). */
export async function load($: EngineInterface): Promise<Office> {
  rt.latest = { ...EMPTY, ...(await read($, office)) }
  return rt.latest
}

/** Stores a change to the office (and keeps it as `rt.latest`). */
export async function change($: EngineInterface, fn: (o: Office, now: number) => Office): Promise<void> {
  const now = await $.clock.now()
  rt.latest = await update($, office, o => fn({ ...EMPTY, ...o }, now))
}

/** 8 times a second: people take a step, the picture repaints when it changed. */
export async function onTick($: EngineInterface): Promise<void> {
  if (rt.ticking || !rt.mounted) return
  rt.ticking = true
  try {
    rt.tick++
    const now = await $.clock.now()
    const v = view(rt.latest, now, real => rt.calm.step(real, now))
    rt.sim.sync(v)
    rt.sim.step(v)
    const cam = rt.mounted.shape.kind === 'cam' ? rt.mounted.shape : null
    if (cam) rt.camera.step(v, cam.cols, cam.rows * 2, rt.sim)
    const moving = rt.sim.walking() || (cam !== null && rt.camera.moving())
    // Above the prompt (classic renderer) the picture moves only while someone walks, at most
    // 4 frames a second, so the terminal has little to redraw; beside the transcript it is alive.
    // The frame where everyone stops (a bubble appears) is always drawn. The dark office (night, nobody inside) is
    // drawn once a second; a night with someone still in (an agent, the Manager on hold) as by day. A quiet office
    // (Eco, approved round 11: between turns, nobody at work) is drawn twice a second.
    const stopped = rt.wasMoving && !moving
    rt.wasMoving = moving
    rt.eco = !moving && rt.sim.quiet(v)
    rt.quarters += rt.eco ? 1 : 2
    const drawNow =
      stopped || !((rt.mounted.inline && (!moving || rt.tick % 2)) || (!moving && rt.tick % 2) || (rt.sim.dark(v) && !moving && rt.tick % 8) || (rt.eco && rt.tick % 4))
    // The list changes with time as well (a break changes, "Done!" fades): looked at 4 times a second, and on
    // every frame drawn. When it changed the whole pane is drawn again (ui.render), the picture with it: no
    // frame of our own then, it would be drawn twice.
    if (drawNow || rt.tick % 2 === 0) {
      const all = lines(v, rt.sim.seated(), r => rt.sim.doing(v, r), id => rt.sim.lookOf(id), rt.sim.closing(v))
      if (!sameList(all, rt.lastList)) {
        rt.lastList = all
        $.ui.invalidate('ui.render')
        return
      }
    }
    if (!drawNow) return
    const c = rt.draw(v, rt.mounted.shape, rt.mounted.viewing)
    if (c.cells === rt.lastCells) return
    rt.lastCells = c.cells
    const r = await $.ui.blit({ requestId: PANE, key: 'office', cells: c.cells })
    if (r.deny) rt.mounted = null
  } catch {
    // A missed frame; the next tick tries again.
  } finally {
    rt.ticking = false
  }
}
