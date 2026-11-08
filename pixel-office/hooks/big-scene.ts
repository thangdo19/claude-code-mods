// The big office, as designed in the plan artifact: 64 × 62 pixels = 64 columns
// × 31 rows, three rows of desks, people walking in through the front door.
// Pure: no Claude Code calls.

import type { Role, Sec } from '../types'
import {
  board, cabinet, clock, desk, door, drawPerson, globe, LOOK, monitor, officeChair, P, plant, rack, room, Scene,
  secLook, textBubble, thinkBubble, typewriter, windowPane, zzz, type Arms, type Look,
} from './big-sprites'
import { ROLES, type View } from './office'
import type { Tone } from './office'
import { DESKS, MANAGER_ROUTE, pointAt, routeLength, SPOTS, type BigSim, type Want } from './big-walk'

export const BIG_COLS = 64
export const BIG_ROWS = 31

export function bigWantOf(v: View): Want {
  const staff: string[] = ROLES.filter(r => v.workers[r] !== undefined)
  if (v.janitor) staff.push('janitor')
  return { staff, secs: [...v.secs].sort((a, b) => a.order - b.order).map(s => ({ id: s.id, working: s.status === 'run' })), plan: v.mood === 'plan' }
}

const MANAGER_ARMS: Record<string, Arms> = { idle: 'sleep', think: 'chin', write: 'type', work: 'mug', permission: 'raise', ask: 'raise', done: 'mug', stopped: 'down', hold: 'phone' }
const MANAGER_BUBBLE: Record<string, [string, Tone]> = {
  write: ['writing..', ''], permission: ['Your OK?', 'warn'], ask: ['Question?', 'warn'], done: ['Done!', 'good'],
  stopped: ['Stopped', 'bad'], hold: ['On hold', 'bad'], plan: ['Planning', ''],
}
const BUBBLE_ROW = { back: 2, mid: 12, front: 20, aisle: 0 } as const

