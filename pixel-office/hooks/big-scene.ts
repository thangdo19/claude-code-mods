// The big office, as designed in the plan artifact: 64 × 62 pixels = 64 columns
// × 31 rows, three rows of desks, people walking in through the front door, the
// staff's break corner. Pure drawing of what BigSim says.

import type { Role, Sec } from '../types'
import {
  board, cabinet, clock, coffeeMachine, desk, door, drawPerson, globe, iconBubble, LOOK, monitor, officeChair, P, plant, rack,
  room, Scene, secLook, textBubble, thinkBubble, typewriter, waterCooler, windowPane, zzz, type Arms, type Look,
} from './big-sprites'
import type { Tone, View } from './office'
import { DESK_OWNER, DESKS, isRole, SPOTS, type BigSim } from './big-walk'
import { HOME, managerFree, meeting, type ActKind, type Icon } from './life'

export const BIG_COLS = 64
export const BIG_ROWS = 31

const MANAGER_ARMS: Record<string, Arms> = { idle: 'sleep', think: 'chin', write: 'type', work: 'mug', permission: 'raise', ask: 'raise', done: 'mug', stopped: 'down', hold: 'phone' }
const MANAGER_BUBBLE: Record<string, [string, Tone]> = {
  write: ['writing..', ''], permission: ['Your OK?', 'warn'], ask: ['Question?', 'warn'], done: ['Done!', 'good'],
  stopped: ['Stopped', 'bad'], hold: ['On hold', 'bad'], plan: ['Planning', ''],
}
const URGENT = new Set(['permission', 'ask', 'done', 'stopped', 'hold'])
/** How someone on a break holds their arms. */
const BREAK_ARMS: Record<ActKind, Arms> = { sip: 'mug', mug: 'mug', phone: 'phone', game: 'type', coffee: 'mug', plant: 'water', chat: 'talk', visit: 'talk', host: 'talk' }
/** How each worker holds their arms on a job. */
const WORK_ARMS: Partial<Record<Role, Arms>> = { typist: 'type', it: 'type', researcher: 'type', planner: 'type', librarian: 'folder' }

/** The text row of a bubble over someone whose feet are on pixel row `feet`. */
const bubbleRow = (feet: number) => Math.max(1, Math.floor((feet - 17) / 2))

