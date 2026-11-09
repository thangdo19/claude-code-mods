// Who stands where in the big office and how they get there: along the hallways,
// never through a desk. Pure; the module keeps one BigSim, which a reload starts
// over with everyone already in place.

import type { Role } from '../types'
import { ROLES, SEC_LOOKS, type View } from './office'
import { Life, type Who } from './life'
import type { Face } from './art/people'
import { among, DESK_SPOTS, DESKS, DOOR, LANES, SPOTS, SWEEP_SPOTS, WAIT_SPOTS, type Pt, type SpotId } from './layout'
import { AGENT_DESKS, DESK_OWNER } from './world'
import { Cat } from './cat'

export type { Pt, Spot, SpotId } from './layout'
export { DESKS, DOOR, SPOTS } from './layout'

/** The Janitor sweeps slowly: pixels a tick. */
const SWEEP_SPEED = 1

export const routeLength = (r: readonly Pt[]): number => {
  let n = 0
  for (let i = 1; i < r.length; i++) n += Math.abs(r[i]![0] - r[i - 1]![0]) + Math.abs(r[i]![1] - r[i - 1]![1])
  return n
}
export function pointAt(r: readonly Pt[], t: number): { x: number; y: number } {
  for (let i = 1; i < r.length; i++) {
    const [ax, ay] = r[i - 1]!
    const [bx, by] = r[i]!
    const len = Math.abs(bx - ax) + Math.abs(by - ay)
    if (t <= len) {
      const k = len ? t / len : 0
      return { x: Math.round(ax + (bx - ax) * k), y: Math.round(ay + (by - ay) * k) }
    }
    t -= len
  }
  const e = r[r.length - 1] ?? DOOR
  return { x: e[0], y: e[1] }
}

/** Which way the route at `t` goes (at a corner, the way on): where someone walking it faces. */
export function dirAt(r: readonly Pt[], t: number): Face {
  for (let i = 1; i < r.length; i++) {
    const [ax, ay] = r[i - 1]!
    const [bx, by] = r[i]!
    const len = Math.abs(bx - ax) + Math.abs(by - ay)
    if (len && t < len) return Math.abs(bx - ax) >= Math.abs(by - ay) ? (bx > ax ? 'right' : 'left') : by > ay ? 'down' : 'up'
    t -= len
  }
  return 'down'
}

/* ===== the hallway map ===== */

const key = (p: Pt) => p[0] + ',' + p[1]
const onSeg = (p: Pt, a: Pt, b: Pt) =>
  (a[0] === b[0] && p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])) ||
  (a[1] === b[1] && p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]))

type Graph = { pts: Map<string, Pt>; next: Map<string, Map<string, number>>; edges: [Pt, Pt][] }

function buildGraph(boss: boolean): Graph {
  const pts = new Map<string, Pt>()
  const add = (p: Pt) => pts.set(key(p), p)
  const lanes = LANES.filter(l => boss || !l.boss)
  for (const l of lanes) {
    add(l.a)
    add(l.b)
  }
  for (const s of Object.values(SPOTS)) {
    add(s.at)
    s.tail.forEach(add)
  }
  // Where two hallways cross.
  for (const l of lanes)
    for (const m of lanes) {
      if (l.a[0] === l.b[0] && m.a[1] === m.b[1]) {
        const p: Pt = [l.a[0], m.a[1]]
        if (onSeg(p, l.a, l.b) && onSeg(p, m.a, m.b)) add(p)
      }
    }
  const next = new Map<string, Map<string, number>>()
  const edges: [Pt, Pt][] = []
  const link = (a: Pt, b: Pt) => {
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
    if (!d) return
    if (!next.has(key(a))) next.set(key(a), new Map())
    if (!next.has(key(b))) next.set(key(b), new Map())
    next.get(key(a))!.set(key(b), d)
    next.get(key(b))!.set(key(a), d)
    edges.push([a, b])
  }
  for (const l of lanes) {
    const on = [...pts.values()].filter(p => onSeg(p, l.a, l.b)).sort((p, q) => p[0] - q[0] || p[1] - q[1])
    for (let i = 1; i < on.length; i++) link(on[i - 1]!, on[i]!)
  }
  for (const s of Object.values(SPOTS)) {
    let prev = s.at
    for (const t of s.tail) {
      link(prev, t)
      prev = t
    }
  }
  return { pts, next, edges }
}