/** The whole office at frame `f` (4 a second) and tick `tick` (8 a second, for walking legs). */
export function renderBig(v: View, sim: BigSim, f: number, tick: number, viewing?: string): Scene {
  const sc = new Scene(BIG_COLS, BIG_ROWS * 2)
  const fb = sc.fb
  const F = v.frozen ? 3 : f
  const draws: [number, () => void][] = []
  const at = (key: number, fn: () => void) => draws.push([key, fn])
  const busy = (r: Role) => v.workers[r]?.state === 'work'

  room(fb)
  door(fb, 2, 4, 8, 17, sim.doorOpen())
  clock(fb, 25, 2, F)
  const todos = v.todos?.map(t => (t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo') as 'done' | 'doing' | 'todo') ?? null
  board(fb, 31, 2, 16, 11, todos, v.mood === 'plan', F)
  windowPane(fb, 58, 2, 6, 10, v.night, F)
  const it = v.workers.it
  at(20.5, () => {
    cabinet(fb, 16, 8, 4, 13, busy('archivist'), F)
    cabinet(fb, 20, 8, 4, 13, false, F)
    rack(fb, 51, 5, 6, 16, it?.state === 'error' ? 'error' : it?.state === 'work' ? 'busy' : 'idle', F, v.bg.length)
  })
  at(41.4, () => {
    fb.r(26, 26, 11, 15, P.chair)
    fb.r(27, 27, 9, 13, P.chair2)
    fb.r(27, 26, 9, 1, '#8a4a35')
  })
  at(41.5, () => {
    officeChair(fb, 2, 33, 9, 9)
    officeChair(fb, 50, 33, 9, 9)
  })
  at(44.5, () => {
    desk(fb, 0, 39, 16, 6)
    globe(fb, 10, 32, busy('courier'), F)
    desk(fb, 23, 39, 20, 6)
    fb.r(30, 41, 5, 1, P.gold)
    monitor(fb, 24, 33, ['think', 'write', 'work', 'permission', 'ask', 'plan'].includes(v.mood), F)
    fb.r(37, 38, 3, 1, '#fbfbf7')
    fb.r(38, 37, 3, 1, '#ecebe4')
    plant(fb, 39, 31)
    desk(fb, 49, 39, 15, 6)
    typewriter(fb, 58, 39, busy('typist'), F)
  })
  const seated = sim.seated()
  for (let i = 0; i < DESKS; i++) {
    const dx = i * 16
    const id = seated[i]
    const sec = id ? v.secs.find(s => s.id === id) : undefined
    const actor = id ? sim.actors.get('sec:' + id) : undefined
    const here = !!actor && actor.t === actor.length
    at(57.5, () => officeChair(fb, dx + 1, 49, 9, 9))
    at(61.5, () => {
      desk(fb, dx, 55, 15, 7)
      monitor(fb, dx + 9, 49, here && sec?.status === 'run', F + i)
      if (viewing && id === viewing) {
        fb.r(dx, 45, 15, 1, P.spot)
        fb.r(dx, 45, 1, 17, P.spot)
        fb.r(dx + 14, 45, 1, 17, P.spot)
      }
    })
  }

  const mp = pointAt(MANAGER_ROUTE, sim.managerT)
  const managerSeated = sim.managerT === 0
  const managerEnd = routeLength(MANAGER_ROUTE)
  const managerWalking = sim.managerT > 0 && sim.managerT < managerEnd
  const napping = v.mood === 'idle'
  at(managerSeated ? 42 : mp.y, () =>
    drawPerson(fb, mp.x, mp.y - 12, LOOK.manager, {
      seat: managerSeated,
      f: managerWalking ? tick : F,
      arms: managerWalking ? 'walk' : managerSeated ? (MANAGER_ARMS[v.mood] ?? 'down') : 'point',
      eyes: napping ? 'closed' : undefined,
      smile: v.mood === 'done',
    }),
  )

  const bubbles: [number, number, string, Tone][] = []
  for (const a of sim.actors.values()) {
    if (a.delay > 0) continue
    const spot = SPOTS[a.spot]
    if (!spot) continue
    const here = a.t === a.length
    const p = pointAt(a.route, a.t)
    const walking = !here
    const sitting = here && spot.seat
    let arms: Arms = 'mug'
    let smile = false
    let lk: Look
    let bubble: [string, Tone] | null = null
    if (a.id.startsWith('sec:')) {
      const sec = v.secs.find(s => 'sec:' + s.id === a.id)
      lk = secLook(sec?.order ?? 0)
      if (sec) {
        arms = sec.status === 'run' ? 'type' : sec.status === 'done' ? 'up' : sec.status === 'idle' ? 'mug' : 'down'
        smile = sec.status === 'done'
        bubble = secBubble(sec)
      }
    } else if (a.id.startsWith('wait')) {
      lk = secLook(Number(a.id.slice(4)) + 1)
      arms = 'down'
      if (a.id === 'wait0') bubble = [sim.queue + ' in line', 'warn']
    } else if (a.id === 'janitor') {
      lk = LOOK.janitor
      arms = 'broom'
    } else {
      const role = a.id as Role
      const w = v.workers[role]
      lk = LOOK[role]
      if (w?.state === 'work') {
        arms = role === 'archivist' ? (/^Search|^Find/.test(w.full) ? 'magnify' : 'folder') : role === 'courier' && !/^Web|^Fetch/.test(w.full) ? 'phone' : 'type'
        bubble = [w.short, '']
      } else if (w?.state === 'error') {
        arms = 'down'
        bubble = [w.short, 'bad']
      }
    }
    if (a.goal === 'out') bubble = null
    const person = lk
    at(sitting ? spot.feet : p.y, () => drawPerson(fb, p.x, p.y - 12, person, { seat: sitting, f: walking ? tick : F + a.id.length, arms: walking ? 'walk' : arms, smile, seed: a.id.length }))
    if (here && bubble && spot.row !== 'aisle') bubbles.push([spot.x + 3, BUBBLE_ROW[spot.row], bubble[0], bubble[1]])
  }

  draws.sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn())

  if (managerSeated) {
    if (v.mood === 'think') thinkBubble(fb, 35, 20, F)
    else if (napping) zzz(fb, F)
    else {
      const b = MANAGER_BUBBLE[v.mood]
      if (b) bubbles.push([32, 12, b[0], b[1]])
    }
  } else if (sim.managerT === managerEnd) {
    const b = MANAGER_BUBBLE[v.mood]
    if (b) bubbles.push([39, 2, b[0], b[1]])
  }
  for (const [cx, row, words, tone] of bubbles) textBubble(sc, cx, row, words, tone)
  return sc
}

const secBubble = (s: Sec): [string, Tone] =>
  s.status === 'run' ? [s.short, ''] : s.status === 'done' ? ['Done!', 'good'] : s.status === 'fail' ? ['Stopped', 'bad'] : ['waiting', 'warn']
