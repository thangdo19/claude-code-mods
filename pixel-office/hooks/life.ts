// Office life: what the staff and the Manager do with nothing to do (between turns
// a break: coffee, a chat, a game, the plant; while Claude works quiet work of their
// own at their station, or a huddle with the thinking Manager), reporting a finished job to the Manager, the
// planning meeting, and where the Manager goes while Claude works. Decides only; BigSim walks. Seeded random, so a
// test sees the same office every run.

import type { Role } from '../types'
import type { Who } from './labels'
import type { ActorId, BigSim } from './walk'
import { among, PATROL_SPOTS, REPORT_SPOTS, SUP_SPOTS, type SpotId } from './layout'
import { isMeeting, isUrgent, isWork } from './moods'
import { LINGER_MS, MIN_SHOW, NAME, ROLES, type View } from './office'
import { decorAt, lunchAt, remote, REMOTE } from './world'

/** A small picture bubble: not working (words in a bubble mean working). */
export type Icon = 'dots' | 'ha' | 'heart' | 'note' | 'bang' | 'ask' | 'check' | 'bulb'
export type ActKind = 'sip' | 'phone' | 'mug' | 'game' | 'coffee' | 'chat' | 'plant' | 'visit' | 'host' | 'stretch' | 'report' | 'tick' | 'own' | 'huddle' | 'ship' | 'eat' | 'garden' | 'hello'
/** Someone with a life: a role, or 'manager'. */
export type { Who }
type Act = { kind: ActKind; spot: SpotId; until: number; partner?: Who }

/** Everyone's own place. (The Researcher and the Librarian work from home and never come in: theirs are never used.) */
export const HOME: Record<Who, SpotId> = {
  archivist: 'archivist', typist: 'typist', it: 'it', courier: 'courier', researcher: 'desk0', planner: 'desk1', librarian: 'desk2', manager: 'chair',
}
const MEET: Record<Role, SpotId> = { archivist: 'meet0', it: 'meet1', courier: 'meet2', typist: 'meet3', researcher: 'meet4', planner: 'meet5', librarian: 'meet6' }
/** Where the Manager looks over each back-wall or middle-row worker's shoulder. */
export const SUP: Partial<Record<Role, SpotId>> = { archivist: 'supArchivist', it: 'supIt', courier: 'supCourier', typist: 'supTypist' }
/** Staff at a front desk (the Manager's rounds look over their shoulder): the Planner, at desk 1. */
const FRONT: Partial<Record<Role, number>> = { planner: 1 }
const VISIT: Partial<Record<Who, SpotId>> = { courier: 'visitCourier', typist: 'visitTypist' }
/** Two places to chat: by the water cooler, and by the board. */
const CHATS: [SpotId, SpotId][] = [['chatA', 'chatB'], ['chatC', 'chatD']]
const AT_HOME = new Set<ActKind>(['sip', 'phone', 'mug', 'game', 'stretch', 'eat'])
/**
 * While Claude works, with no job (approved round 4, "Own work at the desk"): mostly quiet work of their own at their
 * station (monitor on, calm hands, no words), now and then a sip or a stretch. Kind, weight, shortest and longest ticks.
 */
const DESK_ACTS: readonly [ActKind, number, number, number][] = [['own', 6, 120, 240], ['sip', 1, 48, 96], ['stretch', 1, 24, 40]]
const AT_DESK = new Set<ActKind>(DESK_ACTS.map(([k]) => k))
/** Each one's own work, for the list. */
export const OWN_WORK: Record<Role, string> = {
  archivist: 'sorting files', it: 'checking the servers', courier: 'sorting the mail', typist: 'proofreading', researcher: 'reading up',
  planner: 'planning ahead', librarian: 'tidying the shelves',
}
/**
 * Thinking in turns (approved round 6, "Many ways to think": Claude thinks most of a turn): 5 s each from getting
 * there, chin in hand, notes (at the desk), pacing behind the desk (6 s), doodling at the board, a mug at the coffee
 * machine, and round again.
 */
const POSES = ['chin', 'notes', 'pace', 'board', 'coffee'] as const
/**
 * Huddle (approved round 4; round 6 "Fewer huddles": 8 s, not 2): the Manager thinking this many ticks at the desk
 * calls one or two over, once a stretch of thinking, for HUDDLE_TICKS.
 */
const HUDDLE_AFTER = 64
const HUDDLE_TICKS = 24
/** At most this many at a huddle (the two report spots). */
const HUDDLE_MOST = 2
/** Who comes first when nobody worked yet this session. */
const HUDDLE_ORDER: readonly Role[] = ['planner', 'archivist', 'it', 'typist', 'researcher', 'courier', 'librarian']
/** What each one is doing, for their line in the list. */
const DOING: Record<ActKind, string> = {
  sip: 'having a coffee', mug: 'having a coffee', phone: 'on the phone', game: 'playing a game', coffee: 'making coffee',
  plant: 'watering the plant', chat: 'chatting', visit: 'visiting', host: 'chatting', stretch: 'stretching',
  report: 'reporting to ' + NAME.manager, tick: 'ticking the board', own: 'at work', huddle: 'talking it over with ' + NAME.manager,
  ship: 'taking a parcel to the door', eat: 'having lunch', garden: 'watering the plants', hello: 'saying good morning',
}
/** Spots too close together for two people at once (a report spot and the visit / look-over spot below it). */
const NEAR: Partial<Record<SpotId, SpotId[]>> = {
  rep0: ['visitCourier', 'supCourier'], rep1: ['visitTypist', 'supTypist'], visitCourier: ['rep0'], visitTypist: ['rep1'],
}
/** A finished worker waits this long (ms) for a next job before going to report. */
export const REPORT_AFTER = 1000
/** Ticks a report lasts once there (1.5 s). */
const REPORT_TICKS = 12
/** Spare places to stand (the meeting's, unused outside it) for someone whose desk an agent borrowed. */
const SPARE: readonly SpotId[] = ['meet4', 'meet5', 'meet2', 'meet3', 'meet6']
const CHAT_ICONS: Icon[] = ['dots', 'ha', 'heart', 'note']
const MEET_ICONS: Icon[] = ['ask', 'bang', 'dots']
/**
 * Commands the IT girl takes her laptop for (approved round 8, "server commands"): remote machines, containers,
 * downloads, installs and deploys.
 */
