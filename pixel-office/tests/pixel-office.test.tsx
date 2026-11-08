import { expect, mock, test } from 'claude-code/testing'

import { bigCells } from '../hooks/big-cells'
import { BIG_COLS, BIG_ROWS, renderBig } from '../hooks/big-scene'
import { LOOK } from '../hooks/big-sprites'
import { BigSim, routeTo, SPOTS } from '../hooks/big-walk'
import { Calm, CALM_HOLD } from '../hooks/calm'
import { describe as label, mask } from '../hooks/labels'
import { Camera, CAM_COLS, CAM_ROWS, focusOf } from '../hooks/camera'
import { REPORT_AFTER } from '../hooks/life'
import {
  addSec, addTask, ascii, BRIEF_MS, DONE_MS, DOT, EMPTY, endJob, endTurn, fitRows, LINGER_MS, lines, NIGHT_MS, patchTask, setMood, startJob, startTurn, STOP_MS, tasksFrom,
  textWidth, view, WHO_W, wrapLine, type Line, type View,
} from '../hooks/office'
import type { Office } from '../types'

// The test environment has timers; its type declarations name none.
const wait = (ms: number) => new Promise<void>(r => (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, ms))

const PANE = {
  plugin: 'pixel-office',
  component: 'Pane',
  requestId: 'office',
  props: { title: 'Office', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const sec = (o: Office, id: string, now: number, status: 'run' | 'done' | 'idle' = 'run') =>
  addSec(o, { id, name: 'Explore', task: 'find ' + id, short: 'grep ' + id, full: 'Grep ' + id, status, startedAt: now, endedAt: status === 'run' ? null : now, teammate: status === 'idle' })

/** A busy office: workers, a background command, six agents (more than the desks), plan items. */
function busy(): Office {
  let o = setMood(startTurn(EMPTY, 1), 'permission', 1, 'Needs your OK: git push')
  o = startJob(o, { id: 'r', role: 'archivist', short: 'auth.ts', full: 'Read src/auth.ts', startedAt: 1 })
  o = startJob(o, { id: 'e', role: 'typist', short: 'auth.ts', full: 'Edit src/auth.ts', startedAt: 1 })
  o = startJob(o, { id: 'b1', role: 'it', short: 'npm test', full: '$ npm test', startedAt: 1 })
  o = startJob(o, { id: 'b2', role: 'it', short: 'npm test', full: '$ npm run lint', startedAt: 1 })
  o = startJob(o, { id: 'w', role: 'courier', short: 'oauth…', full: 'Web search: oauth', startedAt: 1 })
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) o = sec(o, id, 1)
  return { ...o, bg: ['npm run dev'], todos: [{ text: 'Find', status: 'completed' }, { text: 'Fix', status: 'in_progress' }, { text: 'Push', status: 'pending' }] }
}

test('each tool goes to the right worker, with short and full words', async () => {
  expect(label('Read', { file_path: '/proj/src/auth.ts' }, '/proj')).toEqual({ who: 'archivist', short: 'auth.ts', full: 'Read src/auth.ts' })
  expect(label('Edit', { file_path: '/Users/me/x/a.ts' }).full).toBe('Edit ~/x/a.ts')
  expect(label('Bash', { command: 'npm   test --watch' })).toEqual({ who: 'it', short: 'npm test', full: '$ npm test --watch' })
  expect(label('WebSearch', { query: 'oauth expiry' }).who).toBe('researcher')
  expect(label('mcp__claude-in-chrome__navigate', {})).toEqual({ who: 'courier', short: 'chrome', full: 'chrome: navigate' })
  expect(label('SomeNewTool', {}).who).toBe('courier')
  expect(label('TodoWrite', {})).toEqual({ who: 'planner', short: 'to-dos', full: 'Update the to-do list' })
  expect(label('ToolSearch', { query: 'select:Read' })).toEqual({ who: 'librarian', short: 'tools', full: 'Look up tools: Read' })
  expect(label('AskUserQuestion', {}).who).toBe('manager')
  // Work that used to be the Manager's alone.
  expect(label('SendMessage', { to: 'tester' })).toEqual({ who: 'courier', short: 'to tester', full: 'Note to tester' })
  expect(label('ListAgents', {}).who).toBe('courier')
  expect(label('EnterWorktree', { name: 'fix' })).toEqual({ who: 'it', short: 'worktree', full: 'Set up a worktree: fix' })
  expect(label('Agent', { description: 'find login' })).toEqual({ who: 'planner', short: 'new agent', full: 'Brief a new agent: find login', brief: true })
})

test('briefing a new agent keeps the Planner busy a moment, not for the whole agent run', async () => {
  let o = startJob(startTurn(EMPTY, 0), { id: 'a', role: 'planner', short: 'new agent', full: 'Brief a new agent', startedAt: 0, brief: true })
  expect(view(o, BRIEF_MS - 1).workers.planner).toMatchObject({ state: 'work', note: 'brief' })
  // Three briefed at once (agents started in parallel): the bubble says so in full.
  const three = ['x', 'y'].reduce((p, id) => startJob(p, { id, role: 'planner', short: 'new agent', full: 'Brief a new agent', startedAt: 0, brief: true }), o)
  expect(view(three, 1).workers.planner?.short).toBe('agents x3')
  expect(view(o, BRIEF_MS + 1).workers.planner).toMatchObject({ state: 'linger', since: BRIEF_MS })
  // The agent returns much later: no second finish (nothing to report again).
  o = endJob(o, 'a', 'planner', { short: 'new agent', full: 'Brief a new agent', err: false, denied: false, endedAt: 60_000 })
  expect(view(o, 60_001).workers.planner).toBeUndefined()
  // A failed one still shows.
  const failed = endJob(startJob(o, { id: 'b', role: 'planner', short: 'new agent', full: 'Brief', startedAt: 61_000, brief: true }), 'b', 'planner', { short: 'new agent', full: 'Brief', err: true, denied: false, endedAt: 70_000 })
  expect(view(failed, 70_001).workers.planner?.state).toBe('error')
})

test('secrets in a command are hidden', async () => {
  expect(mask('API_KEY=abc123 curl -H "Authorization: Bearer abcdefghijkl" https://u:p@x.io')).toBe('API_KEY=… curl -H "Authorization: Bearer …" https://…@x.io')
  expect(mask('gh auth login --with-token ghp_abcdefghijklmnop1234')).not.toContain('ghp_')
})

test('a worker with nothing left stays at their station a moment, then is on a break', async () => {
  let o = startTurn(EMPTY, 0)
  o = startJob(o, { id: 't1', role: 'archivist', short: 'auth.ts', full: 'Read src/auth.ts', startedAt: 0 })
  expect(view(o, 10).workers.archivist?.state).toBe('work')
  o = endJob(o, 't1', 'archivist', { short: 'auth.ts', full: 'Read src/auth.ts', err: false, denied: false, endedAt: 100 })
  expect(view(o, 200).workers.archivist?.state).toBe('linger')
  expect(view(o, 100 + LINGER_MS + 1).workers.archivist).toBeUndefined()
  const ended = endTurn(o, 'answer', false, 134_000, 300)
  expect(view(ended, 400).line).toBe('Done in 2m 14s')
  expect(view(ended, 300 + DONE_MS + 1).mood).toBe('idle')
})

test('a fast think / tool loop never flashes a bubble; moods that need you show at once', async () => {
  const calm = new Calm()
  let shown = calm.step('think', 0)
  let changedAt = 0
  // 0.1 s of thinking between 0.1 s tool calls, for 6 s: whatever shows, stays at least CALM_HOLD.
  for (let t = 125; t < 6000; t += 125) {
    const now = calm.step(Math.floor(t / 100) % 2 ? 'work' : 'think', t)
    if (now !== shown) {
      expect(t - changedAt).toBeGreaterThanOrEqual(CALM_HOLD)
      shown = now
      changedAt = t
    }
  }
  // A long stretch of one mood takes over, no sooner than CALM_HOLD after the last change.
  const c2 = new Calm()
  c2.step('think', 0)
  expect(c2.step('write', 125)).toBe('think')
  let t = 125
  while (c2.step('write', t) === 'think') t += 125
  expect(t).toBeGreaterThanOrEqual(CALM_HOLD)
  expect(c2.step('permission', t + 125)).toBe('permission')
  expect(new Calm().peek('think', 0)).toBe('think')
})

test('the same job three times at once is one worker with x3, not three people', async () => {
  let o = startTurn(EMPTY, 0)
  for (const id of ['a', 'b', 'c']) o = startJob(o, { id, role: 'it', short: 'npm test', full: '$ npm test ' + id, startedAt: 0 })
  const v = view(o, 1)
  expect(v.workers.it?.short).toBe('npm t.. x3')
  const sim = new BigSim()
  sim.sync(v)
  expect([...sim.actors.keys()].filter(k => k === 'it').length).toBe(1)
  expect(lines(v).map(l => l.what)).toContain('3 at once')
})

test('Esc freezes everyone for a moment, then the Manager is on a break', async () => {
  const o = endTurn(startTurn(EMPTY, 0), 'aborted', true, 1000, 500)
  expect(view(o, 600).frozen).toBe(true)
  expect(view(o, 500 + STOP_MS + 1).frozen).toBe(false)
  expect(view(o, 500 + STOP_MS + 1).mood).toBe('idle')
})

/** Runs the office `n` ticks (8 a second) from `now`. */
function run(sim: BigSim, o: Office, now: number, n: number): View {
  let v = view(o, now)
  for (let i = 0; i < n; i++) {
    v = view(o, now + i * 125)
    sim.sync(v)
    sim.step(v)
  }
  return v
}

test('staff are in all day, take breaks, hurry to a job, and go home at night', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 1)
  // Placed at once after a reload: everyone at their own station.
  for (const r of ['archivist', 'typist', 'it', 'courier', 'researcher', 'planner', 'librarian']) expect(sim.actors.has(r)).toBe(true)
  run(sim, day, 2, 400)
  expect(sim.breakLine(view(day, 50_000))?.who).toBe('Break')
  // A job: the Archivist goes to the cabinets.
  const busy = startJob(startTurn(day, 50_000), { id: 'r', role: 'archivist', short: 'a.ts', full: 'Read a.ts', startedAt: 50_000 })
  run(sim, busy, 50_000, 40)
  expect(sim.here('archivist', 'archivist')).toBe(true)
  // Night: everyone walks out of the door; the Manager stays.
  const night = { ...day, lastActivity: 1, moodAt: 1 }
  run(sim, night, NIGHT_MS + 10, 200)
  expect([...sim.actors.keys()]).toEqual(['manager'])
})

