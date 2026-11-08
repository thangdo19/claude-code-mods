// Office life: what the staff and the Manager do with nothing to do (between turns
// a break: coffee, a chat, a game, the plant; while Claude works their own things at
// their desk), reporting a finished job to the Manager, the planning meeting, and
// where the Manager goes while Claude works. Decides only; BigSim walks. Seeded random, so a test sees
// the same office every run.

import type { Role } from '../types'
import type { BigSim } from './big-walk'
import { LINGER_MS, ROLE_NAME, ROLES, type View } from './office'

/** A small picture bubble: not working (words in a bubble mean working). */
export type Icon = 'dots' | 'ha' | 'heart' | 'note' | 'bang' | 'ask' | 'check'
export type ActKind = 'sip' | 'phone' | 'mug' | 'game' | 'coffee' | 'chat' | 'plant' | 'visit' | 'host' | 'read' | 'tidy' | 'stretch' | 'report'
/** Someone with a life: a role, or 'manager'. */
type Who = Role | 'manager'
type Act = { kind: ActKind; spot: string; until: number; partner?: Who }

export const HOME: Record<Who, string> = {
  archivist: 'archivist', typist: 'typist', it: 'it', courier: 'courier', researcher: 'desk0', planner: 'desk1', librarian: 'desk2', manager: 'chair',
}
const MEET: Record<Role, string> = { archivist: 'meet0', it: 'meet1', courier: 'meet2', typist: 'meet3', researcher: 'meet4', planner: 'meet5', librarian: 'meet6' }
const SUP: Partial<Record<Role, string>> = { archivist: 'supArchivist', it: 'supIt', courier: 'supCourier', typist: 'supTypist' }
const FRONT: Partial<Record<Role, number>> = { researcher: 0, planner: 1, librarian: 2 }
const VISIT: Partial<Record<Who, string>> = { courier: 'visitCourier', typist: 'visitTypist' }
/** Two places to chat: by the water cooler, and by the board. */
const CHATS: [string, string][] = [['chatA', 'chatB'], ['chatC', 'chatD']]
const AT_HOME = new Set<ActKind>(['sip', 'phone', 'mug', 'game', 'read', 'tidy', 'stretch'])
/** Their own things at the desk while Claude works (no breaks then): kind, weight, shortest and longest ticks. */
const DESK_ACTS: readonly [ActKind, number, number, number][] = [['read', 2, 96, 180], ['tidy', 2, 64, 120], ['sip', 2, 64, 120], ['phone', 2, 48, 96], ['stretch', 1, 24, 40]]
const AT_DESK = new Set<ActKind>(DESK_ACTS.map(([k]) => k))
/** Where a finished job is reported: either end of the Manager's desk. */
const REPORT_SPOTS = ['rep0', 'rep1']
/** Spots too close together for two people at once (a report spot and the visit / look-over spot below it). */
const NEAR: Record<string, string[]> = {
  rep0: ['visitCourier', 'supCourier'], rep1: ['visitTypist', 'supTypist'], visitCourier: ['rep0'], visitTypist: ['rep1'],
}
/** A finished worker waits this long (ms) for a next job before going to report. */
export const REPORT_AFTER = 1000
/** Ticks a report lasts once there (1.5 s). */
const REPORT_TICKS = 12
/** Spare places to stand (the meeting's, unused outside it) for someone whose desk an agent borrowed. */
const SPARE = ['meet4', 'meet5', 'meet2', 'meet3', 'meet6']
const CHAT_ICONS: Icon[] = ['dots', 'ha', 'heart', 'note']
const MEET_ICONS: Icon[] = ['ask', 'bang', 'dots']
const NAME = (w: Who) => (w === 'manager' ? 'Manager' : ROLE_NAME[w])

/** A job or agent running this long (ms) brings the Manager over. */
export const SLOW_MS = 1500
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
export const meeting = (v: View): boolean => v.planning && ['plan', 'permission', 'ask'].includes(v.mood)
/** Between turns, before night: the Manager is on a break too. */
export const managerFree = (v: View): boolean => v.mood === 'idle' && !v.night
/** Claude's turn is on: breaks are over, everyone is at their own desk. */
export const workTime = (v: View): boolean => !v.night && ['think', 'write', 'work', 'permission', 'ask', 'plan'].includes(v.mood)

