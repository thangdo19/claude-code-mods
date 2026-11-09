import { expect, test } from 'claude-code/testing'

import { renderBig } from '../hooks/scene'
import { BigSim } from '../hooks/walk'
import { REPORT_AFTER } from '../hooks/life'
import { EMPTY, endJob, fitRows, lines, MIN_SHOW, NIGHT_MS, ROLE_NAME, ROLES, setMood, startJob, startTurn, view } from '../hooks/office'

import { run, sec, todoTurn } from './helpers'

const BREAK_SPOTS = ['coffee', 'chatA', 'chatB', 'chatC', 'chatD', 'plant', 'visitCourier', 'visitTypist']
const STAFF = ['archivist', 'typist', 'it', 'courier', 'researcher', 'planner', 'librarian'] as const

test('staff are in all day, take breaks, hurry to a job, and go home at night', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 1)
  // Placed at once after a reload: everyone at their own station.
  for (const r of ROLES) expect(sim.actors.has(r)).toBe(true)
  run(sim, day, 2, 400)
  // Everyone has their own line in the list, saying what they do on their break.
  const v = view(day, 50_000)
  const ls = lines(v, sim.seated(), r => sim.doing(v, r))
  for (const r of ROLES) expect(ls.filter(l => l.who === ROLE_NAME[r]).map(l => l.tone)).toEqual(['idle'])
  // A job: the Archivist goes to the cabinets.
  const busy = startJob(startTurn(day, 50_000), { id: 'r', role: 'archivist', short: 'a.ts', full: 'Read a.ts', startedAt: 50_000 })
  run(sim, busy, 50_000, 40)
  expect(sim.here('archivist', 'archivist')).toBe(true)
  // Night: everyone walks out of the door; the Manager stays.
  const night = { ...day, lastActivity: 1, moodAt: 1 }
  run(sim, night, NIGHT_MS + 10, 200)
  expect([...sim.actors.keys()]).toEqual(['manager'])
})

test('while Claude works the break is over: everyone at their own desk at work of their own, or in a huddle', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 400)
  const work = startTurn(day, 50_000)
  run(sim, work, 50_000, 80)
  // (The Manager thinks: two come over to talk it over.)
  const home = (r: string) => (r === 'researcher' ? 'desk0' : r === 'planner' ? 'desk1' : r === 'librarian' ? 'desk2' : r)
  for (const r of STAFF) expect(sim.actors.get(r)!.dest).toBe(sim.life.activity(r) === 'huddle' ? sim.actors.get(r)!.dest : home(r))
  expect(STAFF.filter(r => sim.life.activity(r) === 'huddle').map(r => sim.actors.get(r)!.dest).sort()).toEqual(['rep0', 'rep1'])
  run(sim, setMood(work, 'work', 60_000), 60_000, 160)
  expect(STAFF.filter(r => sim.life.activity(r) === 'own').length).toBeGreaterThanOrEqual(4)
  for (let i = 0; i < 400; i++) {
    run(sim, work, 80_000 + i * 125, 1)
    for (const r of STAFF) expect(BREAK_SPOTS).not.toContain(sim.actors.get(r)!.dest)
  }
})

test('the Manager thinking a while calls two over to talk it over; a report always gets a spot', async () => {
  const sim = new BigSim()
  const o = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  run(sim, o, 2, 120)
  const huddlers = () => STAFF.filter(r => sim.life.activity(r) === 'huddle')
  // Nobody worked yet: the Planner and the Archivist.
  expect(huddlers()).toEqual(['archivist', 'planner'])
  expect(sim.life.icon(sim, view(o, 15_000), 'archivist') ?? sim.life.icon(sim, view(o, 15_000), 'planner')).not.toBe(null)
  const done = endJob(startJob(o, { id: 'e', role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 15_000 }), 'e', 'typist', { short: 'a.ts', full: 'Edit a.ts', err: false, denied: false, endedAt: 15_100 })
  let t = 15_000
  while (sim.life.activity('typist') !== 'report' && t < 25_000) run(sim, done, (t += 125), 1)
  expect(sim.actors.get('typist')!.dest.startsWith('rep')).toBe(true)
  expect(huddlers().length).toBe(1)
  // The thinking ends: back to their desks.
  run(sim, setMood(done, 'work', 30_000), 30_000, 80)
  expect(huddlers()).toEqual([])
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
  expect(ls.filter(l => l.free).map(l => l.what)).toEqual(ROLES.map(() => 'at the board'))
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
  const spots = (['researcher', 'planner', 'librarian'] as const).map(r => sim.actors.get(r)!.dest)
  expect(spots.some(s => s.startsWith('desk'))).toBe(false)
  expect(new Set(spots).size).toBe(3)
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
  expect([...sim.actors.keys()].sort()).toEqual(['archivist', 'courier', 'it', 'librarian', 'manager', 'planner', 'researcher', 'sec:a', 'sec:b', 'typist'])
  expect(sim.here('manager', 'chair')).toBe(true)
})
