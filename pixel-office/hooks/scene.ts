// The big office, as designed in the plan artifact: 64 × 62 pixels = 64 columns
// × 31 rows, three rows of desks, people walking in through the front door, the
// staff's break corner. Pure drawing of what BigSim says.

import type { Role, Sec } from '../types'
import { still, Scene } from './gfx/fb'
import { board, boardWords, type BoardItem } from './art/board'
import { iconBubble, textBubble, thinkBubble, zzz } from './art/bubbles'
import {
  bossChair, cabinet, clock, coffeeMachine, desk, deskPhone, door, globe, monitor, officeChair, papers, plant, plate, rack, room, typewriter, waterCooler, windowPane,
} from './art/furniture'
import { LOOK, secLook, type Look } from './art/looks'
import { P } from './art/palette'
import { drawPerson, workFx, type Arms, type Face } from './art/people'
import { ROLES, type Tone, type View } from './office'
import { agentOf, DESK_OWNER, isRole, secActor, type BigSim } from './walk'
import { HOME, managerFree, meeting, SUP, type ActKind, type Icon, type Who } from './life'
import { isUrgent, isWork } from './moods'
import {
  among, BIG_COLS, BIG_ROWS, BOSS_BUBBLE, DEPTH, DESK_SPOTS, DESKS, FRONT_DESK, FURNITURE, IT_BUBBLE_X, PATROL_SPOTS, REPORT_SPOTS, SIGN_AT, SPOTS, WAIT_SPOTS,
  type SpotId,
} from './layout'