export class Life {
  readonly acts = new Map<Who, Act>()
  private rand = rng(7)
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

  /** Who is in the office: staff come for the workday, go home at night; the Manager is always in. */
  sync(sim: BigSim, v: View, instant: boolean): void {
    if (!sim.actors.has('manager')) sim.goTo('manager', meeting(v) ? 'board' : 'chair', { instant: true })
    let k = 0
    for (const r of ROLES) {
      const job = v.workers[r] !== undefined
      const inside = job || !v.night
      const a = sim.actors.get(r)
      if (inside && (!a || a.leaving)) {
        this.endAct(r)
        const home = sim.borrowed(r) ? spare(sim, r) : HOME[r]
        sim.goTo(r, home, instant ? { instant: true } : job ? { hurry: true } : { delay: 6 * k++ })
      } else if (!inside && a && !a.leaving) {
        this.endAct(r)
        if (instant) sim.remove(r)
        else sim.goTo(r, 'door', { leaving: true, delay: 6 * k++ })
      }
    }
  }

  step(sim: BigSim, v: View): void {
    this.manager(sim, v)
    const reply = v.workers.typist?.note === 'reply'
    if (this.typingReply && !reply) this.replyEnded = v.now
    this.typingReply = reply
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
        // Just finished (a job, or the Typist's reply): report it to the Manager first.
        let finished = w ? w.since : -Infinity
        if (r === 'typist' && v.now - this.replyEnded < LINGER_MS) finished = Math.max(finished, this.replyEnded)
        if (finished > -Infinity && this.reporting(sim, v, r, finished)) continue
        free.push(r)
      }
    }
    if (managerFree(v)) free.push('manager')
    for (const r of free) {
      const act = this.acts.get(r)
      // Just in, or on the way to their own place: there first. (In work time, never on to a break spot.)
      // (Never on to their desk once an agent has it.)
      const blocked = r !== 'manager' && sim.borrowed(r) && sim.actors.get(r)?.dest === HOME[r]
      if (!act && !sim.here(r) && !blocked && (!work || r === 'manager' || ownPlace(sim, r))) continue
      if (act && this.valid(sim, r, act, free, v) && sim.tick < act.until) continue
      this.next(sim, r, free, v)
    }
    const want = v.mood === 'think' ? 3 : 0
    if (['permission', 'ask', 'hold', 'stopped', 'done'].includes(v.mood)) this.think = 0
    if (this.think === want) this.thinkClock = 0
    else if (++this.thinkClock >= 2) {
      this.thinkClock = 0
      this.think = want > this.think ? this.think + 1 : this.think === 3 ? 1 : 0
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
    if (!isWho(id)) return null
    const mine = this.acts.get(id)
    if (mine?.kind === 'report') return sim.here(id, mine.spot) ? 'check' : null
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

  /** Who is on a break (or in the meeting), for the list. */
  breakLine(sim: BigSim, v: View): { who: string; what: string } | null {
    const inside: Who[] = ROLES.filter(r => sim.actors.has(r) && !sim.actors.get(r)!.leaving && !v.workers[r])
    if (managerFree(v)) inside.unshift('manager')
    if (!inside.length) return null
    if (meeting(v)) return { who: 'Meeting', what: inside.map(NAME).join(', ') + ' at the board' }
    const what: Record<ActKind, string> = {
      sip: 'having a coffee', mug: 'having a coffee', phone: 'on the phone', game: 'playing a game', coffee: 'making coffee',
      plant: 'watering the plant', chat: 'chatting', visit: 'visiting', host: 'chatting',
      read: 'reading', tidy: 'tidying up', stretch: 'stretching', report: 'reporting to the Manager',
    }
    if (workTime(v)) {
      const parts = inside.map(r => {
        const act = this.acts.get(r)
        return NAME(r) + ' ' + (act ? what[act.kind] : 'back to the desk')
      })
      return { who: 'Desks', what: parts.join(' · ') }
    }
    const done = new Set<Who>()
    const parts: string[] = []
    for (const r of inside) {
      if (done.has(r)) continue
      done.add(r)
      const act = this.acts.get(r)
      const mate = act?.partner
      if (act && mate && inside.includes(mate)) {
        done.add(mate)
        const host = act.kind === 'host' ? r : act.kind === 'visit' ? mate : null
        parts.push(host ? NAME(host === r ? mate : r) + ' visits ' + NAME(host) : NAME(r) + ' & ' + NAME(mate) + ' chatting')
        continue
      }
      parts.push(NAME(r) + ' ' + (act ? what[act.kind] : 'just in'))
    }
    return { who: 'Break', what: parts.join(' · ') }
  }

  /* ===== a break ===== */

  private valid(sim: BigSim, r: Who, act: Act, free: Who[], v: View): boolean {
    if (act.spot === HOME[r] && r !== 'manager' && sim.borrowed(r)) return false
    // Claude is working: the break is over.
    if (workTime(v) && !AT_DESK.has(act.kind)) return false
    if (!act.partner) return true
    const theirs = this.acts.get(act.partner)
    return free.includes(act.partner) && theirs?.partner === r
  }

  /** Ends `r`'s activity; a chat ends for both. */
  private endAct(r: Who): void {
    const act = this.acts.get(r)
    if (!act) return
    this.acts.delete(r)
    if (act.partner && this.acts.get(act.partner)?.partner === r) this.acts.delete(act.partner)
  }

  private start(sim: BigSim, r: Who, kind: ActKind, spot: string, ticks: number, partner?: Who, hurry = false): number {
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
    const spot = sim.here('manager', 'chair') ? REPORT_SPOTS.find(s => !crowded(sim, s, r)) : undefined
    const dest = sim.actors.get(r)!.dest
    const here = sim.borrowed(r) && dest === HOME[r] ? spare(sim, r) : dest
    this.start(sim, r, 'report', spot ?? here, REPORT_TICKS, undefined, spot !== undefined)
    return true
  }

  private next(sim: BigSim, r: Who, free: Who[], v: View): void {
    const prev = this.acts.get(r)
    this.endAct(r)
    const homeOk = r === 'manager' || !sim.borrowed(r)
    const home = HOME[r]
    if (workTime(v) && r !== 'manager') {
      // Their own things at their own desk (a spare spot, with a paper or the phone, if an agent borrowed it).
      const spot = homeOk ? home : spare(sim, r)
      const kinds = DESK_ACTS.filter(([k]) => k !== prev?.kind && (homeOk || k === 'read' || k === 'phone'))
      let pick = this.rand() * kinds.reduce((n, [, w]) => n + w, 0)
      const [kind, , lo, hi] = kinds.find(([, w]) => (pick -= w) <= 0) ?? kinds[kinds.length - 1]!
      this.start(sim, r, kind, spot, this.between(lo, hi), undefined, sim.actors.get(r)?.dest !== spot)
      return
    }
    if (prev?.kind === 'coffee' && homeOk) {
      this.start(sim, r, 'mug', home, this.between(80, 160))
      return
    }
    const free1 = (spot: string) => !taken(sim, spot, r)
    const idle = free.filter(p => p !== r && (!this.acts.get(p) || AT_HOME.has(this.acts.get(p)!.kind)))
    const hosts = idle.filter(p => VISIT[p] && sim.here(p, HOME[p]) && !crowded(sim, VISIT[p]!, r))
    const options: [number, () => void][] = []
    if (homeOk) {
      if (prev?.kind !== 'sip') options.push([2, () => this.start(sim, r, 'sip', home, this.between(80, 160))])
      if (prev?.kind !== 'phone') options.push([1, () => this.start(sim, r, 'phone', home, this.between(64, 120))])
      if (r === 'manager' && prev?.kind !== 'game') options.push([4, () => this.start(sim, r, 'game', home, this.between(120, 240))])
    }
    if (free1('coffee')) options.push([2, () => this.start(sim, r, 'coffee', 'coffee', 40)])
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
    if (!m || managerFree(v)) return
    const mood = v.mood
    // Back to work: the break is over.
    const wasOnBreak = this.acts.has('manager')
    if (wasOnBreak) this.endAct('manager')
    const urgent = ['permission', 'ask', 'hold', 'stopped', 'done'].includes(mood)
    let goal = 'chair'
    if (meeting(v)) goal = 'board'
    else if (!urgent && mood !== 'write' && mood !== 'idle') goal = this.watch(sim, v)
    // Someone is coming to report or reporting: the Manager hears them out at the desk first.
    if (goal !== 'chair' && goal !== 'board' && m.dest === 'chair' && REPORT_SPOTS.some(s => taken(sim, s, 'manager'))) goal = 'chair'
    const away = m.dest.startsWith('sup') || m.dest.startsWith('patrol')
    // Once somewhere, the Manager stays a moment (no back and forth), unless needed at the desk.
    if (away && goal !== m.dest && !urgent && mood !== 'write' && !meeting(v) && m.arrivedAt >= 0 && sim.tick - m.arrivedAt < STAY) goal = m.dest
    const fromBreak = !away && m.dest !== 'chair' && m.dest !== 'board'
    if (goal !== m.dest || (wasOnBreak && goal === 'chair'))
      sim.goTo('manager', goal, (urgent || mood === 'write' || fromBreak) && goal === 'chair' ? { hurry: true } : { speed: 3 })
    if (away && m.dest === goal && m.arrivedAt >= 0 && this.banged !== m.arrivedAt) {
      this.banged = m.arrivedAt
      this.bangUntil = m.arrivedAt + 8
    }
  }

  /** While thinking or tools run: a round of the front desks, or a worker on a slow job; else the desk. */
  private watch(sim: BigSim, v: View): string {
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
      if (i !== undefined && w?.state === 'work' && !w.note && v.now - w.since >= SLOW_MS && sim.here(r, HOME[r]) && !slowDesks.includes(i)) slowDesks.push(i)
    }
    slowDesks.sort((a, b) => a - b)
    if (slowDesks.length) {
      // A round: a look over each shoulder, then back to the desk for a while.
      if (m.dest.startsWith('patrol')) {
        const desk = Number(m.dest.slice(6))
        if (slowDesks.includes(desk) && !(m.arrivedAt >= 0 && sim.tick - m.arrivedAt >= PATROL_STOP)) return m.dest
        const next = slowDesks.find(i => i > desk)
        if (next !== undefined) return 'patrol' + next
        this.restUntil = sim.tick + PATROL_REST
        return 'chair'
      }
      if (sim.tick < this.restUntil) return 'chair'
      return 'patrol' + slowDesks[0]
    }
    const slow = ROLES.filter(r => SUP[r] && v.workers[r]?.state === 'work' && !v.workers[r]!.note && v.now - v.workers[r]!.since >= SLOW_MS)
    if (slow.some(r => SUP[r] === m.dest)) return m.dest
    const first = [...slow].sort((a, b) => v.workers[a]!.since - v.workers[b]!.since)[0]
    return first ? SUP[first]! : 'chair'
  }
}

/** Someone is at or on the way to `spot` (other than `me`). */
const taken = (sim: BigSim, spot: string, me: string) => [...sim.actors.values()].some(a => a.dest === spot && !a.leaving && a.id !== me)
/** `spot` or one too close to it is taken. */
const crowded = (sim: BigSim, spot: string, me: string) => taken(sim, spot, me) || (NEAR[spot] ?? []).some(s => taken(sim, s, me))
/** `r` is at, or on the way to, their own place: their station, or a spare spot when an agent has their desk. */
const ownPlace = (sim: BigSim, r: Role) => {
  const dest = sim.actors.get(r)?.dest ?? ''
  return sim.borrowed(r) ? SPARE.includes(dest) : dest === HOME[r]
}
/** A free spare place to stand. */
const spare = (sim: BigSim, me: string) => SPARE.find(s => !taken(sim, s, me)) ?? SPARE[0]!

const isWho = (id: string): id is Who => id === 'manager' || (ROLES as readonly string[]).includes(id)