/** The whole office at frame `f` (4 a second) and tick `tick` (8 a second, for walking legs). */
export function renderBig(v: View, sim: BigSim, f: number, tick: number, viewing?: string): Scene {
  const sc = new Scene(BIG_COLS, BIG_ROWS * 2)
  const fb = sc.fb
  const F = v.frozen ? 3 : f
  const draws: [number, () => void][] = []
  const at = (key: number, fn: () => void) => draws.push([key, fn])
  const busy = (r: Role) => v.workers[r]?.state === 'work'
  const life = sim.life
  const hereAt = (spot: string) => [...sim.actors.values()].some(a => a.dest === spot && a.arrivedAt >= 0 && !a.leaving)

  room(fb)
  door(fb, 2, 4, 8, 17, sim.doorOpen())
  clock(fb, 25, 2, F)
  const todos = v.todos?.map(t => (t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo') as 'done' | 'doing' | 'todo') ?? null
  board(fb, 31, 2, 16, 11, todos, meeting(v), F)
  windowPane(fb, 58, 2, 6, 10, v.night, F)
  const it = v.workers.it
  at(20.5, () => {
    waterCooler(fb, 12, 11, hereAt('chatA') && hereAt('chatB'), F)
    cabinet(fb, 16, 8, 4, 13, busy('archivist'), F)
    cabinet(fb, 20, 8, 4, 13, false, F)
    rack(fb, 51, 5, 6, 16, it?.state === 'error' ? 'error' : it?.state === 'work' ? 'busy' : 'idle', F, v.bg.length)
    coffeeMachine(fb, 58, 13, hereAt('coffee'), F)
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
    const gaming = managerFree(v) && life.activity('manager') === 'game' && sim.here('manager', 'chair')
    monitor(fb, 24, 33, ['think', 'write', 'work', 'permission', 'ask', 'plan'].includes(v.mood), F, gaming)
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
    const here = !!id && sim.here('sec:' + id, 'desk' + i)
    const owner = DESK_OWNER[i]
    const ownerWorks = !id && !!owner && v.workers[owner]?.state === 'work' && sim.here(owner, 'desk' + i)
    at(57.5, () => officeChair(fb, dx + 1, 49, 9, 9))
    at(61.5, () => {
      desk(fb, dx, 55, 15, 7)
      monitor(fb, dx + 9, 49, (here && sec?.status === 'run') || ownerWorks, F + i)
      if (viewing && id === viewing) {
        fb.r(dx, 45, 15, 1, P.spot)
        fb.r(dx, 45, 1, 17, P.spot)
        fb.r(dx + 14, 45, 1, 17, P.spot)
      }
    })
  }

  const bubbles: [number, number, string, Tone][] = []
  const icons: [number, number, Icon][] = []
  const thoughts: [number, number][] = []

  for (const a of sim.actors.values()) {
    if (a.delay > 0) continue
    const spot = SPOTS[a.dest]
    if (!spot) continue
    const here = a.arrivedAt >= 0 && !a.leaving
    const [px, py] = sim.at(a)
    const walking = !here
    const sitting = here && spot.seat
    const feet = sitting ? spot.feet : py
    const top = feet - 12
    let arms: Arms = 'down'
    let smile = false
    let eyes: 'closed' | undefined
    let lk: Look
    let bubble: [string, Tone] | null = null

    if (a.id === 'manager') {
      lk = LOOK.manager
      const seat = here && a.dest === 'chair'
      const napping = v.mood === 'idle' && v.night && seat
      const act = managerFree(v) ? life.activity('manager') : null
      if (act) {
        arms = BREAK_ARMS[act]
        smile = act === 'game' || act === 'chat' || act === 'visit'
      } else if (seat) arms = MANAGER_ARMS[v.mood] ?? 'down'
      else if (a.dest === 'board' && here) arms = v.mood === 'plan' ? 'point' : MANAGER_ARMS[v.mood] ?? 'down'
      else arms = sim.tick < life.bangUntil ? 'point' : v.mood === 'think' ? 'chin' : 'down'
      if (napping) arms = 'sleep'
      eyes = napping ? 'closed' : undefined
      smile ||= v.mood === 'done'
      const key = seat ? 42 : py
      const pose: Arms = walking ? (act === 'mug' ? 'walkMug' : 'walk') : arms
      at(key, () => drawPerson(fb, px, top, LOOK.manager, { seat, f: walking ? tick : F, arms: pose, eyes, smile }))
      const b = MANAGER_BUBBLE[v.mood]
      if (seat) {
        if (napping) at(99, () => zzz(fb, F))
        else if (act) {
          /* on a break at the desk: no bubble */
        }
        else if (v.mood === 'think' || life.think > 0) thoughts.push([35, 20])
        else if (b) bubbles.push([32, 12, b[0], b[1]])
      } else if (walking) {
        // Hurrying back to the desk: the news shows at once, over the head.
        if (b && URGENT.has(v.mood)) bubbles.push([px + 3, bubbleRow(py), b[0], b[1]])
      } else {
        if (b && !act) bubbles.push([px + 3, bubbleRow(py), b[0], b[1]])
        else if (life.think > 0 && top >= 10) thoughts.push([px + 6, top - 10])
      }
      const ic = here ? life.icon(sim, v, 'manager') : null
      if (ic) icons.push([px + (act ? 3 : 5), top - 1, ic])
      continue
    }

    if (a.id.startsWith('sec:')) {
      const sec = v.secs.find(s => 'sec:' + s.id === a.id)
      lk = secLook(sec?.order ?? 0)
      if (sec) {
        arms = sec.status === 'run' ? 'type' : sec.status === 'done' ? 'up' : sec.status === 'idle' ? 'mug' : 'down'
        smile = sec.status === 'done'
        const sb = secBubble(sec)
        bubble = [life.hold(a.id, sb[0], sim.tick), sb[1]]
        // The Manager looking over their shoulder: the Manager's bubble shows, not theirs.
        if (sim.here('manager', 'patrol' + a.dest.slice(4))) bubble = null
      }
    } else if (a.id.startsWith('wait')) {
      lk = secLook(Number(a.id.slice(4)) + 1)
      if (a.id === 'wait0') bubble = [sim.queue + ' in line', 'warn']
    } else if (a.id === 'janitor') {
      lk = LOOK.janitor
      arms = 'broom'
    } else if (isRole(a.id)) {
      const role = a.id
      const w = v.workers[role]
      lk = LOOK[role]
      const act = life.activity(role)
      const desk = a.dest.startsWith('desk') ? Number(a.dest.slice(4)) : -1
      // The Manager just came over ("!"), or looks over their shoulder at a front desk: their words wait.
      const told = (sim.tick < life.bangUntil && sim.here('manager', 'sup' + role[0]!.toUpperCase() + role.slice(1))) || (desk >= 0 && sim.here('manager', 'patrol' + desk))
      const atHome = a.dest === HOME[role]
      // An agent borrowed their desk: they work from where they are, on the phone.
      const away = !!w && !atHome && sim.borrowed(role)
      if (w && (atHome || away)) {
        if (w.state === 'work') {
          arms = away ? 'phone' : role === 'archivist' ? (/^Search|^Find/.test(w.full) ? 'magnify' : 'folder') : role === 'courier' ? 'phone' : (WORK_ARMS[role] ?? 'type')
          bubble = told ? null : [life.hold(role, w.short, sim.tick), '']
        } else if (w.state === 'error') bubble = told ? null : [life.hold(role, w.short, sim.tick), 'bad']
        else arms = 'mug'
      } else if (act) arms = BREAK_ARMS[act]
      if (walking && act === 'mug') arms = 'walkMug'
      const ic = here ? life.icon(sim, v, role) : null
      if (ic) icons.push([px + 3, top - 1, ic])
    } else continue

    if (a.leaving) bubble = null
    const person = lk
    const pose = walking && arms !== 'walkMug' ? 'walk' : arms
    at(sitting ? spot.feet : py, () => drawPerson(fb, px, top, person, { seat: sitting, f: walking ? tick : F + a.id.length, arms: pose, smile, seed: a.id.length }))
    if (here && bubble && a.id !== 'janitor') bubbles.push([spot.x + 3, bubbleRow(spot.feet), bubble[0], bubble[1]])
  }

  draws.sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn())
  for (const [x, y] of thoughts) thinkBubble(fb, x, y, F, life.think)
  for (const [cx, bottom, ic] of icons) iconBubble(fb, cx, bottom, ic)
  for (const [cx, row, words, tone] of bubbles) textBubble(sc, cx, row, words, tone)
  return sc
}

const secBubble = (s: Sec): [string, Tone] =>
  s.status === 'run' ? [s.short, ''] : s.status === 'done' ? ['Done!', 'good'] : s.status === 'fail' ? ['Stopped', 'bad'] : ['waiting', 'warn']