export const LAPTOP_CMDS = /\b(ssh|scp|rsync|curl|wget|docker|kubectl|helm|terraform|deploy|brew|apt(-get)?|pip3? install|npm (i|install|ci)|pnpm (i|install|add)|yarn( add| install)?)\b/

/** Calm (approved Nov 2026: "people move too much"): every break or desk thing lasts this many times longer. */
const PACE = 2
/** At most this many set off for a break thing at once; the next keeps at it up to HOLD_MAX ticks (2 s) more. */
const SETTING_OFF = 2
const HOLD_MAX = 16
/**
 * The office opening (approved round 7, "Manager opens up"): the staff set off this many ticks after the Manager, one
 * every OPEN_GAP; each waves HELLO_TICKS at the desk; when all are in, the two from home say hi on the TV, TV_HELLO
 * ticks each.
 */
const OPEN_LEAD = 14
const OPEN_GAP = 6
const HELLO_TICKS = 20
const TV_HELLO = 20
/** Ticks between two ticks on the board, and how long the check shows after the last one. */
const TICK_EVERY = 6
const TICK_SHOW = 14

/** An agent running this long (ms) brings the Manager over. */
export const SLOW_MS = 1500
/** A job shown this long brings the Manager over (every job shows MIN_SHOW at least: a second more is a slow one). */
export const JOB_SLOW_MS = MIN_SHOW + 1000
/** Ticks the Manager stays where they arrived (3 s). */
const STAY = 24
/** Ticks at each front desk on a round of the desks. */
const PATROL_STOP = 24
/** Ticks at the desk between two rounds (8 s). */
const PATROL_REST = 64
/** Ticks a bubble keeps its words (1 s). */
const WORDS_HOLD = 8

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

/** Plan mode during a turn: everyone free is at the board, through the plan's own dialogs. */
export const meeting = (v: View): boolean => v.planning && isMeeting(v.mood)
/** Between turns, before night: the Manager is on a break too. */
export const managerFree = (v: View): boolean => v.mood === 'idle' && !v.night
/** Claude's turn is on: breaks are over, everyone is at their own desk. */
export const workTime = (v: View): boolean => !v.night && isWork(v.mood)
/** Compacting: the Janitor cleans, staff and the Manager step out (approved: "Staff out, busy agents stay"). */
export const cleaning = (v: View): boolean => v.janitor

export class Life {
  readonly acts = new Map<Who, Act>()
  private rand = rng(7)
  /** Ticks the Manager has thought this turn (round 11: empty cups pile up on the desk); 0 between turns. */
  thought = 0
  /** The thought bubble: 0 none, 1 a dot, 2 two dots, 3 the bubble. */
  think = 0
  private thinkClock = 0
  bangUntil = -1
  private banged = -1
  private restUntil = -1
  private readonly words = new Map<string, { text: string; at: number }>()
  /** The finish each worker last reported (its endedAt), so one finish is reported once. */
  private readonly reported = new Map<Role, number>()
  /** The Typist was typing Claude's reply last tick; when the reply ended (a finish to report). */
  private typingReply = false
  private replyEnded = -Infinity
  /** Since when someone has kept at it because enough people are setting off already. */
  private readonly held = new Map<Who, number>()
  /** The Manager stepped out (the Janitor cleans): walks back in rather than appearing. */
  private managerOut = false
  /** The Manager went home for the night (approved round 9): hurries back in through the door. */
  private managerHome = false
  /** To-do lines the Manager has ticked on the board, and done lines still to tick (in order). */
  readonly ticked = new Set<string>()
  pending: string[] = []
  private primed = false
  private tickAt = -1
  /** Until this tick the Manager shows a check at the board. */
  tickShow = -1
  /** The huddle: since when the Manager thinks (tick), and when each worker last had a job. */
  private thinkSince = -1
  private readonly worked = new Map<Role, number>()
  /** A huddle happened this stretch of thinking. */
  private huddled = false
  /** A job just started: when the lightbulb went on (tick), and who the Manager calls. The bulb 6 ticks, the call 10. */
  bulbAt = -1
  callRole: Role | null = null
  private thoughtAt = -1
  private readonly seen = new Map<Role, number>()
  /** Employee of the month: the jobs each one has had since the office opened. */
  readonly jobCount = new Map<Role, number>()
  /** The git push finish already shipped. */
  private shipped = -1
  /** A paper plane in the air: from, to, and the tick it was thrown. */
  plane: { from: readonly [number, number]; to: readonly [number, number]; at: number } | null = null
  private planeNext = 200
  /** The thinking pose at the desk; which pose of the round, until when, for which stretch of thinking. */
  pose: 'chin' | 'notes' = 'chin'
  private poseIdx = 0
  private poseEnd = -1
  private poseSpell = -1
  /** The office opening: who is still on the way in, and when the two from home say hi on the TV (tick). */
  readonly arriving = new Set<Role>()
  private helloAt = -1
  /**
   * The IT girl's laptop (approved round 8): 'open' at the rack for a server command, in half of her own work, or while
   * a background command runs; 'shut' under her arm on the way to report it and back. `lapOut`: she had it out last.
   */
  lap: 'open' | 'shut' | null = null
  private lapOut = false