const BREAK_SPOTS = ['coffee', 'chatA', 'chatB', 'chatC', 'chatD', 'plant', 'visitCourier', 'visitTypist']
const STAFF = ['archivist', 'typist', 'it', 'courier', 'researcher', 'planner', 'librarian'] as const

test('while Claude works the break is over: everyone at their own desk, doing their own things', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 400)
  const work = startTurn(day, 50_000)
  run(sim, work, 50_000, 80)
  for (const r of STAFF) expect(sim.actors.get(r)!.dest).toBe(r === 'researcher' ? 'desk0' : r === 'planner' ? 'desk1' : r === 'librarian' ? 'desk2' : r)
  expect(sim.breakLine(view(work, 60_000))?.who).toBe('Desks')
  for (let i = 0; i < 400; i++) {
    run(sim, work, 60_000 + i * 125, 1)
    for (const r of STAFF) expect(BREAK_SPOTS).not.toContain(sim.actors.get(r)!.dest)
  }
})

test('Claude writing the reply: the Manager dictates, the Typist types it, then reports it once', async () => {
  const o = setMood(startTurn({ ...EMPTY, lastActivity: 1 }, 1), 'write', 1)
  expect(view(o, 2).workers.typist).toMatchObject({ state: 'work', short: 'reply', note: 'reply' })
  expect(lines(view(o, 2)).map(l => l.what)).toContain('Typing the reply')
  const sim = new BigSim()
  run(sim, o, 2, 40)
  const after = setMood(o, 'think', 5_000)
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
  let o = startJob(startTurn({ ...EMPTY, lastActivity: 1 }, 1), read)
  run(sim, o, 1_000, 8)
  o = endJob(o, 'r', 'archivist', { short: 'a.ts', full: 'Read a.ts', err: false, denied: false, endedAt: 2_000 })
  // Another job within a second: straight to it, no report.
  const next = startJob(o, { ...read, id: 'r2', startedAt: 2_500 })
  run(sim, next, 2_000, 8)
  expect(sim.life.activity('archivist')).toBe(null)
  const done = endJob(next, 'r2', 'archivist', { short: 'a.ts', full: 'Read a.ts', err: false, denied: false, endedAt: 3_000 })
  run(sim, done, 3_000, 4 + REPORT_AFTER / 125)
  expect(sim.life.activity('archivist')).toBe('report')
  expect(sim.actors.get('archivist')!.dest).toBe('rep0')
  run(sim, done, 4_500, 8)
  expect(sim.here('archivist', 'rep0')).toBe(true)
  expect(sim.life.icon(sim, view(done, 5_500), 'archivist')).toBe('check')
  run(sim, done, 5_500, 60)
  expect(sim.actors.get('archivist')!.dest).toBe('archivist')
})

