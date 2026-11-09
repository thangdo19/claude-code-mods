import { expect, test } from 'claude-code/testing'

import { renderBig } from '../hooks/scene'
import { BigSim } from '../hooks/walk'
import { REPORT_AFTER } from '../hooks/life'
import { BOSS_BUBBLE } from '../hooks/layout'
import { EMPTY, endJob, fitRows, lines, MIN_SHOW, NIGHT_MS, ROLE_NAME, ROLES, setMood, startJob, startTurn, view } from '../hooks/office'
import { remote } from '../hooks/world'

import { run, sec, todoTurn } from './helpers'

const BREAK_SPOTS = ['coffee', 'chatA', 'chatB', 'chatC', 'chatD', 'plant', 'visitCourier', 'visitTypist']
/** The staff who work in the office (the Researcher and the Librarian work from home: approved round 6). */
const STAFF = ['archivist', 'typist', 'it', 'courier', 'planner'] as const

test('staff are in all day, take breaks, hurry to a job, and go home at night', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 1)
  // Placed at once after a reload: everyone at their own station; those working from home never come in.
  for (const r of ROLES) expect(sim.actors.has(r)).toBe(!remote(r))
  run(sim, day, 2, 400)
  // Everyone has their own line in the list, saying what they do on their break.
  const v = view(day, 50_000)
  const ls = lines(v, sim.seated(), r => sim.doing(v, r))
  for (const r of ROLES) expect(ls.filter(l => l.who === ROLE_NAME[r]).map(l => l.tone)).toEqual(['idle'])
  expect(ls.find(l => l.who === 'Researcher')?.what).toBe('working from home')
  // A job: the Archivist goes to the cabinets; the Researcher takes theirs on the video call, still at home.
  let busy = startJob(startTurn(day, 50_000), { id: 'r', role: 'archivist', short: 'a.ts', full: 'Read a.ts', startedAt: 50_000 })
  busy = startJob(busy, { id: 'w', role: 'researcher', short: 'oauth', full: 'Web search: oauth', startedAt: 50_000 })
  run(sim, busy, 50_000, 40)
  expect(sim.here('archivist', 'archivist')).toBe(true)
  expect(sim.actors.has('researcher')).toBe(false)
  const bv = view(busy, 55_000)
  expect(lines(bv, sim.seated(), r => sim.doing(bv, r)).find(l => l.who === 'Researcher')?.what).toBe('Web search: oauth (on a call)')
  // Night: everyone walks out of the door; the Manager stays.
  const night = { ...day, lastActivity: 1, moodAt: 1 }
  run(sim, night, NIGHT_MS + 10, 200)
  expect([...sim.actors.keys()]).toEqual(['manager'])
  expect(sim.doing(view(night, NIGHT_MS + 40_000), 'librarian')).toBe('gone home')
})

test('while Claude works the break is over: everyone at their own desk at work of their own, or in a huddle', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 400)
  const work = startTurn(day, 50_000)
  run(sim, work, 50_000, 80)
  // (The Manager thinks: two come over to talk it over.)
  const home = (r: string) => (r === 'planner' ? 'desk1' : r)
  for (const r of STAFF) expect(sim.actors.get(r)!.dest).toBe(sim.life.activity(r) === 'huddle' ? sim.actors.get(r)!.dest : home(r))
  expect(STAFF.filter(r => sim.life.activity(r) === 'huddle').map(r => sim.actors.get(r)!.dest).sort()).toEqual(['rep0', 'rep1'])
  run(sim, setMood(work, 'work', 60_000), 60_000, 160)
  expect(STAFF.filter(r => sim.life.activity(r) === 'own').length).toBeGreaterThanOrEqual(4)
  for (let i = 0; i < 400; i++) {
    run(sim, work, 80_000 + i * 125, 1)
    for (const r of STAFF) expect(BREAK_SPOTS).not.toContain(sim.actors.get(r)!.dest)
  }
})

