// Who stands where in the big office and how they get there: along the hallways,
// never through a desk. Pure; the module keeps one BigSim, which a reload starts
// over with everyone already in place.

import type { Role } from '../types'
import { ROLES, SEC_LOOKS, type View } from './office'
import { Life } from './life'

export type Pt = readonly [number, number]
/** A place to stand (x: the sprite's left edge, feet: its bottom row), reached from `at` on a hallway via `tail`. */
export type Spot = { x: number; feet: number; seat: boolean; at: Pt; tail: readonly Pt[] }

/** Where everyone comes in: the front door, back left. */
export const DOOR: Pt = [3, 21]

/** Hallways. `boss`: only the Manager walks there (behind the Manager's own desk). */
const LANES: { a: Pt; b: Pt; boss?: boolean }[] = [
  { a: [3, 21], b: [57, 21] }, // along the back wall
  { a: [16, 21], b: [16, 48] }, // left aisle
  { a: [43, 21], b: [43, 48] }, // right aisle
  { a: [2, 48], b: [57, 48] }, // across the front, behind the agents' chairs
  { a: [3, 42], b: [16, 42] }, // behind the Courier's desk
  { a: [43, 42], b: [51, 42] }, // behind the Typist's desk
  { a: [16, 42], b: [43, 42], boss: true }, // behind the Manager's desk
]

const spot = (at: Pt, tail: Pt[] = [], seat = false): Spot => {
  const e = tail[tail.length - 1] ?? at
  return { x: e[0], feet: e[1], seat, at, tail }
}
const desk = (i: number): Spot => spot([i * 16 + 2, 48], [[i * 16 + 2, 58]], true)

