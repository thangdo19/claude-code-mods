// The big office, as designed in the plan artifact: 64 × 62 pixels = 64 columns
// × 31 rows, three rows of desks, people walking in through the front door, the
// staff's break corner. Pure drawing of what BigSim says.

import type { Role, Sec } from '../types'
import {
  board, boardWords, cabinet, clock, coffeeMachine, desk, deskPhone, door, drawPerson, globe, iconBubble, LOOK, monitor, officeChair, P, plant, plate,
  rack, room, Scene, secLook, textBubble, thinkBubble, typewriter, waterCooler, windowPane, workFx, zzz, type Arms, type BoardItem, type Face, type Look,
} from './big-sprites'
import { ROLES, type Tone, type View } from './office'
import { DESK_OWNER, DESKS, isRole, SPOTS, type BigSim } from './big-walk'
import { HOME, managerFree, meeting, type ActKind, type Icon, type Who } from './life'

export const BIG_COLS = 64
export const BIG_ROWS = 31

// Writing the reply: the Manager dictates (the Typist types it, with the words).
const MANAGER_ARMS: Record<string, Arms> = { idle: 'sleep', think: 'chin', write: 'talk', work: 'mug', permission: 'raise', ask: 'raise', done: 'mug', stopped: 'down', hold: 'phone' }
const MANAGER_BUBBLE: Record<string, [string, Tone]> = {
  permission: ['Your OK?', 'warn'], ask: ['Question?', 'warn'], done: ['Done!', 'good'],
  stopped: ['Stopped', 'bad'], hold: ['On hold', 'bad'], plan: ['Planning', ''],
}
const URGENT = new Set(['permission', 'ask', 'done', 'stopped', 'hold'])
/** How someone on a break holds their arms. */
const BREAK_ARMS: Record<ActKind, Arms> = {
  sip: 'mug', mug: 'mug', phone: 'phone', game: 'type', coffee: 'mug', plant: 'water', chat: 'talk', visit: 'talk', host: 'talk',
  stretch: 'stretch', report: 'talk', tick: 'point', own: 'type', huddle: 'talk',
}
/** Own work at the station (approved round 4): files in hand, the rack's keys, sorting the mail, the keys at the desk. */
const OWN_ARMS: Record<Role, Arms> = { archivist: 'folder', it: 'type', courier: 'tidy', typist: 'type', researcher: 'type', planner: 'type', librarian: 'type' }
/** What each station does, on its brass sign (approved: "Signs only"); a front desk an agent sits at says AGENT. */
const SIGN: Record<Role, string> = { archivist: 'FILES', it: 'BASH', courier: 'MAIL', typist: 'EDIT', researcher: 'WEB', planner: 'PLAN', librarian: 'SKILL' }
const DESK_SIGN = ['WEB', 'PLAN', 'SKILL', 'AGENT']
/** The IT girl's bubble starts here: right of the board's frame (x 31–46), its border included. */
const IT_BUBBLE_X = 48
/** The spots where a finished job is reported to the Manager. */
const REPORT_AT = ['rep0', 'rep1']
/** How each worker holds their arms on a job. */
const WORK_ARMS: Partial<Record<Role, Arms>> = { typist: 'type', it: 'type', researcher: 'type', planner: 'type', librarian: 'folder' }

/**
 * The walk step (approved round 5): one step per frame drawn, at 8 frames a second (fullscreen) and at 4 (above the
 * prompt, every other tick): a stroll steps every 2 ticks, hurrying every tick (at 4 a second: foot, foot). The old
 * steps went by distance or the tick, so hurrying legs froze above the prompt and strollers limped.
 */
export const walkStep = (a: { speed: number; walked: number }): number => (a.speed >= 2.5 ? a.walked : a.walked >> 1)

