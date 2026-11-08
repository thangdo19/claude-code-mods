// Office life: what the staff and the Manager do with nothing to do (coffee, a
// chat, a game, the plant), the planning meeting, and where the Manager goes
// while Claude works. Decides only; BigSim walks. Seeded random, so a test sees
// the same office every run.

import type { Role } from '../types'
import type { BigSim } from './big-walk'
import { ROLE_NAME, ROLES, type View } from './office'

/** A small picture bubble: not working (words in a bubble mean working). */
export type Icon = 'dots' | 'ha' | 'heart' | 'note' | 'bang' | 'ask'
export type ActKind = 'sip' | 'phone' | 'mug' | 'game' | 'coffee' | 'chat' | 'plant' | 'visit' | 'host'
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
const AT_HOME = new Set<ActKind>(['sip', 'phone', 'mug', 'game'])
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
    const free: Who[] = []
    for (const r of ROLES) {
      const a = sim.actors.get(r)
      if (!a || a.leaving) continue
      if (v.workers[r]) {
        this.endAct(r)
        // An agent borrowed their desk: they work where they are (on the phone).
        if (!sim.borrowed(r)) sim.goTo(r, HOME[r], { hurry: true })
      } else if (meeting(v)) {
        this.endAct(r)
        sim.goTo(r, MEET[r])
      } else free.push(r)
    }
    if (managerFree(v)) free.push('manager')
    for (const r of free) {
      const act = this.acts.get(r)
      // Just in: to their own station first.
      if (!act && !sim.here(r)) continue
      if (act && this.valid(sim, r, act, free) && sim.tick < act.until) continue
      this.next(sim, r, free)
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

  private valid(sim: BigSim, r: Who, act: Act, free: Who[]): boolean {
    if (act.spot === HOME[r] && r !== 'manager' && sim.borrowed(r)) return false
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

  private start(sim: BigSim, r: Who, kind: ActKind, spot: string, ticks: number, partner?: Who): number {
    const a = sim.goTo(r, spot)
    const walk = Math.ceil((a.length - a.t) / a.speed) + a.delay
    const act: Act = { kind, spot, until: sim.tick + walk + ticks, partner }
    this.acts.set(r, act)
    return act.until
  }

  private between(lo: number, hi: number): number {
    return Math.round(lo + this.rand() * (hi - lo))
  }

  private next(sim: BigSim, r: Who, free: Who[]): void {
    const prev = this.acts.get(r)
    this.endAct(r)
    const homeOk = r === 'manager' || !sim.borrowed(r)
    const home = HOME[r]
    if (prev?.kind === 'coffee' && homeOk) {
      this.start(sim, r, 'mug', home, this.between(80, 160))
      return
    }
    const free1 = (spot: string) => !taken(sim, spot, r)
    const idle = free.filter(p => p !== r && (!this.acts.get(p) || AT_HOME.has(this.acts.get(p)!.kind)))
    const hosts = idle.filter(p => VISIT[p] && sim.here(p, HOME[p]) && !taken(sim, VISIT[p]!, r))
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
      if (i !== undefined && w?.state === 'work' && v.now - w.since >= SLOW_MS && sim.here(r, HOME[r]) && !slowDesks.includes(i)) slowDesks.push(i)
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
    const slow = ROLES.filter(r => SUP[r] && v.workers[r]?.state === 'work' && v.now - v.workers[r]!.since >= SLOW_MS)
    if (slow.some(r => SUP[r] === m.dest)) return m.dest
    const first = [...slow].sort((a, b) => v.workers[a]!.since - v.workers[b]!.since)[0]
    return first ? SUP[first]! : 'chair'
  }
}

/** Someone is at or on the way to `spot` (other than `me`). */
const taken = (sim: BigSim, spot: string, me: string) => [...sim.actors.values()].some(a => a.dest === spot && !a.leaving && a.id !== me)
/** A free spare place to stand. */
const spare = (sim: BigSim, me: string) => SPARE.find(s => !taken(sim, s, me)) ?? SPARE[0]!

const isWho = (id: string): id is Who => id === 'manager' || (ROLES as readonly string[]).includes(id)
