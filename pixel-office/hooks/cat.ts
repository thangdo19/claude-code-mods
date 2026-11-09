// The office cat (approved round 6). Not staff (no list line, no job): it strolls the hallways, naps on the windowsill
// above the warm coffee machine, sits on a free front desk by the monitor (the Planner's or the agents', not the plant
// corner or the video-call screen), or just sits a while. Seeded, so the same office shows the same cat.

import type { View } from './office'
import { dirAt, pointAt, routeLength, routeTo, type BigSim } from './walk'
import { SPOTS, type Pt, type SpotId } from './layout'

export type CatPose = 'walk' | 'sit' | 'nap'

const STOPS: readonly SpotId[] = ['catSill', 'catDesk1', 'catDesk3', 'catMid', 'catRight', 'catCooler']
/** The front desk each desk stop is at. */
const DESK_AT: Partial<Record<SpotId, number>> = { catDesk1: 1, catDesk3: 3 }
/** The cat walks a little slower than a stroll. */
const SPEED = 1

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Cat {
  private rand = rng(42)
  dest: SpotId = 'catSill'
  route: Pt[] = [[SPOTS.catSill.x, SPOTS.catSill.feet]]
  t = 0
  length = 0
  until = 0
  walked = 0
  /** Which way it last walked across (it faces that way). */
  right = false

  /** Where it is (its feet), and how it looks. */
  at(): Pt {
    const p = pointAt(this.route, this.t)
    return [p.x, p.y]
  }
  pose(): CatPose {
    if (this.t < this.length) return 'walk'
    return this.dest === 'catSill' ? 'nap' : 'sit'
  }
  /** The front desk it sits on, if one. */
  desk(): number {
    return this.t >= this.length ? (DESK_AT[this.dest] ?? -1) : -1
  }

  step(sim: BigSim, v: View): void {
    if (this.t < this.length) {
      this.t = Math.min(this.length, this.t + SPEED)
      this.walked++
      const d = dirAt(this.route, this.t)
      if (d === 'left' || d === 'right') this.right = d === 'right'
      if (this.t === this.length) this.until = sim.tick + this.stay(v)
      return
    }
    // A desk it sits on is taken (an agent sat down, or its owner came back): off it goes.
    const k = this.desk()
    const taken = k >= 0 && (sim.seated()[k] !== null || [...sim.actors.values()].some(a => a.dest === 'desk' + k && !a.leaving))
    if (sim.tick < this.until && !taken) return
    // Night: back to the sill to sleep.
    const next = v.night ? 'catSill' : this.pick(sim)
    if (next === this.dest) {
      this.until = sim.tick + this.stay(v)
      return
    }
    this.route = routeTo(this.at(), next)
    this.length = routeLength(this.route)
    this.t = 0
    this.dest = next
  }

  private pick(sim: BigSim): SpotId {
    const seated = sim.seated()
    const free = STOPS.filter(s => {
      const i = DESK_AT[s]
      if (i === undefined) return s !== this.dest
      // A desk with nobody at it, and nobody coming.
      return seated[i] === null && ![...sim.actors.values()].some(a => a.dest === 'desk' + i && !a.leaving) && s !== this.dest
    })
    // The sill most often.
    if (this.dest !== 'catSill' && this.rand() < 0.4) return 'catSill'
    return free[Math.floor(this.rand() * free.length)] ?? 'catSill'
  }

  /** Ticks to stay: a long nap, a shorter sit. */
  private stay(v: View): number {
    if (this.dest === 'catSill') return v.night ? 4000 : 160 + Math.floor(this.rand() * 160)
    return 64 + Math.floor(this.rand() * 96)
  }
}
