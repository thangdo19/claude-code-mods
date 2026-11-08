import { expect, mock, test } from 'claude-code/testing'

import { bigCells } from '../hooks/big-cells'
import { BIG_COLS, BIG_ROWS, renderBig } from '../hooks/big-scene'
import { BigSim, routeTo, SPOTS } from '../hooks/big-walk'
import { Calm, CALM_HOLD } from '../hooks/calm'
import { describe as label, mask } from '../hooks/labels'
import { Camera, CAM_COLS, CAM_ROWS, focusOf } from '../hooks/camera'
import { addSec, DONE_MS, EMPTY, endJob, endTurn, LINGER_MS, lines, NIGHT_MS, setMood, startJob, startTurn, STOP_MS, view, type View } from '../hooks/office'
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

test('plan mode: the Manager calls everyone free to the board', async () => {
  const sim = new BigSim()
  const o = { ...startTurn(EMPTY, 1), plan: true }
  run(sim, o, 2, 200)
  expect(sim.here('manager', 'board')).toBe(true)
  expect(sim.here('typist', 'meet3')).toBe(true)
  expect(sim.breakLine(view(o, 30_000))?.who).toBe('Meeting')
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
  expect(sim.actors.has('wait0')).toBe(true)
  expect(sim.borrowed('researcher')).toBe(true)

  const waiting = { ...o, secs: o.secs.map(s => (s.id === 'b' ? { ...s, status: 'idle' as const } : s)) }
  run(sim, waiting, 2, 40)
  expect(sim.seated()).toEqual(['d', 'c', 'e', 'a'])
  expect(sim.queue).toBe(2)
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