  /**
   * Who is in the office: staff come for the workday and go home at night; the Manager goes last, once every staff
   * member is out of the door (approved round 9; the lights go off then: `BigSim.dark`), and hurries back in when
   * something happens. A turn that ended on an error ("On hold") keeps the Manager in, lights on. `opening`: the first sync of a new session, everyone walks in from the door, the Manager first.
   */
  sync(sim: BigSim, v: View, instant: boolean, opening = false): void {
    const out = cleaning(v)
    const m = sim.actors.get('manager')
    // (Only with nothing left to tell you: "On hold" after an error keeps the Manager at the desk, on the hotline.)
    const closing = v.night && !out && v.mood === 'idle'
    if (closing) {
      if (m && !m.leaving && !ROLES.some(r => sim.actors.has(r))) {
        this.endAct('manager')
        sim.goTo('manager', 'door', { leaving: true })
      }
      if (!m || sim.actors.get('manager')?.leaving) this.managerHome = true
    } else if (out) {
      // The Janitor cleans: the Manager steps out too.
      if (m && !m.leaving) {
        this.endAct('manager')
        if (instant) sim.remove('manager')
        else sim.goTo('manager', 'door', { leaving: true })
      }
      this.managerOut = true
    } else if (!m) {
      sim.goTo('manager', meeting(v) ? 'board' : 'chair', this.managerHome && !instant ? { hurry: true } : opening || (this.managerOut && !instant) ? {} : { instant: true })
      this.managerOut = false
    } else if (m.leaving) {
      // Done before the Manager was out of the door: back in.
      sim.goTo('manager', meeting(v) ? 'board' : 'chair')
      this.managerOut = false
    }
    let k = 0
    for (const r of ROLES) {
      const job = v.workers[r] !== undefined
      // Those working from home never come in.
      const inside = !remote(r) && (job || (!v.night && !out))
      const a = sim.actors.get(r)
      if (inside && (!a || a.leaving)) {
        this.endAct(r)
        const home = sim.borrowed(r) ? spare(sim, r) : HOME[r]
        sim.goTo(r, home, instant ? { instant: true } : job ? { hurry: true } : { delay: opening ? OPEN_LEAD + OPEN_GAP * k++ : 6 * k++ })
        if (opening) this.arriving.add(r)
      } else if (!inside && a && !a.leaving) {
        this.endAct(r)
        if (instant) sim.remove(r)
        else sim.goTo(r, 'door', { leaving: true, delay: 6 * k++ })
      }
    }
    if (!closing) this.managerHome = false
  }

  step(sim: BigSim, v: View): void {
    this.greet(sim, v)
    this.board(sim, v)
    this.notice(sim, v)
    this.manager(sim, v)
    const reply = v.workers.typist?.note === 'reply'
    if (this.typingReply && !reply) this.replyEnded = v.now
    this.typingReply = reply
    if (v.mood === 'think') this.thought++
    else if (!workTime(v)) this.thought = 0
    const work = workTime(v)
    const free: Who[] = []
    for (const r of ROLES) {
      const a = sim.actors.get(r)
      if (!a || a.leaving) continue
      const w = v.workers[r]
      if (w && w.state !== 'linger') {
        this.endAct(r)
        // An agent borrowed their desk: they work on the phone from a spot of their own (their meeting spot in
        // the meeting, which no one else uses then).
        if (!sim.borrowed(r)) sim.goTo(r, HOME[r], { hurry: true })
        else if (meeting(v)) sim.goTo(r, MEET[r], { hurry: true })
        else if (!ownPlace(sim, r)) sim.goTo(r, spare(sim, r), { hurry: true })
      } else if (meeting(v)) {
        this.endAct(r)
        sim.goTo(r, MEET[r])
      } else {
        if (r === 'courier' && this.shipping(sim, v)) continue
        // Just finished (a job, or the Typist's reply): report it to the Manager first.
        let finished = w ? w.since : -Infinity
        if (r === 'typist' && v.now - this.replyEnded < LINGER_MS) finished = Math.max(finished, this.replyEnded)
        if (finished > -Infinity && this.reporting(sim, v, r, finished)) continue
        free.push(r)
      }
    }
    const boss = sim.actors.get('manager')
    if (managerFree(v) && boss && !boss.leaving) free.push('manager')
    this.huddle(sim, v, free)
    this.planes(sim, v, free)
    for (const r of free) {
      const act = this.acts.get(r)
      // Just in, or on the way to their own place: there first. (In work time, never on to a break spot.)
      // (Never on to their desk once an agent has it.)
      const blocked = r !== 'manager' && sim.borrowed(r) && sim.actors.get(r)?.dest === HOME[r]
      if (!act && !sim.here(r) && !blocked && (!work || r === 'manager' || ownPlace(sim, r))) continue
      const ok = !!act && this.valid(sim, r, act, free, v)
      if (ok && sim.tick < act!.until) continue
      // Ticking the board: until every done line has its tick.
      if (r === 'manager' && act?.kind === 'tick' && (this.pending.length || sim.tick < this.tickShow)) continue
      // A party: nobody sets off for a break (they cheer where they are; breaks start after it). (Only off a desk an
      // agent just took, to a spare place.)
      if (v.party) {
        this.endAct(r)
        if (blocked) sim.goTo(r, spare(sim, r))
        continue
      }
      // Enough people setting off already: keep at it a moment longer (2 s at most, so nobody is stuck). (Also with
      // nothing left to keep at: own work that ended with the turn, or all at once after a party. Never at a desk an
      // agent just took: off it at once.)
      if (!blocked && !work && sim.here(r) && this.settingOff(sim, free) >= SETTING_OFF) {
        const since = this.held.get(r) ?? sim.tick
        this.held.set(r, since)
        if (sim.tick - since < HOLD_MAX) continue
      }
      this.next(sim, r, free, v)
    }
    const want = v.mood === 'think' ? 3 : 0
    if (isUrgent(v.mood)) this.think = 0
    if (this.think === want) this.thinkClock = 0
    else if (++this.thinkClock >= 2) {
      this.thinkClock = 0
      this.think = want > this.think ? this.think + 1 : this.think === 3 ? 1 : 0
    }
    // (Last, once this tick's breaks and reports are set.)
    this.laptop(sim, v)
  }