/** The kinds of break where two talk to each other. */
const CHATS: readonly ActKind[] = ['chat', 'visit', 'host']

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
  /** Taking turns to talk (approved round 5): chat partners swap every 2 s, huddlers too; a report or dictating just talks. */
  const talkOf = (id: Who): 'speak' | 'listen' => {
    const act = life.acts.get(id)
    const slot = sim.tick >> 4
    if (act?.partner && CHATS.includes(act.kind)) return (slot % 2 === 0) === id < act.partner ? 'speak' : 'listen'
    if (act?.kind === 'huddle') {
      const hs = ROLES.filter(r => life.acts.get(r)?.kind === 'huddle')
      return hs.length > 1 ? (hs[slot % hs.length] === id ? 'speak' : 'listen') : slot % 2 ? 'listen' : 'speak'
    }
    return 'speak'
  }
  /** Talking at rest, they turn to whoever they talk to (approved round 5): each other, or the Manager at the desk. */
  const faceTo = (id: Who, dest: string, px: number): Face => {
    const act = life.acts.get(id)
    if (!act) return 'down'
    if ((act.kind === 'report' || act.kind === 'huddle') && REPORT_AT.includes(dest)) return px < (SPOTS.chair?.x ?? px) ? 'right' : 'left'
    if (!act.partner || !CHATS.includes(act.kind)) return 'down'
    const m = sim.actors.get(act.partner)
    if (!m || m.arrivedAt < 0) return 'down'
    const mx = sim.at(m)[0]
    return mx > px ? 'right' : mx < px ? 'left' : 'down'
  }
  /** The Courier on the desk phone (set below, drawn with the desk). */
  let onCall = false

  room(fb)
  door(fb, 2, 4, 8, 17, sim.doorOpen())
  clock(fb, 25, 2, F)
  // The to-do words; a done line shows as done once the Manager has ticked it. The meeting draws the plan.
  const items: BoardItem[] = (v.todos ?? []).map(t => ({
    text: t.text,
    state: t.status === 'completed' ? (life.ticked.has(t.text) ? 'done' : 'doing') : t.status === 'in_progress' ? 'doing' : 'todo',
  }))
  if (!meeting(v) && items.length) boardWords(sc, 31, 2, 16, 13, items)
  else board(fb, 31, 2, 16, 11, meeting(v), F)
  windowPane(fb, 58, 2, 6, 10, v.night, F)
  const it = v.workers.it
  at(20.5, () => {
    waterCooler(fb, 12, 11, hereAt('chatA') && hereAt('chatB'), F)
    cabinet(fb, 16, 8, 4, 13, busy('archivist'), F)
    cabinet(fb, 20, 8, 4, 13, false, F)
    rack(fb, 51, 5, 6, 16, it?.state === 'error' ? 'error' : it?.state === 'work' ? 'busy' : 'idle', F, v.bg.length)
    // Signs on the wall over the cabinets (left of where the Archivist's bubble shows) and the rack.
    plate(sc, 18, 3, SIGN.archivist)
    plate(sc, 54, 1, SIGN.it)
    coffeeMachine(fb, 58, 13, hereAt('coffee'), F)
  })
  at(41.4, () => {
    // The Manager's leather chair: a rounded top, a buttoned back.
    fb.r(27, 26, 9, 1, '#8a4a35')
    fb.r(26, 27, 11, 13, P.chair)
    fb.r(27, 28, 9, 11, P.chair2)
    fb.r(27, 27, 9, 1, '#7a4230')
    for (const [x, y] of [[31, 30], [29, 32], [33, 32], [31, 34], [29, 36], [33, 36]] as const) fb.s(x, y, '#4a2a1e')
  })
  at(41.5, () => {
    officeChair(fb, 4, 33, 9, 9)
    officeChair(fb, 50, 33, 9, 9)
  })
  at(44.5, () => {
    desk(fb, 0, 39, 16, 6)
    plate(sc, 8, 21, SIGN.courier)
    // The globe at the desk's left end, the red desk phone right of the Courier.
    globe(fb, 0, 32, busy('courier'), F)
    deskPhone(fb, 12, 36, onCall)
    desk(fb, 23, 39, 20, 6)
    fb.r(30, 41, 5, 1, P.gold)
    const gaming = managerFree(v) && life.activity('manager') === 'game' && sim.here('manager', 'chair')
    monitor(fb, 24, 33, ['think', 'write', 'work', 'permission', 'ask', 'plan'].includes(v.mood), F, gaming)
    fb.r(37, 38, 3, 1, '#fbfbf7')
    fb.r(38, 37, 3, 1, '#ecebe4')
    // On the desk: the pot's foot on the desk top (y 39).
    plant(fb, 39, 32)
    desk(fb, 49, 39, 15, 6)
    plate(sc, 56, 21, SIGN.typist)
    typewriter(fb, 58, 39, busy('typist'), F)
  })
  const seated = sim.seated()
  for (let i = 0; i < DESKS; i++) {
    const dx = i * 16
    const id = seated[i]
    const sec = id ? v.secs.find(s => s.id === id) : undefined
    const here = !!id && sim.here('sec:' + id, 'desk' + i)
    const owner = DESK_OWNER[i]
    // (Own work at the desk turns the monitor on too.)
    const ownerWorks = !id && !!owner && (v.workers[owner]?.state === 'work' || life.activity(owner) === 'own') && sim.here(owner, 'desk' + i)
    at(57.5, () => officeChair(fb, dx + 1, 49, 9, 9))
    at(61.5, () => {
      desk(fb, dx, 55, 15, 7)
      plate(sc, dx + 7, 29, id ? 'AGENT' : (DESK_SIGN[i] ?? 'AGENT'))
      monitor(fb, dx + 9, 49, (here && sec?.status === 'run') || ownerWorks, F + i)
      if (viewing && id === viewing) {
        fb.r(dx, 45, 15, 1, P.spot)
        fb.r(dx, 45, 1, 17, P.spot)
        fb.r(dx + 14, 45, 1, 17, P.spot)
      }
    })
  }

  const bubbles: [number, number, string, Tone, number?][] = []
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
    /** On a job: hands hop and paper flies, so you can tell who works. */
    let working = false

    if (a.id === 'manager') {
      lk = LOOK.manager
      const seat = here && a.dest === 'chair'
      const napping = v.mood === 'idle' && v.night && seat
      const act = managerFree(v) ? life.activity('manager') : null
      if (act) {
        arms = BREAK_ARMS[act]
        smile = act === 'game' || act === 'chat' || act === 'visit'
      } else if (seat) arms = MANAGER_ARMS[v.mood] ?? 'down'
      else if (a.dest === 'board' && here) arms = v.mood === 'plan' || life.pending.length || sim.tick < life.tickShow ? 'point' : MANAGER_ARMS[v.mood] ?? 'down'
      else arms = sim.tick < life.bangUntil ? 'point' : v.mood === 'think' ? 'chin' : 'down'
      if (napping) arms = 'sleep'
      eyes = napping ? 'closed' : undefined
      smile ||= v.mood === 'done' || (seat && REPORT_AT.some(hereAt))
      const key = seat ? 42 : py
      const pose: Arms = walking ? (act === 'mug' ? 'walkMug' : 'walk') : arms
      const face = walking ? sim.facing(a) : act ? faceTo('manager', a.dest, px) : 'down'
      at(key, () => drawPerson(fb, px, top, LOOK.manager, { seat, f: walking ? walkStep(a) : F, arms: pose, eyes, smile, face, talk: talkOf('manager') }))
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
      const id = a.id.slice(4)
      const sec = v.secs.find(s => s.id === id)
      lk = secLook(sim.lookOf(id) ?? sec?.order ?? 0)
      if (a.dest.startsWith('wait')) {
        // In line at the door, no desk yet: the first one says how many wait.
        if (a.dest === 'wait0') bubble = [sim.queue + ' in line', 'warn']
      } else if (sec) {
        working = sec.status === 'run'
        arms = sec.status === 'run' ? 'type' : sec.status === 'done' ? 'up' : sec.status === 'idle' ? 'mug' : 'down'
        smile = sec.status === 'done'
        const sb = secBubble(sec)
        bubble = [life.hold(a.id, sb[0], sim.tick), sb[1]]
        // The Manager looking over their shoulder: the Manager's bubble shows, not theirs.
        if (sim.here('manager', 'patrol' + a.dest.slice(4))) bubble = null
      }
    } else if (a.id === 'janitor') {
      lk = LOOK.janitor
      // Sweeping the whole office: the broom goes along on the walk (in and out too).
      arms = walking ? 'walkBroom' : 'broom'
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
          working = true
          arms = away ? 'phone' : role === 'archivist' ? (/^Search|^Find/.test(w.full) ? 'magnify' : 'folder') : role === 'courier' ? 'phone' : (WORK_ARMS[role] ?? 'type')
          bubble = told ? null : [life.hold(role, w.short, sim.tick), '']
        } else if (w.state === 'error') bubble = told ? null : [life.hold(role, w.short, sim.tick), 'bad']
        // Just finished: a sip at the station until they report or take up their own things.
        else arms = act ? BREAK_ARMS[act] : 'mug'
      } else if (act) arms = BREAK_ARMS[act]
      // Own work: their own tools at their station; at a spare spot (an agent has the desk), notes in hand.
      if (act === 'own' && !(w && w.state !== 'linger')) arms = atHome ? OWN_ARMS[role] : 'read'
      // Reporting where they are (the Manager is away): on the phone.
      if (act === 'report' && !REPORT_AT.includes(a.dest)) arms = 'phone'
      if (act === 'stretch' && !walking) eyes = 'closed'
      if (walking && act === 'mug') arms = 'walkMug'
      // At the desk the Courier calls on the desk phone (the smartphone only away from it).
      if (role === 'courier' && arms === 'phone' && here && a.dest === 'courier') {
        arms = 'deskPhone'
        onCall = true
      }
      const ic = here ? life.icon(sim, v, role) : null
      if (ic) icons.push([px + 3, top - 1, ic])
    } else continue

    if (a.leaving) bubble = null
    const person = lk
    const pose = walking && arms !== 'walkMug' && arms !== 'walkBroom' ? 'walk' : arms
    const busyNow = working && here
    // At work everything moves every tick (8 a second); otherwise at the calm 4; after Esc nothing moves.
    const pf = v.frozen ? F + a.id.length : walking ? walkStep(a) : busyNow ? tick : F + a.id.length
    const face = walking ? sim.facing(a) : isRole(a.id) ? faceTo(a.id, a.dest, px) : 'down'
    const talk = pose === 'talk' && isRole(a.id) ? talkOf(a.id) : undefined
    at(sitting ? spot.feet : py, () => {
      drawPerson(fb, px, top, person, { seat: sitting, f: pf, arms: pose, smile, eyes, seed: a.id.length, busy: busyNow, face, talk })
      if (busyNow) workFx(fb, px, top, pf)
    })
    // The IT girl's bubble starts right of the board, so it never covers the to-do words.
    const minX = a.id === 'it' && a.dest === 'it' ? IT_BUBBLE_X : 0
    if (here && bubble && a.id !== 'janitor') bubbles.push([spot.x + 3, bubbleRow(spot.feet), bubble[0], bubble[1], minX])
  }

  draws.sort((a, b) => a[0] - b[0]).forEach(([, fn]) => fn())
  // A bubble goes over any letters under it (a sign, the board), and so does a person in front of them (settle).
  for (const [x, y] of thoughts) {
    const bx = Math.max(0, Math.min(x, fb.w - 9))
    sc.cover(bx, y, bx + 8, y + 9)
    thinkBubble(fb, x, y, F, life.think)
  }
  for (const [cx, bottom, ic] of icons) {
    const bx = Math.max(0, Math.min(cx - 3, fb.w - 7))
    sc.cover(bx, bottom - 7, bx + 6, bottom)
    iconBubble(fb, cx, bottom, ic)
  }
  for (const [cx, row, words, tone, minX] of bubbles) textBubble(sc, cx, row, words, tone, minX)
  sc.settle()
  return sc
}

const secBubble = (s: Sec): [string, Tone] =>
  s.status === 'run' ? [s.short, ''] : s.status === 'done' ? ['Done!', 'good'] : s.status === 'fail' ? ['Stopped', 'bad'] : ['waiting', 'warn']