test('the Manager away from the desk: the report is called in from where the worker is', async () => {
  const sim = new BigSim()
  let o = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  // A slow job for the Courier: the Manager goes over to look.
  o = startJob(o, { id: 'w', role: 'courier', short: 'chrome', full: 'chrome: navigate', startedAt: 1 })
  run(sim, o, 2, 60)
  expect(sim.here('manager', 'supCourier')).toBe(true)
  o = startJob(o, { id: 'r', role: 'archivist', short: 'a.ts', full: 'Read a.ts', startedAt: 7_500 })
  run(sim, o, 7_500, 4)
  const done = endJob(o, 'r', 'archivist', { short: 'a.ts', full: 'Read a.ts', err: false, denied: false, endedAt: 8_000 })
  run(sim, done, 8_000, 2 + REPORT_AFTER / 125)
  expect(sim.life.activity('archivist')).toBe('report')
  expect(sim.actors.get('archivist')!.dest).toBe('archivist')
})

test('plan mode: the Manager calls everyone free to the board', async () => {
  const sim = new BigSim()
  const o = { ...startTurn(EMPTY, 1), plan: true }
  run(sim, o, 2, 200)
  expect(sim.here('manager', 'board')).toBe(true)
  expect(sim.here('typist', 'meet3')).toBe(true)
  expect(sim.breakLine(view(o, 30_000))).toEqual({ who: 'Meeting', what: 'Everyone at the board' })
})