  /**
   * The huddle (approved round 4): the Manager thinking 2 s at the desk calls over the one or two who worked last (the
   * Planner and the Archivist when nobody did) to the report spots. They talk it over until the thinking ends; a job
   * calls them back, and a report always gets a spot (see reporting).
   */
  private huddle(sim: BigSim, v: View, free: Who[]): void {
    for (const r of ROLES) if (v.workers[r]?.state === 'work') this.worked.set(r, sim.tick)
    if (v.mood !== 'think') {
      this.thinkSince = -1
      this.huddled = false
      return
    }
    if (this.thinkSince < 0) this.thinkSince = sim.tick
    if (sim.tick - this.thinkSince < HUDDLE_AFTER || !sim.here('manager', 'chair') || this.huddled) return
    const on = ROLES.filter(r => this.acts.get(r)?.kind === 'huddle').length
    const pick = free
      .filter((r): r is Role => r !== 'manager' && sim.here(r) && !['huddle', 'report'].includes(this.acts.get(r)?.kind ?? ''))
      .sort((a, b) => (this.worked.get(b) ?? -1) - (this.worked.get(a) ?? -1) || HUDDLE_ORDER.indexOf(a) - HUDDLE_ORDER.indexOf(b))
    for (const r of pick.slice(0, Math.max(0, HUDDLE_MOST - on))) {
      const spot = REPORT_SPOTS.find(s => !crowded(sim, s, r))
      if (!spot) return
      this.endAct(r)
      this.start(sim, r, 'huddle', spot, HUDDLE_TICKS)
      this.huddled = true
    }
  }

  /**
   * The office opening: each one waves at the desk on getting there (not with a job, nor once Claude works); when all
   * are in, the two from home say hi on the TV.
   */
  private greet(sim: BigSim, v: View): void {
    for (const r of [...this.arriving]) {
      const a = sim.actors.get(r)
      if (a && !a.leaving && a.arrivedAt < 0) continue
      this.arriving.delete(r)
      if (a && !a.leaving && a.dest === HOME[r] && !workTime(v) && !v.workers[r]) this.acts.set(r, { kind: 'hello', spot: a.dest, until: sim.tick + HELLO_TICKS })
      if (!this.arriving.size && !cleaning(v) && !v.night) this.helloAt = sim.tick + 8
    }
  }
  /** Who says hi on the TV now (the office opening), if anyone. */
  caller(tick: number): Role | null {
    if (this.helloAt < 0 || tick < this.helloAt || tick >= this.helloAt + TV_HELLO * REMOTE.length) return null
    return REMOTE[Math.floor((tick - this.helloAt) / TV_HELLO)] ?? null
  }

  /** The IT girl's laptop, this tick (see `lap`). */
  private laptop(sim: BigSim, v: View): void {
    const a = sim.actors.get('it')
    const w = v.workers.it
    const act = this.acts.get('it')
    if (!a || a.leaving) {
      this.lapOut = false
      this.lap = null
      return
    }
    const atRack = sim.here('it', HOME.it)
    let open = false
    if (atRack) {
      if (w?.state === 'work') open = LAPTOP_CMDS.test(w.full)
      // Just done: still on it until she goes to report.
      else if (w?.state === 'linger' && !act) open = this.lapOut
      else if (act?.kind === 'own') open = (act.until >> 4) % 2 === 1 || v.bg.length > 0
      else if (!act && !w) open = v.bg.length > 0
      if (open) this.lapOut = true
      else if (w?.state === 'work' || act?.kind === 'own') this.lapOut = false
    }
    // Off on a break, she leaves it at the rack.
    if (act && act.kind !== 'report' && act.kind !== 'own') this.lapOut = false
    const reporting = act?.kind === 'report' && among(REPORT_SPOTS, act.spot)
    const goingBack = !act && !atRack && a.dest === HOME.it
    this.lap = open ? 'open' : this.lapOut && (reporting || goingBack) ? 'shut' : null
  }

  /** What `r` (no job now) is doing, for their own line in the list. */
  doing(sim: BigSim, v: View, r: Role): string {
    const a = sim.actors.get(r)
    if (!a && remote(r)) return v.night ? 'gone home' : this.caller(sim.tick) === r ? 'saying hi on the call' : 'working from home'
    if (!a) return cleaning(v) ? 'stepped out while the Janitor cleans' : v.night ? 'gone home' : 'on the way in'
    if (a.leaving) return cleaning(v) ? 'stepping out' : 'going home'
    if (meeting(v)) return 'at the board'
    const lent = sim.borrowed(r) ? ' · an agent has the desk' : ''
    const act = this.acts.get(r)
    if (!act) return (this.arriving.has(r) ? 'coming in' : sim.here(r) ? 'at the desk' : 'back to the desk') + lent
    const mate = act.partner ? NAME[act.partner] : ''
    const what =
      act.kind === 'chat' ? 'chatting with ' + mate
      : act.kind === 'visit' ? 'visiting ' + mate
      : act.kind === 'host' ? mate + ' came by'
      : act.kind === 'own' ? OWN_WORK[r]
      : act.kind === 'report' && !among(REPORT_SPOTS, act.spot) ? 'calling ' + NAME.manager
      : DOING[act.kind]
    return what + lent
  }