const GRAPHS = { staff: buildGraph(false), boss: buildGraph(true) }

/** The shortest walk from `from` (any point on a hallway or a spot's tail) to the spot `to`. */
export function routeTo(from: Pt, to: SpotId, boss = false): Pt[] {
  const g = boss ? GRAPHS.boss : GRAPHS.staff
  const s: { x: number; feet: number } = SPOTS[to]
  const goal = key([s.x, s.feet])
  const start = key(from)
  // A point between two corners: it joins both ends of its piece of hallway.
  const extra = new Map<string, number>()
  if (!g.pts.has(start)) {
    const e = g.edges.find(([a, b]) => onSeg(from, a, b))
    if (!e) return [from, [s.x, s.feet]]
    for (const p of e) extra.set(key(p), Math.abs(p[0] - from[0]) + Math.abs(p[1] - from[1]))
  }
  const dist = new Map<string, number>([[start, 0]])
  const prev = new Map<string, string>()
  const todo = new Set<string>([start])
  while (todo.size) {
    let u = ''
    let best = Infinity
    for (const k of todo) if ((dist.get(k) ?? Infinity) < best) [u, best] = [k, dist.get(k)!]
    todo.delete(u)
    if (u === goal) break
    const nb = u === start && extra.size ? extra : (g.next.get(u) ?? new Map<string, number>())
    for (const [v, d] of nb) {
      const nd = best + d
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd)
        prev.set(v, u)
        todo.add(v)
      }
    }
  }
  if (!dist.has(goal)) return [from, [s.x, s.feet]]
  const out: Pt[] = []
  for (let k: string | undefined = goal; k !== undefined; k = prev.get(k)) out.unshift(k === start ? from : g.pts.get(k)!)
  return out
}

/* ===== people ===== */

/** Who is in the office: the Manager, a staff member, the Janitor, or an agent (at a desk or in line at the door). */
export type ActorId = Who | 'janitor' | `sec:${string}`
/** Agent `id`'s actor; and the agent an actor is, if one. */
export const secActor = (id: string): `sec:${string}` => `sec:${id}`
export const agentOf = (actor: string): string | undefined => (actor.startsWith('sec:') ? actor.slice(4) : undefined)

export type Actor = {
  id: ActorId
  /** The spot walked to. */
  dest: SpotId
  route: readonly Pt[]
  length: number
  t: number
  speed: number
  /** Ticks to wait before setting off (people come in one after another). */
  delay: number
  /** Walking out: gone at the door. */
  leaving: boolean
  /** The tick of arrival at `dest`, or -1 while on the way. */
  arrivedAt: number
  /** Ticks spent walking (kept across a change of way, so the steps run on), for the walk step. */
  walked: number
}

/** Walking speeds, pixels a tick (8 ticks a second). A calm stroll (approved "Calm"): 1.5. */
export const STROLL = 1.5
const hurry = (len: number) => Math.max(3, Math.ceil(len / 8))
const STAGGER = 4

export class BigSim {
  readonly actors = new Map<ActorId, Actor>()
  readonly desks: (string | null)[] = Array(DESKS).fill(null)
  queue = 0
  tick = 0
  readonly life = new Life()
  /** The office cat (approved round 6): not staff, it walks the hallways on its own. */
  readonly cat = new Cat()
  private ready = false
  private readonly leaving = new Set<string>()
  /** Agent id → their look (index into the agent looks) while in the office: no two look alike. */
  private readonly looks = new Map<string, number>()

  /** Starts `id` walking to `dest` from where it stands (or from the door when new; in place when `instant`). */
  goTo(id: ActorId, dest: SpotId, o: { speed?: number; hurry?: boolean; delay?: number; instant?: boolean; leaving?: boolean } = {}): Actor {
    const boss = id === 'manager'
    let a = this.actors.get(id)
    if (a && a.dest === dest && a.leaving === !!o.leaving) {
      if (o.hurry) a.speed = Math.max(a.speed, hurry(a.length - a.t))
      return a
    }
    const from = a ? this.at(a) : DOOR
    const route = o.instant ? [[SPOTS[dest].x, SPOTS[dest].feet] as Pt] : routeTo(from, dest, boss)
    const length = routeLength(route)
    const speed = o.hurry ? hurry(length) : (o.speed ?? STROLL)
    const delay = o.delay ?? 0
    if (!a) {
      a = { id, dest, route, length, t: 0, speed, delay, leaving: !!o.leaving, arrivedAt: -1, walked: 0 }
      this.actors.set(id, a)
    } else Object.assign(a, { dest, route, length, t: 0, speed, delay, leaving: !!o.leaving, arrivedAt: -1 })
    if (length === 0 && a.delay === 0) a.arrivedAt = this.tick
    return a
  }