test('between turns the Manager is on a break; at night the Manager naps at the desk', async () => {
  const sim = new BigSim()
  const day = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  run(sim, day, 2, 600)
  expect(sim.breakLine(view(day, 80_000))?.what).toContain('Manager')
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
  const spots = ['researcher', 'planner', 'librarian'].map(r => sim.actors.get(r)!.dest)
  expect(spots.some(s => s.startsWith('desk'))).toBe(false)
  expect(new Set(spots).size).toBe(3)
})

test('walks follow the hallways, never through a desk', async () => {
  // Staff (who never go to the Manager's chair) and the Manager (who also walks behind their own desk).
  for (const boss of [false, true])
    for (const to of Object.keys(SPOTS).filter(k => boss || k !== 'chair'))
      for (const from of boss ? [SPOTS.chair!, SPOTS.board!] : [SPOTS.door!, SPOTS.desk2!, SPOTS.typist!]) {
        const r = routeTo([from.x, from.feet], to, boss)
        r.slice(1).forEach((p, i) => expect(p[0] === r[i]![0] || p[1] === r[i]![1]).toBe(true))
      }
})

test('more agents than desks wait in line; agents borrow staff desks; a waiting teammate gives its desk up', async () => {
  const sim = new BigSim()
  let o = startTurn(EMPTY, 1)
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) o = sec(o, id, 1)
  sim.sync(view(o, 2))
  expect(sim.seated()).toEqual(['d', 'c', 'b', 'a'])
  expect(sim.queue).toBe(2)
  // The line at the door is the waiting agents themselves, first come first served.
  expect(sim.actors.get('sec:e')?.dest).toBe('wait0')
  expect(sim.actors.get('sec:f')?.dest).toBe('wait1')
  expect(sim.borrowed('researcher')).toBe(true)

  const waiting = { ...o, secs: o.secs.map(s => (s.id === 'b' ? { ...s, status: 'idle' as const } : s)) }
  run(sim, waiting, 2, 60)
  expect(sim.seated()).toEqual(['d', 'c', 'e', 'a'])
  expect(sim.queue).toBe(2)
  // e walked from the line to the desk; b walked out and waits behind the working f.
  expect(sim.here('sec:e', 'desk2')).toBe(true)
  expect(sim.actors.get('sec:f')?.dest).toBe('wait0')
  expect(sim.actors.get('sec:b')?.dest).toBe('wait1')
})