  /** People on the way to a break thing now (not counting the walk back to a job). */
  private settingOff(sim: BigSim, free: Who[]): number {
    return free.filter(p => this.acts.has(p) && !sim.here(p) && !sim.actors.get(p)?.leaving).length
  }

  /**
   * The board (approved: "Words + Manager ticks"): a to-do line shows as done once the Manager has ticked it. New done
   * lines wait in `pending`; while the Manager is at the board, one is ticked every TICK_EVERY ticks. A reload ticks
   * what is done already, so nothing is walked over again.
   */
  private board(sim: BigSim, v: View): void {
    const done = (v.todos ?? []).filter(t => t.status === 'completed').map(t => t.text)
    for (const t of [...this.ticked]) if (!done.includes(t)) this.ticked.delete(t)
    this.pending = this.pending.filter(t => done.includes(t) && !this.ticked.has(t))
    if (!this.primed) {
      this.primed = true
      for (const t of done) this.ticked.add(t)
      return
    }
    for (const t of done) if (!this.ticked.has(t) && !this.pending.includes(t)) this.pending.push(t)
    if (this.pending.length && sim.here('manager', 'board') && sim.tick >= this.tickAt) {
      this.ticked.add(this.pending.shift()!)
      this.tickAt = sim.tick + TICK_EVERY
      this.tickShow = sim.tick + TICK_SHOW
    }
  }

  /** Someone left the office: their bubble words go. */
  forget(id: string): void {
    this.words.delete(id)
  }

  /** The words a bubble shows: new words at most once a second, so each can be read. */
  hold(id: string, text: string, tick: number): string {
    const w = this.words.get(id)
    if (!w || (w.text !== text && tick - w.at >= WORDS_HOLD)) {
      this.words.set(id, { text, at: tick })
      return text
    }
    return w.text
  }

  /** The picture bubble over `id` now, if any. */
  icon(sim: BigSim, v: View, id: string): Icon | null {
    const t = sim.tick
    if (id === 'manager' && t < this.bangUntil) return 'bang'
    if (id === 'manager' && t >= this.bulbAt && t < this.bulbAt + 6) return 'bulb'
    if (id === 'manager' && t < this.tickShow && sim.here('manager', 'board')) return 'check'
    if (!isWho(id)) return null
    const mine = this.acts.get(id)
    if (mine?.kind === 'report') return sim.here(id, mine.spot) ? 'check' : null
    if (mine?.kind === 'huddle') {
      // Talking it over: one at a time shows ? ! …
      if (!sim.here(id, mine.spot)) return null
      const there = ROLES.filter(r => this.acts.get(r)?.kind === 'huddle' && sim.here(r, this.acts.get(r)!.spot))
      const phase = Math.floor(t / 16)
      return there[phase % there.length] === id ? (MEET_ICONS[phase % 3] ?? null) : null
    }
    if (id !== 'manager' && meeting(v) && !v.workers[id]) {
      const there = ROLES.filter(r => !v.workers[r] && sim.here(r, MEET[r]))
      const phase = Math.floor(t / 16)
      return there.length && there[phase % there.length] === id ? (MEET_ICONS[phase % 3] ?? null) : null
    }
    const act = this.acts.get(id)
    if (!act?.partner || !['chat', 'visit', 'host'].includes(act.kind)) return null
    const mate = act.partner
    if (!sim.here(id, act.spot) || !sim.here(mate, this.acts.get(mate)?.spot)) return null
    const phase = Math.floor(t / 12)
    const talker = phase % 2 ? (id < mate ? id : mate) : id < mate ? mate : id
    return talker === id ? (CHAT_ICONS[(phase * 7 + id.length) % CHAT_ICONS.length] ?? null) : null
  }

  activity(w: Who): ActKind | null {
    return this.acts.get(w)?.kind ?? null
  }

  /* ===== a break ===== */

  private valid(sim: BigSim, r: Who, act: Act, free: Who[], v: View): boolean {
    if (act.spot === HOME[r] && r !== 'manager' && sim.borrowed(r)) return false
    // A huddle lasts while the Manager thinks at the desk; own work while Claude works.
    if (act.kind === 'huddle') return v.mood === 'think' && sim.here('manager', 'chair')
    if (act.kind === 'own' && !workTime(v)) return false
    // Claude is working: the break is over.
    if (workTime(v) && !AT_DESK.has(act.kind)) return false
    if (!act.partner) return true
    const theirs = this.acts.get(act.partner)
    return free.includes(act.partner) && theirs?.partner === r
  }

  /** Ends `r`'s activity; a chat ends for both. */
  private endAct(r: Who): void {
    this.held.delete(r)
    const act = this.acts.get(r)
    if (!act) return
    this.acts.delete(r)
    if (act.partner && this.acts.get(act.partner)?.partner === r) this.acts.delete(act.partner)
  }

  private start(sim: BigSim, r: Who, kind: ActKind, spot: SpotId, ticks: number, partner?: Who, hurry = false): number {
    if (kind !== 'report' && kind !== 'tick') ticks *= PACE
    const a = sim.goTo(r, spot, hurry ? { hurry: true } : {})
    const walk = Math.ceil((a.length - a.t) / a.speed) + a.delay
    const act: Act = { kind, spot, until: sim.tick + walk + ticks, partner }
    this.acts.set(r, act)
    return act.until
  }