export const SPOTS: Record<string, Spot> = {
  door: spot(DOOR),
  archivist: spot([24, 21]),
  it: spot([44, 21]),
  courier: spot([3, 42], [], true),
  typist: spot([51, 42], [], true),
  janitor: spot([30, 48]),
  desk0: desk(0),
  desk1: desk(1),
  desk2: desk(2),
  desk3: desk(3),
  wait0: spot([13, 21]),
  wait1: spot([9, 21]),
  wait2: spot([3, 21]),
  // A break: the coffee machine under the window, the water cooler by the door, the plant.
  coffee: spot([51, 21]),
  chatA: spot([3, 21], [[3, 26]]),
  chatB: spot([17, 21], [[17, 26]]),
  chatC: spot([32, 21], [[32, 25]]),
  chatD: spot([39, 21], [[39, 25]]),
  plant: spot([43, 36], [[44, 36]]),
  visitCourier: spot([16, 42]),
  visitTypist: spot([43, 42]),
  // Plan mode: the meeting in front of the board.
  meet0: spot([23, 21], [[23, 22]]),
  meet1: spot([46, 21], [[46, 22]]),
  meet2: spot([30, 21], [[30, 28]]),
  meet3: spot([43, 28], [[42, 28]]),
  meet4: spot([18, 21], [[18, 27]]),
  meet5: spot([50, 21], [[50, 27]]),
  meet6: spot([43, 32], [[36, 32]]),
  // The Manager.
  chair: spot([29, 42], [], true),
  board: spot([36, 21]),
  supArchivist: spot([31, 21]),
  supIt: spot([37, 21]),
  supCourier: spot([16, 42]),
  supTypist: spot([43, 42]),
  // Right behind an agent's chair, clear of the next desks' bubbles.
  patrol0: spot([5, 48]),
  patrol1: spot([21, 48]),
  patrol2: spot([37, 48]),
  patrol3: spot([53, 48]),
  // Reporting a finished job: at either end of the Manager's desk, the Manager still in view.
  rep0: spot([16, 40]),
  rep1: spot([43, 40]),
}
export const DESKS = 4
/** Who owns each front desk; the last one is kept free for agents. An agent may borrow an owner's desk while they have no job. */
export const DESK_OWNER: readonly (Role | null)[] = ['researcher', 'planner', 'librarian', null]
/** The order agents take desks: the free one first, then the staff's, from the right. */
const AGENT_DESKS = [3, 2, 1, 0]

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
export function routeTo(from: Pt, to: string, boss = false): Pt[] {
  const g = boss ? GRAPHS.boss : GRAPHS.staff
  const s = SPOTS[to]
  if (!s) return [from]
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

export type Actor = {
  /** 'manager', a role, 'janitor' or 'sec:<agentId>' (an agent at a desk or in line at the door). */
  id: string
  /** The spot walked to. */
  dest: string
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
}

/** Walking speeds, pixels a tick (8 ticks a second). */
export const STROLL = 2
const hurry = (len: number) => Math.max(3, Math.ceil(len / 8))
const STAGGER = 4

export class BigSim {
  readonly actors = new Map<string, Actor>()
  readonly desks: (string | null)[] = Array(DESKS).fill(null)
  queue = 0
  tick = 0
  readonly life = new Life()
  private ready = false
  private readonly leaving = new Set<string>()
  /** Agent id → their look (index into the agent looks) while in the office: no two look alike. */
  private readonly looks = new Map<string, number>()

  /** Starts `id` walking to `dest` from where it stands (or from the door when new; in place when `instant`). */
  goTo(id: string, dest: string, o: { speed?: number; hurry?: boolean; delay?: number; instant?: boolean; leaving?: boolean } = {}): Actor {
    const boss = id === 'manager'
    let a = this.actors.get(id)
    if (a && a.dest === dest && a.leaving === !!o.leaving) {
      if (o.hurry) a.speed = Math.max(a.speed, hurry(a.length - a.t))
      return a
    }
    const from = a ? this.at(a) : DOOR
    const route = o.instant ? [[SPOTS[dest]?.x ?? DOOR[0], SPOTS[dest]?.feet ?? DOOR[1]] as Pt] : routeTo(from, dest, boss)
    const length = routeLength(route)
    const speed = o.hurry ? hurry(length) : (o.speed ?? STROLL)
    const delay = o.delay ?? 0
    if (!a) {
      a = { id, dest, route, length, t: 0, speed, delay, leaving: !!o.leaving, arrivedAt: -1 }
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

  here(id: string, dest?: string): boolean {
    const a = this.actors.get(id)
    return !!a && a.arrivedAt >= 0 && (dest === undefined || a.dest === dest)
  }

  /** Brings the office in line with `v`: agents to desks or the line, the janitor; the Life does the staff and the Manager. */
  sync(v: View): void {
    const instant = !this.ready
    this.ready = true
    let arriving = 0
    const bring = (id: string, dest: string) => {
      const a = this.actors.get(id)
      if (a && !a.leaving) return
      this.goTo(id, dest, instant ? { instant: true } : { speed: Math.max(2, Math.ceil(routeLength(routeTo(DOOR, dest)) / 16)), delay: STAGGER * arriving++ })
    }
    const send = (id: string) => {
      const a = this.actors.get(id)
      if (!a || a.leaving) return
      if (instant || a.delay > 0) return this.remove(id)
      this.goTo(id, 'door', { speed: Math.max(2, a.speed), leaving: true })
    }
    // Looks are kept only by agents in the office (a look frees up when its agent is out of the door).
    for (const id of [...this.looks.keys()]) if (!this.actors.has('sec:' + id)) this.looks.delete(id)
    const orderOf = new Map(v.secs.map(s => [s.id, s.order]))
    /** Agent `id` walks to `dest`: on from where they stand (the line moves up, a desk frees up), or in from the door. */
    const place = (id: string, dest: string) => {
      const key = 'sec:' + id
      const a = this.actors.get(key)
      if (a && !a.leaving && a.dest === dest) return
      // Nobody walks in looking like someone already inside; a look frees up in a moment (someone walking out).
      if (!this.giveLook(id, orderOf.get(id) ?? 0)) return
      if (!a || a.leaving) return bring(key, dest)
      this.goTo(key, dest, { speed: Math.max(STROLL, Math.ceil(routeLength(routeTo(this.at(a), dest)) / 16)) })
    }
    const secs = [...v.secs].sort((a, b) => a.order - b.order).map(s => ({ id: s.id, working: s.status === 'run' }))
    const wanted = new Map(secs.map(s => [s.id, s]))
    for (let i = 0; i < DESKS; i++) {
      const id = this.desks[i]
      if (id && !wanted.has(id)) {
        this.leaving.add(id)
        send('sec:' + id)
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
        send('sec:' + s.id)
      }
    }
    line = [...line].sort((a, b) => Number(b.working) - Number(a.working))
    // After Esc nobody moves, so no desk changes hands then (its owner couldn't step away).
    for (const i of AGENT_DESKS) {
      if (!line.length || v.frozen) break
      const owner = DESK_OWNER[i]
      if (this.desks[i] !== null || (owner && v.workers[owner])) continue
      this.desks[i] = line.shift()!.id
    }
    for (const i of AGENT_DESKS) {
      const id = this.desks[i]
      if (id && wanted.has(id) && !this.leaving.has(id)) place(id, 'desk' + i)
    }
    this.queue = line.length + [...this.leaving].filter(id => wanted.has(id)).length
    // The line at the door: the first three in line stand there themselves; anyone else there walks out.
    const front = line.slice(0, 3)
    front.forEach((s, k) => place(s.id, 'wait' + k))
    const inLine = new Set(front.map(s => 'sec:' + s.id))
    for (const a of [...this.actors.values()]) if (a.dest.startsWith('wait') && !inLine.has(a.id)) send(a.id)
    if (v.janitor) bring('janitor', 'janitor')
    else send('janitor')
    this.life.sync(this, v, instant)
  }

  /** One tick: the Life decides, everyone takes a step. Esc (frozen): nobody moves. */
  step(v: View): void {
    if (v.frozen) return
    this.tick++
    this.life.step(this, v)
    for (const a of [...this.actors.values()]) {
      if (a.delay > 0) {
        a.delay--
        continue
      }
      if (a.t < a.length) {
        a.t = Math.min(a.length, a.t + a.speed)
        if (a.t === a.length) a.arrivedAt = this.tick
      } else if (a.arrivedAt < 0) a.arrivedAt = this.tick
      if (a.leaving && a.arrivedAt >= 0) this.remove(a.id)
    }
  }

  remove(id: string): void {
    this.actors.delete(id)
    this.life.forget(id)
    if (!id.startsWith('sec:')) return
    const sec = id.slice(4)
    this.leaving.delete(sec)
    const i = this.desks.indexOf(sec)
    if (i >= 0) this.desks[i] = null
  }

  walking(): boolean {
    for (const a of this.actors.values()) if (a.delay > 0 || a.t < a.length) return true
    return false
  }

  doorOpen(): boolean {
    for (const a of this.actors.values()) if (a.dest === 'wait2' && !a.leaving) return true
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

  /** Who is on a break (or in the meeting) and doing what, for the list. */
  breakLine(v: View): { who: string; what: string } | null {
    return this.life.breakLine(this, v)
  }
}

export const isRole = (id: string): id is Role => (ROLES as readonly string[]).includes(id)