test('the Manager thinking 8 s calls two over to talk it over, once a stretch; a report always gets a spot', async () => {
  const sim = new BigSim()
  const o = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  const huddlers = () => STAFF.filter(r => sim.life.activity(r) === 'huddle')
  // (Approved round 6, "Fewer huddles": not before 8 s of thinking.)
  run(sim, o, 2, 60)
  expect(huddlers()).toEqual([])
  run(sim, o, 2 + 60 * 125, 8)
  // Nobody worked yet: the Planner and the Archivist.
  expect(huddlers()).toEqual(['archivist', 'planner'])
  run(sim, o, 2 + 68 * 125, 16)
  expect(sim.life.icon(sim, view(o, 10_500), 'archivist') ?? sim.life.icon(sim, view(o, 10_500), 'planner')).not.toBe(null)
  const done = endJob(startJob(o, { id: 'e', role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 9_000 }), 'e', 'typist', { short: 'a.ts', full: 'Edit a.ts', err: false, denied: false, endedAt: 9_100 })
  let t = 10_500
  while (sim.life.activity('typist') !== 'report' && t < 14_000) run(sim, done, (t += 125), 1)
  expect(sim.actors.get('typist')!.dest.startsWith('rep')).toBe(true)
  expect(huddlers().length).toBe(1)
  // It lasts 6 s, and the same stretch of thinking never calls another.
  for (let i = 0; i < 160; i++) run(sim, o, 14_000 + i * 125, 1)
  expect(huddlers()).toEqual([])
  expect(STAFF.some(r => sim.actors.get(r)!.dest.startsWith('rep'))).toBe(false)
  // The thinking ends and starts again: a new stretch, a new huddle after 8 s.
  run(sim, setMood(o, 'work', 40_000), 40_000, 8)
  run(sim, setMood(o, 'think', 41_000), 41_000, 70)
  expect(huddlers().length).toBe(2)
})

test('thinking a long while: chin, notes, a huddle at 8 s, pacing behind the desk, the board, a coffee, round again', async () => {
  const sim = new BigSim()
  const o = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  const seen: string[] = []
  for (let i = 0; i < 700; i++) {
    run(sim, o, 2 + i * 125, 1)
    const m = sim.actors.get('manager')!
    const at = m.arrivedAt < 0 ? null : m.dest === 'chair' ? (sim.life.activity('archivist') === 'huddle' ? 'huddle' : sim.life.pose) : m.dest.replace(/[LR]$/, '')
    if (at && seen[seen.length - 1] !== at) seen.push(at)
  }
  // (After the huddle the Manager waits at the desk, chin in hand, while the two walk back.)
  expect(seen.slice(0, 8)).toEqual(['chin', 'notes', 'huddle', 'chin', 'pace', 'board', 'coffee', 'chin'])
})

test('a job right after thinking: a lightbulb, then the Manager calls out who gets it; not long after', async () => {
  const sim = new BigSim()
  const o = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  run(sim, o, 2, 30)
  const job = startJob(setMood(o, 'work', 3_800), { id: 'g', role: 'archivist', short: 'login', full: 'Search "login"', startedAt: 3_800 })
  run(sim, job, 3_800, 1)
  expect(sim.life.icon(sim, view(job, 3_900), 'manager')).toBe('bulb')
  run(sim, job, 3_925, 6)
  expect(sim.life.calling(sim.tick)).toBe('archivist')
  const sc = renderBig(view(job, 4_700), sim, 1, 2)
  expect(sc.texts.filter(t => t.row === BOSS_BUBBLE.words.row).map(t => t.ch).join('')).toContain('Archivist!')
  run(sim, job, 4_700, 40)
  expect(sim.life.calling(sim.tick)).toBe(null)
  // Long after the thinking: no lightbulb.
  const later = startJob(job, { id: 'h', role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 9_800 })
  run(sim, later, 9_800, 1)
  expect(sim.life.icon(sim, view(later, 9_900), 'manager')).not.toBe('bulb')
})

test('git push: the Courier packs a parcel, walks it to the door, comes back and reports once', async () => {
  const sim = new BigSim()
  let o = setMood(startTurn({ ...EMPTY, lastActivity: 1 }, 1), 'work', 1)
  o = startJob(o, { id: 'p', role: 'courier', short: 'git push', full: '$ git push', startedAt: 1_000 })
  run(sim, o, 1_000, 8)
  const done = endJob(o, 'p', 'courier', { short: 'git push', full: '$ git push', err: false, denied: false, endedAt: 1_500 })
  let t = 2_000
  while (sim.life.activity('courier') !== 'ship' && t < 8_000) run(sim, done, (t += 125), 1)
  expect(sim.actors.get('courier')!.dest).toBe('door')
  expect(sim.doorOpen()).toBe(true)
  let reports = 0
  let prev: string | null = null
  for (let i = 0; i < 200; i++) {
    run(sim, done, (t += 125), 1)
    const k = sim.life.activity('courier')
    if (k === 'report' && prev !== 'report') reports++
    prev = k
  }
  expect(reports).toBe(1)
  expect(sim.here('courier', 'courier')).toBe(true)
})