  private between(lo: number, hi: number): number {
    return Math.round(lo + this.rand() * (hi - lo))
  }

  /**
   * A finished job: after a moment at the station (a next job may come), the worker walks over and
   * reports to the Manager at the desk, or calls it in where they are when the Manager is away.
   * True while that goes on (waiting, walking, reporting).
   */
  private reporting(sim: BigSim, v: View, r: Role, finished: number): boolean {
    const act = this.acts.get(r)
    if (act?.kind === 'report') return sim.tick < act.until
    if (this.reported.get(r) === finished) return false
    if (v.now - finished < REPORT_AFTER) return true
    this.reported.set(r, finished)
    this.endAct(r)
    let spot = sim.here('manager', 'chair') ? REPORT_SPOTS.find(s => !crowded(sim, s, r)) : undefined
    // Both spots taken by a huddle: one huddler goes back to the desk to make room.
    const h = spot || !sim.here('manager', 'chair') ? undefined : ROLES.find(x => x !== r && this.acts.get(x)?.kind === 'huddle')
    if (h) {
      this.endAct(h)
      sim.goTo(h, sim.borrowed(h) ? spare(sim, h) : HOME[h], { hurry: true })
      spot = REPORT_SPOTS.find(s => !crowded(sim, s, r))
    }
    const dest = sim.actors.get(r)!.dest
    const here = sim.borrowed(r) && dest === HOME[r] ? spare(sim, r) : dest
    this.start(sim, r, 'report', spot ?? here, REPORT_TICKS, undefined, spot !== undefined)
    return true
  }

  private next(sim: BigSim, r: Who, free: Who[], v: View): void {
    const prev = this.acts.get(r)
    this.endAct(r)
    // A done line on the board not ticked yet (it finished while the Manager was busy): first thing on a break.
    if (r === 'manager' && this.pending.length) {
      this.start(sim, r, 'tick', 'board', 8)
      return
    }
    const homeOk = r === 'manager' || !sim.borrowed(r)
    const home = HOME[r]
    if (workTime(v) && r !== 'manager') {
      // Quiet work of their own at their station (at a spare spot, with notes in hand, if an agent borrowed it).
      const spot = homeOk ? home : spare(sim, r)
      const kinds = DESK_ACTS.filter(([k]) => (k !== prev?.kind || k === 'own') && (homeOk || k !== 'stretch'))
      let pick = this.rand() * kinds.reduce((n, [, w]) => n + w, 0)
      const [kind, , lo, hi] = kinds.find(([, w]) => (pick -= w) <= 0) ?? kinds[kinds.length - 1]!
      this.start(sim, r, kind, spot, this.between(lo, hi), undefined, sim.actors.get(r)?.dest !== spot)
      return
    }
    if (prev?.kind === 'coffee' && homeOk) {
      this.start(sim, r, 'mug', home, this.between(80, 160))
      return
    }
    const free1 = (spot: SpotId) => !taken(sim, spot, r)
    // (Not anyone still coming in at the office opening: they get to their desk first.)
    const idle = free.filter(p => p !== r && !(p !== 'manager' && this.arriving.has(p)) && (!this.acts.get(p) || AT_HOME.has(this.acts.get(p)!.kind)))
    const hosts = idle.filter(p => VISIT[p] && sim.here(p, HOME[p]) && !crowded(sim, VISIT[p]!, r))
    const options: [number, () => void][] = []
    if (homeOk) {
      if (prev?.kind !== 'sip') options.push([2, () => this.start(sim, r, 'sip', home, this.between(80, 160))])
      if (prev?.kind !== 'phone') options.push([1, () => this.start(sim, r, 'phone', home, this.between(64, 120))])
      if (r === 'manager' && prev?.kind !== 'game') options.push([4, () => this.start(sim, r, 'game', home, this.between(120, 240))])
    }
    if (free1('coffee')) options.push([2, () => this.start(sim, r, 'coffee', 'coffee', 40)])
    // Lunch around noon (approved round 6, "Real time of day"): a sandwich at the desk.
    if (homeOk && lunchAt(v.now) && prev?.kind !== 'eat') options.push([5, () => this.start(sim, r, 'eat', home, this.between(120, 200))])
    // The plant corner at the first front desk (approved round 6): water its plants.
    // (Not by the fir or a holiday thing on the floor, round 9: they stood in the gifts, the can inside the tree.)
    const deco = decorAt(v.now)
    if (free1('garden') && prev?.kind !== 'garden' && !deco.tree && !deco.gifts && !deco.floor) options.push([2, () => this.start(sim, r, 'garden', 'garden', this.between(32, 48))])
    if (free1('plant')) options.push([1, () => this.start(sim, r, 'plant', 'plant', this.between(48, 80))])
    const pair = CHATS.find(([a, b]) => free1(a) && free1(b))
    if (pair && idle.length)
      options.push([
        r === 'manager' ? 4 : 3,
        () => {
          const mate = idle[Math.floor(this.rand() * idle.length)]!
          this.endAct(mate)
          const dur = this.between(120, 200)
          const u1 = this.start(sim, r, 'chat', pair[0], dur, mate)
          const u2 = this.start(sim, mate, 'chat', pair[1], dur, r)
          this.acts.get(r)!.until = this.acts.get(mate)!.until = Math.max(u1, u2)
        },
      ])
    if (hosts.length)
      options.push([
        r === 'manager' ? 3 : 1.5,
        () => {
          const host = hosts[Math.floor(this.rand() * hosts.length)]!
          this.endAct(host)
          const u = this.start(sim, r, 'visit', VISIT[host]!, this.between(96, 160), host)
          this.acts.set(host, { kind: 'host', spot: HOME[host], until: u, partner: r })
        },
      ])
    if (!options.length) options.push([1, () => this.start(sim, r, 'phone', homeOk ? home : spare(sim, r), 64)])
    const total = options.reduce((n, [w]) => n + w, 0)
    let pick = this.rand() * total
    for (const [w, go] of options) {
      pick -= w
      if (pick <= 0) return go()
    }
    options[options.length - 1]![1]()
  }