test('no two agents in the office look alike, however many come and go', async () => {
  const sim = new BigSim()
  let o = startTurn(EMPTY, 1)
  let n = 0
  for (; n < 9; n++) o = sec(o, 'a' + n, 1)
  for (let t = 0; t < 600; t++) {
    const now = 2 + t * 125
    // Now and then an agent finishes and goes (the oldest, or one in line), and a new one is sent.
    if (t % 13 === 12) o = sec({ ...o, secs: o.secs.filter((_, i) => i !== (t % 3 ? 0 : o.secs.length - 1)) }, 'a' + n++, now)
    if (t % 29 === 28) o = { ...o, secs: o.secs.map((s, i) => (i === 1 ? { ...s, status: s.status === 'run' ? ('idle' as const) : ('run' as const) } : s)) }
    const v = view(o, now)
    sim.sync(v)
    sim.step(v)
    const looks = [...sim.actors.keys()].filter(id => id.startsWith('sec:')).map(id => sim.lookOf(id.slice(4)))
    expect(looks.includes(undefined)).toBe(false)
    expect(new Set(looks).size).toBe(looks.length)
  }
  expect(LOOK.sec.length).toBe(DOT.sec.length)
})

test('the pane shows what a running call does, on every surface', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('tool.call', async () => {
    await gate
    return { result: {} }
  })

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const call = $.tool.call({ tool: 'Read', file_path: '/proj/src/auth.ts' })
  await wait(50)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Read src\/auth\.ts/ }))?.text).toBe('Read src/auth.ts')
    expect((await ui.find({ type: 'Text', text: /Archivist/ }))?.text).toContain('Archivist')
    await ui.unmount()
  }
  // Above the prompt in the classic renderer: the half-size office, the list beside it.
  const inline = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement: 'inline', bodyColumns: 165, scroll: { offset: 0, bodyRows: 16 } } })
  expect((await inline.find({ type: 'Text', text: /Archivist/ }))?.text).toContain('Archivist')
  // The camera: the full office at its own size through a 64 x 16 window, still a Raster.
  const raster = (await inline.find({ type: 'Raster' })) as { props: { columns: number; rows: number } } | undefined
  expect([raster?.props.columns, raster?.props.rows]).toEqual([CAM_COLS, CAM_ROWS])
  await inline.unmount()
  release()
  await call
})

test('a value an older version stored is declined', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('state.get', () => ({ value: { value: { mood: 42 }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /On a break/ }))?.text).toContain('On a break')
  await ui.unmount()
})

test('the designed office (64 x 31) is used when it fits: solid cells are spaces, words are ASCII', async () => {
  const v = view(busy(), 2)
  const sim = new BigSim()
  sim.sync(v)
  const sc = renderBig(v, sim, 1, 2)
  const c = bigCells(sc)
  expect(c.columns).toBe(BIG_COLS)
  expect(c.rows).toBe(BIG_ROWS)
  const texts = new Set(sc.texts.map(t => t.row * BIG_COLS + t.x))
  c.grid.forEach((cell, i) => {
    if (texts.has(i)) expect(cell.ch >= 0x20 && cell.ch <= 0x7e).toBe(true)
    else if (cell.ch === 0x20) expect(cell.fg).toBe(cell.bg)
    else {
      expect(cell.ch === 0x2580 || cell.ch === 0x2584).toBe(true)
      expect(cell.fg).not.toBe(cell.bg)
    }
  })
})

test('the camera looks where things happen, glides there a row at a time, and shows the office as it is', async () => {
  const at = (o: Office) => view(o, 2)
  const working = startTurn(EMPTY, 1)
  expect(focusOf(at(startJob(working, { id: 'r', role: 'archivist', short: 'a', full: 'Read a', startedAt: 1 }))).top).toBe(0)
  expect(focusOf(at(sec(working, 'a', 1))).top).toBe(30)
  expect(focusOf(at(setMood(sec(working, 'a', 1), 'permission', 1, 'Needs your OK'))).top).toBe(14)
  expect(focusOf(at(EMPTY)).top).toBe(14)

  const cam = new Camera()
  cam.step(at(sec(working, 'a', 1)), 64, 32)
  expect(cam.top).toBe(30)
  const back = at(startJob(working, { id: 'r', role: 'archivist', short: 'a', full: 'Read a', startedAt: 1 }))
  cam.step(back, 64, 32)
  expect(cam.top).toBe(28)
  expect(cam.moving(back, 64, 32)).toBe(true)
  for (let i = 0; i < 20; i++) cam.step(back, 64, 32)
  expect(cam.top).toBe(0)
  expect(cam.moving(back, 64, 32)).toBe(false)

  // The window is a piece of the full office, pixel for pixel.
  const v = view(busy(), 2)
  const sim = new BigSim()
  sim.sync(v)
  const full = renderBig(v, sim, 1, 2)
  const c = new Camera()
  c.step(v, 40, 32)
  const shot = c.view(full, 40, 32)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) expect(shot.fb.p[y * 40 + x]).toBe(full.fb.p[(y + c.top) * 64 + x + c.left]!)
  expect(bigCells(shot).rows).toBe(16)
})