  /** Where `a` stands now. */
  at(a: Actor): Pt {
    const p = pointAt(a.route, a.t)
    return [p.x, p.y]
  }

  /** Which way `a` faces: where they walk; at rest, the front. */
  facing(a: Actor): Face {
    return a.t < a.length ? dirAt(a.route, a.t) : 'down'
  }

  here(id: ActorId, dest?: SpotId): boolean {
    const a = this.actors.get(id)
    return !!a && a.arrivedAt >= 0 && (dest === undefined || a.dest === dest)
  }

  /** Brings the office in line with `v`: agents to desks or the line, the janitor; the Life does the staff and the Manager. */
  sync(v: View): void {
    const instant = !this.ready
    this.ready = true
    let arriving = 0
    const bring = (id: ActorId, dest: SpotId) => {
      const a = this.actors.get(id)
      if (a && !a.leaving) return
      this.goTo(id, dest, instant ? { instant: true } : { speed: Math.max(2, Math.ceil(routeLength(routeTo(DOOR, dest)) / 16)), delay: STAGGER * arriving++ })
    }
    const send = (id: ActorId) => {
      const a = this.actors.get(id)
      if (!a || a.leaving) return
      if (instant || a.delay > 0) return this.remove(id)
      this.goTo(id, 'door', { speed: Math.max(2, a.speed), leaving: true })
    }
    // Looks are kept only by agents in the office (a look frees up when its agent is out of the door).
    for (const id of [...this.looks.keys()]) if (!this.actors.has(secActor(id))) this.looks.delete(id)
    const orderOf = new Map(v.secs.map(s => [s.id, s.order]))
    /** Agent `id` walks to `dest`: on from where they stand (the line moves up, a desk frees up), or in from the door. */
    const place = (id: string, dest: SpotId) => {
      const key = secActor(id)
      const a = this.actors.get(key)
      if (a && !a.leaving && a.dest === dest) return
      // Nobody walks in looking like someone already inside; a look frees up in a moment (someone walking out).
      if (!this.giveLook(id, orderOf.get(id) ?? 0)) return
      if (!a || a.leaving) return bring(key, dest)
      this.goTo(key, dest, { speed: Math.max(STROLL, Math.ceil(routeLength(routeTo(this.at(a), dest)) / 16)) })
    }
    // The Janitor cleans (compacting): agents at a desk in the middle of a job keep working; the rest step out
    // (waiting teammates, the line at the door) and come back after. No desk changes hands meanwhile.
    const out = v.janitor
    const secs = [...v.secs]
      .sort((a, b) => a.order - b.order)
      .map(s => ({ id: s.id, working: s.status === 'run' }))
      .filter(s => !out || (s.working && this.desks.includes(s.id)))
    const wanted = new Map(secs.map(s => [s.id, s]))
    for (let i = 0; i < DESKS; i++) {
      const id = this.desks[i]
      if (id && !wanted.has(id)) {
        this.leaving.add(id)
        send(secActor(id))
      }
    }
    const seated = new Set(this.desks.filter((d): d is string => d !== null))
    let line = secs.filter(s => !seated.has(s.id))
    for (let i = 0; i < DESKS; i++) {
      const id = this.desks[i]
      const s = id ? wanted.get(id) : undefined
      // A teammate waiting for a message gives its desk to a working agent. (A desk's owner with a job meanwhile
      // works on the phone: sending the teammate out and back on every job would be a parade through the door.)
      if (s && !s.working && !this.leaving.has(s.id) && line.some(x => x.working)) {
        this.leaving.add(s.id)
        send(secActor(s.id))
      }
    }
    line = [...line].sort((a, b) => Number(b.working) - Number(a.working))
    // After Esc nobody moves, so no desk changes hands then (its owner couldn't step away).
    for (const i of AGENT_DESKS) {
      if (!line.length || v.frozen || out) break
      const owner = DESK_OWNER[i]
      if (this.desks[i] !== null || (owner && v.workers[owner])) continue
      this.desks[i] = line.shift()!.id
    }
    for (const i of AGENT_DESKS) {
      const id = this.desks[i]
      if (id && wanted.has(id) && !this.leaving.has(id)) place(id, DESK_SPOTS[i]!)
    }
    this.queue = line.length + [...this.leaving].filter(id => wanted.has(id)).length
    // The line at the door: the first three in line stand there themselves; anyone else there walks out.
    const front = out ? [] : line.slice(0, 3)
    front.forEach((s, k) => place(s.id, WAIT_SPOTS[k]!))
    const inLine = new Set<ActorId>(front.map(s => secActor(s.id)))
    for (const a of [...this.actors.values()]) if (among(WAIT_SPOTS, a.dest) && !inLine.has(a.id)) send(a.id)
    if (v.janitor) bring('janitor', 'sweep0')
    else send('janitor')
    this.life.sync(this, v, instant)
  }