  /* ===== the Manager while Claude works ===== */

  private manager(sim: BigSim, v: View): void {
    const m = sim.actors.get('manager')
    if (!m || m.leaving || managerFree(v)) return
    const mood = v.mood
    // Back to work: the break is over.
    const wasOnBreak = this.acts.has('manager')
    if (wasOnBreak) this.endAct('manager')
    const urgent = isUrgent(mood)
    // A done line on the board not ticked yet: over to tick it (not while you're needed or the reply is dictated).
    const ticking = this.pending.length > 0 || (sim.tick < this.tickShow && m.dest === 'board')
    let goal: SpotId = 'chair'
    if (meeting(v)) goal = 'board'
    else if (!urgent && mood !== 'write' && mood !== 'idle') goal = ticking ? 'board' : this.watch(sim, v)
    // Thinking in turns (not while a huddle is on, or someone comes to report).
    let posing = false
    this.pose = 'chin'
    if (mood === 'think' && goal === 'chair' && !meeting(v) && this.thinkSince >= 0 && !ROLES.some(r => this.acts.get(r)?.kind === 'huddle')) {
      const g = this.thinkGoal(sim)
      if (g === 'notes') this.pose = 'notes'
      else if (g !== 'chair') {
        goal = g
        posing = true
      }
    }
    // Someone is coming to report or reporting: the Manager hears them out at the desk first.
    if (goal !== 'chair' && !meeting(v) && m.dest === 'chair' && REPORT_SPOTS.some(s => taken(sim, s, 'manager'))) goal = 'chair'
    const away = among(SUP_SPOTS, m.dest) || among(PATROL_SPOTS, m.dest)
    // Once somewhere, the Manager stays a moment (no back and forth), unless needed at the desk.
    if (away && goal !== m.dest && !urgent && mood !== 'write' && !meeting(v) && m.arrivedAt >= 0 && sim.tick - m.arrivedAt < STAY) goal = m.dest
    const fromBreak = !away && m.dest !== 'chair' && m.dest !== 'board'
    if (goal !== m.dest || (wasOnBreak && goal === 'chair'))
      sim.goTo('manager', goal, (urgent || mood === 'write' || fromBreak) && goal === 'chair' ? { hurry: true } : posing ? { speed: 1.5 } : { speed: 3 })
    if (away && m.dest === goal && m.arrivedAt >= 0 && this.banged !== m.arrivedAt) {
      this.banged = m.arrivedAt
      this.bangUntil = m.arrivedAt + 8
    }
  }

  /** Where the thinking Manager is now (see POSES); the coffee machine is skipped when someone is there. */
  private thinkGoal(sim: BigSim): SpotId | 'notes' {
    const m = sim.actors.get('manager')!
    // A new spell of thinking starts from the chin again.
    if (this.poseSpell !== this.thinkSince) {
      this.poseSpell = this.thinkSince
      this.poseIdx = 0
      this.poseEnd = -1
    }
    for (let tries = 0; tries < POSES.length; tries++) {
      const p = POSES[this.poseIdx]!
      // (Nobody else at the coffee machine, or it is skipped.)
      if (p === 'coffee' && taken(sim, 'coffee', 'manager') && this.poseEnd < 0) {
        this.poseIdx = (this.poseIdx + 1) % POSES.length
        continue
      }
      const pacing = p === 'pace'
      const at = pacing ? m.dest === 'paceL' || m.dest === 'paceR' : m.dest === (p === 'board' ? 'board' : p === 'coffee' ? 'coffee' : 'chair')
      // Each pose lasts 5 s from getting there (pacing 6 s).
      if (at && m.arrivedAt >= 0 && this.poseEnd < 0) this.poseEnd = sim.tick + (pacing ? 48 : 40)
      if (this.poseEnd >= 0 && sim.tick >= this.poseEnd) {
        this.poseIdx = (this.poseIdx + 1) % POSES.length
        this.poseEnd = -1
        continue
      }
      if (p === 'chin') return 'chair'
      if (p === 'notes') return 'notes'
      if (pacing) {
        // Back and forth behind the desk.
        if (m.dest === 'paceL') return m.arrivedAt < 0 ? 'paceL' : 'paceR'
        if (m.dest === 'paceR') return m.arrivedAt < 0 ? 'paceR' : 'paceL'
        return 'paceL'
      }
      return p
    }
    return 'chair'
  }

  /** A job starts: count it (employee of the month); if the Manager was just thinking, the lightbulb and the call (approved round 6). */
  private notice(sim: BigSim, v: View): void {
    if (v.mood === 'think') this.thoughtAt = sim.tick
    for (const r of ROLES) {
      const w = v.workers[r]
      if (!w || w.state !== 'work' || w.note === 'reply') continue
      if (this.seen.get(r) === w.since) continue
      this.seen.set(r, w.since)
      this.jobCount.set(r, (this.jobCount.get(r) ?? 0) + 1)
      const m = sim.actors.get('manager')
      if (m && !m.leaving && sim.tick - this.thoughtAt <= 16 && sim.tick >= this.bulbAt + 16) {
        this.bulbAt = sim.tick
        this.callRole = r
      }
    }
  }
  /** Who the Manager calls out to now (after the lightbulb), if anyone. */
  calling(tick: number): Role | null {
    return this.callRole && tick >= this.bulbAt + 6 && tick < this.bulbAt + 16 ? this.callRole : null
  }