test('Claude writing the reply: the Manager dictates, the Typist types it, then reports it once', async () => {
  const o = setMood(startTurn({ ...EMPTY, lastActivity: 1 }, 1), 'write', 1)
  expect(view(o, 2).workers.typist).toMatchObject({ state: 'work', short: 'reply', note: 'reply' })
  expect(lines(view(o, 2)).map(l => l.what)).toContain('Typing the reply')
  const sim = new BigSim()
  run(sim, o, 2, 40)
  const after = setMood(o, 'work', 5_000)
  run(sim, after, 5_000, 4)
  expect(sim.life.activity('typist')).not.toBe('report')
  run(sim, after, 5_000 + REPORT_AFTER, 2)
  expect(sim.life.activity('typist')).toBe('report')
  expect(sim.actors.get('typist')!.dest.startsWith('rep')).toBe(true)
  run(sim, after, 6_500, 60)
  expect(sim.actors.get('typist')!.dest).toBe('typist')
  expect(sim.life.activity('typist')).not.toBe('report')
})

test('a finished worker reports to the Manager; a next job first means no report', async () => {
  const sim = new BigSim()
  const read = { id: 'r', role: 'archivist' as const, short: 'a.ts', full: 'Read a.ts', startedAt: 1_000 }
  // (Calling tools, not thinking: no huddle at the report spots.)
  let o = startJob(setMood(startTurn({ ...EMPTY, lastActivity: 1 }, 1), 'work', 1), read)
  run(sim, o, 1_000, 8)
  o = endJob(o, 'r', 'archivist', { short: 'a.ts', full: 'Read a.ts', err: false, denied: false, endedAt: 2_000 })
  // Another job within a second: straight to it, no report.
  const next = startJob(o, { ...read, id: 'r2', startedAt: 2_500 })
  run(sim, next, 2_000, 8)
  expect(sim.life.activity('archivist')).toBe(null)
  const done = endJob(next, 'r2', 'archivist', { short: 'a.ts', full: 'Read a.ts', err: false, denied: false, endedAt: 3_000 })
  // (At a human pace the second read shows from the end of the first, MIN_SHOW: the report comes after that.)
  const shownEnd = 1_000 + 2 * MIN_SHOW
  run(sim, done, 3_000, (shownEnd + REPORT_AFTER - 3_000) / 125 + 4)
  expect(sim.life.activity('archivist')).toBe('report')
  expect(sim.actors.get('archivist')!.dest).toBe('rep0')
  run(sim, done, shownEnd + 2_000, 8)
  expect(sim.here('archivist', 'rep0')).toBe(true)
  expect(sim.life.icon(sim, view(done, shownEnd + 3_000), 'archivist')).toBe('check')
  run(sim, done, shownEnd + 3_000, 60)
  expect(sim.actors.get('archivist')!.dest).toBe('archivist')
})

test('the Manager away from the desk: the report is called in from where the worker is', async () => {
  const sim = new BigSim()
  let o = setMood(startTurn({ ...EMPTY, lastActivity: 1 }, 1), 'work', 1)
  // A slow job for the Courier: the Manager goes over to look.
  o = startJob(o, { id: 'w', role: 'courier', short: 'chrome', full: 'chrome: navigate', startedAt: 1 })
  run(sim, o, 2, 60)
  expect(sim.here('manager', 'supCourier')).toBe(true)
  o = startJob(o, { id: 'r', role: 'archivist', short: 'a.ts', full: 'Read a.ts', startedAt: 7_500 })
  run(sim, o, 7_500, 4)
  const done = endJob(o, 'r', 'archivist', { short: 'a.ts', full: 'Read a.ts', err: false, denied: false, endedAt: 8_000 })
  run(sim, done, 8_000, 2 + (7_500 + MIN_SHOW + REPORT_AFTER - 8_000) / 125)
  expect(sim.life.activity('archivist')).toBe('report')
  expect(sim.actors.get('archivist')!.dest).toBe('archivist')
})

