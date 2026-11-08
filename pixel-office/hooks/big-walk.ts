// Who stands where in the big office: people walk in through the front door to
// their spot and back out along the hallway. Pure; the module keeps one BigSim,
// which a reload starts over with everyone already at their spot.

export type Pt = readonly [number, number]
export type Row = 'back' | 'mid' | 'front' | 'aisle'
export type Spot = { x: number; feet: number; row: Row; seat: boolean; route: readonly Pt[] }

/** Where everyone comes in: the front door, back left. */
export const DOOR: Pt = [3, 21]
// Hallways: along the back wall (y 21), down the left aisle (x 16), down the right aisle (x 43),
// and across the front (y 48). Desks hide the legs of whoever walks behind them.
const back = (x: number): Spot => ({ x, feet: 21, row: 'back', seat: false, route: [[x, 21]] })
const desk = (i: number): Spot => {
  const x = i * 16 + 2
  return { x, feet: 58, row: 'front', seat: true, route: [[16, 21], [16, 48], [x, 48], [x, 58]] }
}
export const SPOTS: Record<string, Spot> = {
  archivist: back(24),
  it: back(44),
  courier: { x: 3, feet: 42, row: 'mid', seat: true, route: [[16, 21], [16, 42], [3, 42]] },
  typist: { x: 51, feet: 42, row: 'mid', seat: true, route: [[43, 21], [43, 42], [51, 42]] },
  janitor: { x: 30, feet: 48, row: 'aisle', seat: false, route: [[16, 21], [16, 48], [30, 48]] },
  desk0: desk(0),
  desk1: desk(1),
  desk2: desk(2),
  desk3: desk(3),
  wait0: back(13),
  wait1: back(9),
  wait2: back(3),
}
export const DESKS = 4
/** The Manager's walk from the chair to the board, for plan mode. */
export const MANAGER_ROUTE: readonly Pt[] = [[29, 42], [43, 42], [43, 21], [36, 21]]

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

export type Actor = { id: string; spot: string; route: readonly Pt[]; length: number; t: number; goal: 'in' | 'out'; delay: number; speed: number }
export type Want = { staff: readonly string[]; secs: readonly { id: string; working: boolean }[]; plan: boolean }

const STAGGER = 4
const TRIP_TICKS = 16

export class BigSim {
  readonly actors = new Map<string, Actor>()
  readonly desks: (string | null)[] = Array(DESKS).fill(null)
  queue = 0
  managerT = 0
  managerGoal: 'seat' | 'board' = 'seat'
  private ready = false
  private readonly leaving = new Set<string>()

  sync(w: Want): void {
    const instant = !this.ready
    this.ready = true
    let arriving = 0
    const bring = (id: string, spot: string) => {
      const a = this.actors.get(id)
      if (a) {
        a.goal = 'in'
        return
      }
      const route = [DOOR, ...(SPOTS[spot]?.route ?? [])]
      const length = routeLength(route)
      this.actors.set(id, {
        id, spot, route, length, t: instant ? length : 0, goal: 'in',
        delay: instant ? 0 : STAGGER * arriving++, speed: Math.max(2, Math.ceil(length / TRIP_TICKS)),
      })
    }
    const send = (id: string) => {
      const a = this.actors.get(id)
      if (!a) return
      a.goal = 'out'
      if (instant || a.delay > 0) this.remove(id)
    }
    const wanted = new Map(w.secs.map(s => [s.id, s]))
    for (let i = 0; i < DESKS; i++) {
      const id = this.desks[i]
      if (id && !wanted.has(id)) {
        this.leaving.add(id)
        send('sec:' + id)
      }
    }
    const seated = new Set(this.desks.filter((d): d is string => d !== null))
    let line = w.secs.filter(s => !seated.has(s.id))
    for (let i = 0; i < DESKS; i++) {
      const id = this.desks[i]
      const s = id ? wanted.get(id) : undefined
      if (s && !s.working && !this.leaving.has(s.id) && line.some(x => x.working)) {
        this.leaving.add(s.id)
        send('sec:' + s.id)
      }
    }
    line = [...line].sort((a, b) => Number(b.working) - Number(a.working))
    for (let i = 0; i < DESKS && line.length; i++) {
      if (this.desks[i] !== null) continue
      const s = line.shift()!
      this.desks[i] = s.id
      bring('sec:' + s.id, 'desk' + i)
    }
    for (let i = 0; i < DESKS; i++) {
      const id = this.desks[i]
      if (id && wanted.has(id) && !this.leaving.has(id)) bring('sec:' + id, 'desk' + i)
    }
    this.queue = line.length + [...this.leaving].filter(id => wanted.has(id)).length
    const want = new Set<string>(w.staff)
    for (let k = 0; k < Math.min(3, this.queue); k++) want.add('wait' + k)
    for (const id of want) bring(id, id)
    for (const id of [...this.actors.keys()]) if (!id.startsWith('sec:') && !want.has(id)) send(id)
    this.managerGoal = w.plan ? 'board' : 'seat'
    if (instant) this.managerT = w.plan ? routeLength(MANAGER_ROUTE) : 0
  }

  step(frozen: boolean): void {
    if (frozen) return
    for (const a of [...this.actors.values()]) {
      if (a.delay > 0) {
        a.delay--
        continue
      }
      a.t = a.goal === 'in' ? Math.min(a.length, a.t + a.speed) : Math.max(0, a.t - a.speed)
      if (a.goal === 'out' && a.t === 0) this.remove(a.id)
    }
    const end = routeLength(MANAGER_ROUTE)
    this.managerT = this.managerGoal === 'board' ? Math.min(end, this.managerT + 3) : Math.max(0, this.managerT - 3)
  }

  private remove(id: string): void {
    this.actors.delete(id)
    if (!id.startsWith('sec:')) return
    const sec = id.slice(4)
    this.leaving.delete(sec)
    const i = this.desks.indexOf(sec)
    if (i >= 0) this.desks[i] = null
  }

  walking(): boolean {
    const end = routeLength(MANAGER_ROUTE)
    if (this.managerT > 0 && this.managerT < end) return true
    for (const a of this.actors.values()) if (a.delay > 0 || (a.goal === 'in' ? a.t < a.length : a.t > 0)) return true
    return false
  }

  doorOpen(): boolean {
    if (this.actors.has('wait2')) return true
    for (const a of this.actors.values()) if (a.delay === 0 && a.t < 7 && (a.goal === 'out' || a.t < a.length)) return true
    return false
  }

  seated(): (string | null)[] {
    return this.desks.map(id => (id && !this.leaving.has(id) ? id : null))
  }
}