  /**
   * Approved round 6, "Ship it": the Courier just finished a git push: carries the parcel to the door, hands it over, comes back (then reports).
   * True while that goes on.
   */
  private shipping(sim: BigSim, v: View): boolean {
    const act = this.acts.get('courier')
    if (act?.kind === 'ship') {
      if (!sim.here('courier', act.spot) || sim.tick < act.until) return true
      this.endAct('courier')
      sim.goTo('courier', HOME.courier, { speed: 2.5 })
      return false
    }
    const w = v.workers.courier
    if (!w || w.state !== 'linger' || !/\bgit push\b/.test(w.full) || this.shipped === w.since || v.now - w.since < 500) return false
    this.shipped = w.since
    // (At the door itself: the line's spots belong to waiting agents.)
    this.endAct('courier')
    const a = sim.goTo('courier', 'door', { speed: 2.5 })
    this.acts.set('courier', { kind: 'ship', spot: 'door', until: sim.tick + Math.ceil(a.length / a.speed) + 8 })
    return true
  }

  /** Now and then on a break, a paper plane from one at their desk to another (approved round 6). */
  private planes(sim: BigSim, v: View, free: Who[]): void {
    if (this.plane && sim.tick - this.plane.at > 20) this.plane = null
    if (this.plane || workTime(v) || sim.tick < this.planeNext) return
    this.planeNext = sim.tick + 120 + Math.floor(this.rand() * 160)
    const atDesk = free.filter((r): r is Role => r !== 'manager' && sim.here(r, HOME[r]))
    if (atDesk.length < 2) return
    const a = atDesk[Math.floor(this.rand() * atDesk.length)]!
    const b = atDesk.filter(x => x !== a)[Math.floor(this.rand() * (atDesk.length - 1))]!
    const pa = sim.at(sim.actors.get(a)!)
    const pb = sim.at(sim.actors.get(b)!)
    // From hand to hand: half way up each of them.
    this.plane = { from: [pa[0] + 3, pa[1] - 6], to: [pb[0] + 3, pb[1] - 6], at: sim.tick }
  }

  /** While thinking or tools run: a round of the front desks, or a worker on a slow job; else the desk. */
  private watch(sim: BigSim, v: View): SpotId {
    const m = sim.actors.get('manager')!
    const seated = sim.seated()
    const slowDesks: number[] = []
    for (let i = 0; i < seated.length; i++) {
      const id = seated[i]
      if (id && v.secs.some(s => s.id === id && s.status === 'run' && v.now - s.startedAt >= SLOW_MS)) slowDesks.push(i)
    }
    for (const r of ROLES) {
      const i = FRONT[r]
      const w = v.workers[r]
      // (Not a briefing or the reply: those never need a look.)
      if (i !== undefined && w?.state === 'work' && !w.note && v.now - w.since >= JOB_SLOW_MS && sim.here(r, HOME[r]) && !slowDesks.includes(i)) slowDesks.push(i)
    }
    slowDesks.sort((a, b) => a - b)
    if (slowDesks.length) {
      // A round: a look over each shoulder, then back to the desk for a while.
      if (among(PATROL_SPOTS, m.dest)) {
        const desk = PATROL_SPOTS.indexOf(m.dest)
        if (slowDesks.includes(desk) && !(m.arrivedAt >= 0 && sim.tick - m.arrivedAt >= PATROL_STOP)) return m.dest
        const next = slowDesks.find(i => i > desk)
        if (next !== undefined) return PATROL_SPOTS[next]!
        this.restUntil = sim.tick + PATROL_REST
        return 'chair'
      }
      if (sim.tick < this.restUntil) return 'chair'
      return PATROL_SPOTS[slowDesks[0]!]!
    }
    const slow = ROLES.filter(r => SUP[r] && v.workers[r]?.state === 'work' && !v.workers[r]!.note && v.now - v.workers[r]!.since >= JOB_SLOW_MS)
    if (slow.some(r => SUP[r] === m.dest)) return m.dest
    const first = [...slow].sort((a, b) => v.workers[a]!.since - v.workers[b]!.since)[0]
    return first ? SUP[first]! : 'chair'
  }
}

/** Someone is at or on the way to `spot` (other than `me`). */
const taken = (sim: BigSim, spot: SpotId, me: ActorId) => {
  for (const a of sim.actors.values()) if (a.dest === spot && !a.leaving && a.id !== me) return true
  return false
}
/** `spot` or one too close to it is taken. */
const crowded = (sim: BigSim, spot: SpotId, me: ActorId) => taken(sim, spot, me) || (NEAR[spot] ?? []).some(s => taken(sim, s, me))
/** `r` is at, or on the way to, their own place: their station, or a spare spot when an agent has their desk. */
const ownPlace = (sim: BigSim, r: Role) => {
  const dest = sim.actors.get(r)?.dest
  return dest !== undefined && (sim.borrowed(r) ? SPARE.includes(dest) : dest === HOME[r])
}
/** A free spare place to stand. */
const spare = (sim: BigSim, me: ActorId) => SPARE.find(s => !taken(sim, s, me)) ?? SPARE[0]!

const isWho = (id: string): id is Who => id === 'manager' || (ROLES as readonly string[]).includes(id)