test('plan mode: the Manager calls everyone free to the board', async () => {
  const sim = new BigSim()
  const o = { ...startTurn(EMPTY, 1), plan: true }
  run(sim, o, 2, 200)
  expect(sim.here('manager', 'board')).toBe(true)
  expect(sim.here('typist', 'meet3')).toBe(true)
  const v = view(o, 30_000)
  const ls = lines(v, sim.seated(), r => sim.doing(v, r))
  expect(ls.filter(l => l.free).map(l => l.what)).toEqual(ROLES.map(r => (remote(r) ? 'working from home' : 'at the board')))
  // Short of rows, they share one line.
  expect(fitRows(ls, 40, 3).map(l => l.who + ': ' + l.what)).toEqual(['Manager: Planning (plan mode)', 'Staff: all at the board'])
})

test('between turns the Manager is on a break; at night the Manager naps at the desk', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 600)
  expect(sim.life.activity('manager')).not.toBe(null)
  run(sim, day, NIGHT_MS + 10, 200)
  expect(sim.here('manager', 'chair')).toBe(true)
  expect(view(day, NIGHT_MS + 30_000).line).toContain('Asleep')
  // You type: the break is over at once.
  run(sim, startTurn(day, NIGHT_MS + 40_000), NIGHT_MS + 40_000, 1)
  expect(sim.life.activity('manager')).toBe(null)
})

test('staff whose desks agents borrowed each stand somewhere of their own', async () => {
  const sim = new BigSim()
  let o = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  for (const id of ['a', 'b', 'c', 'd']) o = sec(o, id, 1)
  run(sim, o, 2, 400)
  // (Agents borrow only the Planner's desk.)
  expect(sim.borrowed('planner')).toBe(true)
  expect(sim.actors.get('planner')!.dest.startsWith('desk')).toBe(false)
})

test('the board shows the to-do words; the Manager walks over and ticks each done line once', async () => {
  const sim = new BigSim()
  run(sim, todoTurn(0), 2, 20)
  expect(sim.life.pending).toEqual([])
  run(sim, todoTurn(1), 5_000, 2)
  expect(sim.life.pending).toEqual(['Find the bug'])
  // Not ticked until the Manager is at the board.
  expect(sim.life.ticked.has('Find the bug')).toBe(false)
  let visits = 0
  for (let i = 0; i < 120; i++) {
    const was = sim.here('manager', 'board')
    run(sim, todoTurn(1), 5_250 + i * 125, 1)
    if (!was && sim.here('manager', 'board')) visits++
  }
  expect(visits).toBe(1)
  expect(sim.life.ticked.has('Find the bug')).toBe(true)
  expect(sim.actors.get('manager')!.dest).toBe('chair')
  const sc = renderBig(view(todoTurn(1), 20_000), sim, 1, 2)
  const row = (r: number) => sc.texts.filter(t => t.row === r && t.x >= 32 && t.x <= 45).map(t => t.ch).join('')
  expect(row(2)).toContain('v Find the bug')
  expect(row(3)).toContain('> Fix it')
  // A reload: what is done counts as ticked; nobody walks over again.
  const fresh = new BigSim()
  run(fresh, todoTurn(2), 30_000, 40)
  expect(fresh.life.pending).toEqual([])
  expect(fresh.here('manager', 'board')).toBe(false)
})

test('compacting: staff and the Manager step out, a busy agent keeps its desk, the Janitor sweeps the office', async () => {
  const sim = new BigSim()
  let o = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  o = sec(sec(o, 'a', 1), 'b', 1, 'idle')
  run(sim, o, 2, 200)
  expect(sim.seated().filter(Boolean).sort()).toEqual(['a', 'b'])
  const clean = { ...o, compacting: true }
  expect(view(clean, 30_000).line).toBe('Stepped out while the Janitor cleans')
  const stops = new Set<string>()
  for (let i = 0; i < 480; i++) {
    run(sim, clean, 30_000 + i * 125, 1)
    stops.add(sim.actors.get('janitor')?.dest ?? '')
  }
  expect([...sim.actors.keys()].sort()).toEqual(['janitor', 'sec:a'])
  expect([...stops].filter(d => d.startsWith('sweep')).length).toBeGreaterThanOrEqual(6)
  expect(sim.doing(view(clean, 90_000), 'typist')).toBe('stepped out while the Janitor cleans')
  // Done: everyone back, the waiting teammate gets a desk again; the Janitor is gone.
  run(sim, o, 90_000, 400)
  expect([...sim.actors.keys()].sort()).toEqual(['archivist', 'courier', 'it', 'manager', 'planner', 'sec:a', 'sec:b', 'typist'])
  // (Still thinking: the Manager may be pacing or at the board, but inside.)
  expect((['manager', ...STAFF] as const).every(r => !sim.actors.get(r)!.leaving)).toBe(true)
})