test('the list keeps its name column; long lines wrap under the words, whole lines fit the rows', async () => {
  const L = (who: string, what: string): Line => ({ dot: '#fff', who, what, tone: '' })
  const all = [
    L('Manager', 'Planning (plan mode)'),
    L('Archivist', 'Read src/components/settings/NotificationPreferencesPanel.tsx'),
    L('Break', 'Manager & Typist chatting · Archivist having a coffee · IT tech watering the plant · Courier on the phone · Researcher reading'),
  ]
  const rows = fitRows(all, 64, 10)
  expect(rows.map(r => r.who)).toEqual(['Manager', 'Archivist', '', 'Break', '', ''])
  // A path breaks after a "/", never inside a name; no row is wider than the room beside the names.
  expect(rows[1]!.what).toBe('Read src/components/settings/')
  expect(rows[2]!.what).toBe('NotificationPreferencesPanel.tsx')
  for (const r of rows) expect(textWidth(r.what)).toBeLessThanOrEqual(64 - 2 - WHO_W)
  // Too few rows: only whole lines, and the last row says how many were left out.
  expect(fitRows(all, 64, 4).map(r => r.what)).toEqual(['Planning (plan mode)', 'Read src/components/settings/', 'NotificationPreferencesPanel.tsx', '+1 more'])
  // Very long: three rows at most, the last ending with an ellipsis.
  const long = wrapLine(L('Desks', 'word '.repeat(80)), 40)
  expect(long.length).toBe(3)
  expect(long[2]!.what.endsWith('…')).toBe(true)
})

test('the task tools and accents: the board gets the tasks, a name keeps its letters', async () => {
  let t = addTask(addTask(null, '1', 'Find the bug'), '2', 'Fix it')
  t = patchTask(t, '1', { status: 'completed' })!
  expect(t.map(x => x.status)).toEqual(['completed', 'pending'])
  expect(patchTask(t, '2', { status: 'deleted' })!.map(x => x.text)).toEqual(['Find the bug'])
  expect(patchTask(t, '9', { status: 'completed' })).toBe(t)
  expect(tasksFrom({ tasks: [{ id: '1', subject: 'A', status: 'in_progress', blockedBy: [] }] })).toEqual([{ id: '1', text: 'A', status: 'in_progress' }])
  expect(ascii('báo-cáo.md', 20)).toBe('bao-cao.md')
})

test('a created and finished task shows on the board through the hooks', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: 'Find the bug' } } }
    return { result: { success: true, taskId: '7', updatedFields: ['status'] } }
  })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Find the bug', description: 'x' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^1\/1/ }))?.text).toBe('1/1')
  await ui.unmount()
})

/** A turn whose to-do list has its first `k` lines done. */
const todoTurn = (k: number): Office => ({
  ...startTurn({ ...EMPTY, lastActivity: 1 }, 1),
  mood: 'work',
  todos: ['Find the bug', 'Fix it', 'Run the tests'].map((text, i) => ({ text, status: i < k ? 'completed' : i === k ? 'in_progress' : 'pending' })),
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
  expect(sim.breakLine(view(clean, 90_000))?.who).toBe('Out')
  // Done: everyone back, the waiting teammate gets a desk again; the Janitor is gone.
  run(sim, o, 90_000, 400)
  expect([...sim.actors.keys()].sort()).toEqual(['archivist', 'courier', 'it', 'librarian', 'manager', 'planner', 'researcher', 'sec:a', 'sec:b', 'typist'])
  expect(sim.here('manager', 'chair')).toBe(true)
})

test('the IT girl at work: her bubble stays clear of the to-do words on the board', async () => {
  const o = startJob(todoTurn(1), { id: 'b', role: 'it', short: 'npm test', full: '$ npm test', startedAt: 1 })
  const sim = new BigSim()
  run(sim, o, 2, 40)
  const sc = renderBig(view(o, 5_000), sim, 1, 2)
  expect(sc.texts.some(t => t.ch === 'n' && t.row === 2 && t.x >= 48)).toBe(true)
  // The board's first two lines are whole: nothing covers them.
  for (const r of [2, 3]) expect(sc.texts.filter(t => t.row === r && t.x >= 32 && t.x <= 45).length).toBe(14)
})