// Writing the reply: the Manager dictates (the Typist types it, with the words).
const MANAGER_ARMS: Record<string, Arms> = { idle: 'sleep', think: 'chin', write: 'talk', work: 'mug', permission: 'raise', ask: 'raise', done: 'mug', stopped: 'down', hold: 'phone' }
const MANAGER_BUBBLE: Record<string, [string, Tone]> = {
  permission: ['Your OK?', 'warn'], ask: ['Question?', 'warn'], done: ['Done!', 'good'],
  stopped: ['Stopped', 'bad'], hold: ['On hold', 'bad'], plan: ['Planning', ''],
}
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
  const hereAt = (spot: SpotId) => {
    for (const a of sim.actors.values()) if (a.dest === spot && a.arrivedAt >= 0 && !a.leaving) return true
    return false
  }
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
  const faceTo = (id: Who, dest: SpotId, px: number): Face => {
    const act = life.acts.get(id)
    if (!act) return 'down'
    if ((act.kind === 'report' || act.kind === 'huddle') && among(REPORT_SPOTS, dest)) return px < SPOTS.chair.x ? 'right' : 'left'
    if (!act.partner || !CHATS.includes(act.kind)) return 'down'
    const m = sim.actors.get(act.partner)
    if (!m || m.arrivedAt < 0) return 'down'
    const mx = sim.at(m)[0]
    return mx > px ? 'right' : mx < px ? 'left' : 'down'
  }
  /** The Courier on the desk phone (set below, drawn with the desk). */
  let onCall = false

  // (`still`: art that never changes is drawn once, then copied.)
  const U = FURNITURE
  still(fb, 'room', room)
  const open = sim.doorOpen()
  still(fb, 'door ' + open, f => door(f, U.door.x, U.door.y, U.door.w, U.door.h, open))
  clock(fb, U.clock.x, U.clock.y, F)
  // The to-do words; a done line shows as done once the Manager has ticked it. The meeting draws the plan.
  const items: BoardItem[] = (v.todos ?? []).map(t => ({
    text: t.text,
    state: t.status === 'completed' ? (life.ticked.has(t.text) ? 'done' : 'doing') : t.status === 'in_progress' ? 'doing' : 'todo',
  }))
  const B = U.board
  if (!meeting(v) && items.length) boardWords(sc, U.boardWords.x, U.boardWords.y, U.boardWords.w, U.boardWords.h, items)
  else if (meeting(v)) board(fb, B.x, B.y, B.w, B.h, true, F)
  else still(fb, 'board', f => board(f, B.x, B.y, B.w, B.h, false, 0))
  windowPane(fb, U.window.x, U.window.y, U.window.w, U.window.h, v.night, F)
  const it = v.workers.it
  at(DEPTH.wall, () => {
    if (hereAt('chatA') && hereAt('chatB')) waterCooler(fb, U.cooler.x, U.cooler.y, true, F)
    else still(fb, 'cooler', f => waterCooler(f, U.cooler.x, U.cooler.y, false, 0))
    U.cabinets.forEach((c, k) => {
      // The Archivist's cabinet opens on a job.
      if (k === 0 && busy('archivist')) cabinet(fb, c.x, c.y, c.w, c.h, true, F)
      else still(fb, 'cabinet ' + k, f => cabinet(f, c.x, c.y, c.w, c.h, false, 0))
    })
    rack(fb, U.rack.x, U.rack.y, U.rack.w, U.rack.h, it?.state === 'error' ? 'error' : it?.state === 'work' ? 'busy' : 'idle', F, v.bg.length)
    // Signs on the wall over the cabinets (left of where the Archivist's bubble shows) and the rack.
    plate(sc, SIGN_AT.archivist.x, SIGN_AT.archivist.row, SIGN.archivist)
    plate(sc, SIGN_AT.it.x, SIGN_AT.it.row, SIGN.it)
    if (hereAt('coffee')) coffeeMachine(fb, U.coffee.x, U.coffee.y, true, F)
    else still(fb, 'coffee', f => coffeeMachine(f, U.coffee.x, U.coffee.y, false, 0))
  })
  at(DEPTH.bossChair, () => still(fb, 'boss chair', f => bossChair(f, U.bossChair.x, U.bossChair.y)))
  at(DEPTH.chairs, () => still(fb, 'chairs', f => U.chairs.forEach(c => officeChair(f, c.x, c.y, c.w, c.h))))
  at(DEPTH.desks, () => {
    const cd = U.courierDesk
    still(fb, 'courier desk', f => desk(f, cd.x, cd.y, cd.w, cd.h))
    plate(sc, SIGN_AT.courier.x, SIGN_AT.courier.row, SIGN.courier)
    // The globe at the desk's left end, the red desk phone right of the Courier.
    if (busy('courier')) globe(fb, U.globe.x, U.globe.y, true, F)
    else still(fb, 'globe', f => globe(f, U.globe.x, U.globe.y, false, 0))
    still(fb, 'phone ' + onCall, f => deskPhone(f, U.deskPhone.x, U.deskPhone.y, onCall))
    const bd = U.bossDesk
    const bp = U.bossPlate
    still(fb, 'boss desk', f => {
      desk(f, bd.x, bd.y, bd.w, bd.h)
      f.r(bp.x, bp.y, bp.w, bp.h, P.gold)
    })
    const gaming = managerFree(v) && life.activity('manager') === 'game' && sim.here('manager', 'chair')
    const on = isWork(v.mood)
    if (on || gaming) monitor(fb, U.bossMonitor.x, U.bossMonitor.y, on, F, gaming)
    else still(fb, 'boss monitor', f => monitor(f, U.bossMonitor.x, U.bossMonitor.y, false, 0))
    still(fb, 'papers, plant', f => {
      papers(f, U.papers.x, U.papers.y)
      // On the desk: the pot's foot on the desk top (y 39).
      plant(f, U.plant.x, U.plant.y)
    })
    const td = U.typistDesk
    still(fb, 'typist desk', f => desk(f, td.x, td.y, td.w, td.h))
    plate(sc, SIGN_AT.typist.x, SIGN_AT.typist.row, SIGN.typist)
    if (busy('typist')) typewriter(fb, U.typewriter.x, U.typewriter.y, true, F)
    else still(fb, 'typewriter', f => typewriter(f, U.typewriter.x, U.typewriter.y, false, 0))
  })
  const seated = sim.seated()
  const D = FRONT_DESK
  for (let i = 0; i < DESKS; i++) {
    const dx = i * D.every
    const id = seated[i]
    const sec = id ? v.secs.find(s => s.id === id) : undefined
    const deskSpot = DESK_SPOTS[i]!
    const here = !!id && sim.here(secActor(id), deskSpot)
    const owner = DESK_OWNER[i]
    // (Own work at the desk turns the monitor on too.)
    const ownerWorks = !id && !!owner && (v.workers[owner]?.state === 'work' || life.activity(owner) === 'own') && sim.here(owner, deskSpot)
    at(DEPTH.frontChairs, () => still(fb, 'front chair ' + i, f => officeChair(f, dx + D.chair.x, D.chair.y, D.chair.w, D.chair.h)))
    at(DEPTH.frontDesks, () => {
      still(fb, 'front desk ' + i, f => desk(f, dx + D.desk.x, D.desk.y, D.desk.w, D.desk.h))
      plate(sc, dx + D.sign.x, D.sign.row, id ? 'AGENT' : (DESK_SIGN[i] ?? 'AGENT'))
      const on = (here && sec?.status === 'run') || ownerWorks
      if (on) monitor(fb, dx + D.monitor.x, D.monitor.y, true, F + i)
      else still(fb, 'front monitor ' + i, f => monitor(f, dx + D.monitor.x, D.monitor.y, false, 0))
      if (viewing && id === viewing) {
        const fr = D.frame
        fb.r(dx + fr.x, fr.y, fr.w, 1, P.spot)
        fb.r(dx + fr.x, fr.y, 1, fr.h, P.spot)
        fb.r(dx + fr.x + fr.w - 1, fr.y, 1, fr.h, P.spot)
      }
    })
  }

  const bubbles: [number, number, string, Tone, number?][] = []
  const icons: [number, number, Icon][] = []
  const thoughts: [number, number][] = []

  for (const a of sim.actors.values()) {
    if (a.delay > 0) continue
    const spot = SPOTS[a.dest]
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
      smile ||= v.mood === 'done' || (seat && REPORT_SPOTS.some(hereAt))
      const key = seat ? DEPTH.bossSeat : py
      const pose: Arms = walking ? (act === 'mug' ? 'walkMug' : 'walk') : arms
      const face = walking ? sim.facing(a) : act ? faceTo('manager', a.dest, px) : 'down'
      at(key, () => drawPerson(fb, px, top, LOOK.manager, { seat, f: walking ? walkStep(a) : F, arms: pose, eyes, smile, face, talk: talkOf('manager') }))
      const b = MANAGER_BUBBLE[v.mood]
      if (seat) {
        if (napping) at(DEPTH.top, () => zzz(fb, FURNITURE.zzz.x, FURNITURE.zzz.y, F))
        else if (act) {
          /* on a break at the desk: no bubble */
        }
        else if (v.mood === 'think' || life.think > 0) thoughts.push([BOSS_BUBBLE.think.x, BOSS_BUBBLE.think.y])
        else if (b) bubbles.push([BOSS_BUBBLE.words.x, BOSS_BUBBLE.words.row, b[0], b[1]])
      } else if (walking) {
        // Hurrying back to the desk: the news shows at once, over the head.
        if (b && isUrgent(v.mood)) bubbles.push([px + 3, bubbleRow(py), b[0], b[1]])
      } else {
        if (b && !act) bubbles.push([px + 3, bubbleRow(py), b[0], b[1]])
        else if (life.think > 0 && top >= 10) thoughts.push([px + 6, top - 10])
      }
      const ic = here ? life.icon(sim, v, 'manager') : null
      if (ic) icons.push([px + (act ? 3 : 5), top - 1, ic])
      continue
    }

    const agent = agentOf(a.id)
    if (agent !== undefined) {
      const id = agent
      const sec = v.secs.find(s => s.id === id)
      lk = secLook(sim.lookOf(id) ?? sec?.order ?? 0)
      if (among(WAIT_SPOTS, a.dest)) {
        // In line at the door, no desk yet: the first one says how many wait.
        if (a.dest === 'wait0') bubble = [sim.queue + ' in line', 'warn']
      } else if (sec) {
        working = sec.status === 'run'
        arms = sec.status === 'run' ? 'type' : sec.status === 'done' ? 'up' : sec.status === 'idle' ? 'mug' : 'down'
        smile = sec.status === 'done'
        const sb = secBubble(sec)
        bubble = [life.hold(a.id, sb[0], sim.tick), sb[1]]
        // The Manager looking over their shoulder: the Manager's bubble shows, not theirs.
        const k = among(DESK_SPOTS, a.dest) ? DESK_SPOTS.indexOf(a.dest) : -1
        if (k >= 0 && sim.here('manager', PATROL_SPOTS[k]!)) bubble = null
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
      const desk = among(DESK_SPOTS, a.dest) ? DESK_SPOTS.indexOf(a.dest) : -1
      const sup = SUP[role]
      // The Manager just came over ("!"), or looks over their shoulder at a front desk: their words wait.
      const told = (sim.tick < life.bangUntil && sup !== undefined && sim.here('manager', sup)) || (desk >= 0 && sim.here('manager', PATROL_SPOTS[desk]!))
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
      if (act === 'report' && !among(REPORT_SPOTS, a.dest)) arms = 'phone'
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