  /** One tick: the Life decides, everyone takes a step. Esc (frozen): nobody moves. */
  step(v: View): void {
    if (v.frozen) return
    this.tick++
    this.life.step(this, v)
    this.cat.step(this, v)
    this.sweep(v)
    for (const a of [...this.actors.values()]) {
      if (a.delay > 0) {
        a.delay--
        continue
      }
      if (a.t < a.length) {
        a.t = Math.min(a.length, a.t + a.speed)
        a.walked++
        if (a.t === a.length) a.arrivedAt = this.tick
      } else if (a.arrivedAt < 0) a.arrivedAt = this.tick
      if (a.leaving && a.arrivedAt >= 0) this.remove(a.id)
    }
  }

  /** The Janitor's round: a stop at each part of the office, sweeping a moment, then on to the next. */
  private sweep(v: View): void {
    const a = this.actors.get('janitor')
    if (!v.janitor || !a || a.leaving || !among(SWEEP_SPOTS, a.dest) || a.arrivedAt < 0) return
    const at = SWEEP_SPOTS.indexOf(a.dest)
    // 1.25 to 2.6 s at each stop, by stop (no dice: the same round every time).
    if (this.tick - a.arrivedAt < 10 + ((at * 7) % 12)) return
    this.goTo('janitor', SWEEP_SPOTS[(at + 1) % SWEEP_SPOTS.length]!, { speed: SWEEP_SPEED })
  }

  remove(id: ActorId): void {
    this.actors.delete(id)
    this.life.forget(id)
    const sec = agentOf(id)
    if (sec === undefined) return
    this.leaving.delete(sec)
    const i = this.desks.indexOf(sec)
    if (i >= 0) this.desks[i] = null
  }

  walking(): boolean {
    for (const a of this.actors.values()) if (a.delay > 0 || a.t < a.length) return true
    return false
  }

  doorOpen(): boolean {
    for (const a of this.actors.values()) if ((a.dest === 'wait2' || (a.id === 'courier' && a.dest === 'door')) && !a.leaving) return true
    for (const a of this.actors.values()) {
      if (a.delay > 0 || a.t >= a.length) continue
      const p = this.at(a)
      if (Math.abs(p[0] - DOOR[0]) + Math.abs(p[1] - DOOR[1]) < 7) return true
    }
    return false
  }

  /** The front desk an agent has borrowed from `r`, if any. */
  borrowed(r: Role): boolean {
    const i = DESK_OWNER.indexOf(r)
    return i >= 0 && this.desks[i] !== null
  }

  /** Agent `id`'s look (an index into the agent looks), while they're in the office. */
  lookOf(id: string): number | undefined {
    return this.looks.get(id)
  }

  /** Gives agent `id` a look nobody in the office has: theirs by spawn order, or the next free one. */
  private giveLook(id: string, order: number): boolean {
    if (this.looks.has(id)) return true
    const used = new Set(this.looks.values())
    for (let k = 0; k < SEC_LOOKS; k++) {
      const n = (((order + k) % SEC_LOOKS) + SEC_LOOKS) % SEC_LOOKS
      if (used.has(n)) continue
      this.looks.set(id, n)
      return true
    }
    return false
  }

  seated(): (string | null)[] {
    return this.desks.map(id => (id && !this.leaving.has(id) ? id : null))
  }

  /** What staff member `r` (no job now) is doing, for their line in the list. */
  doing(v: View, r: Role): string {
    return this.life.doing(this, v, r)
  }
}

export const isRole = (id: string): id is Role => (ROLES as readonly string[]).includes(id)
