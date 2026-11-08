import { expect, mock, test } from 'claude-code/testing'

import { bigCells } from '../hooks/big-cells'
import { BIG_COLS, BIG_ROWS, bigWantOf, renderBig } from '../hooks/big-scene'
import { BigSim } from '../hooks/big-walk'
import { describe as label, mask } from '../hooks/labels'
import { Camera, CAM_COLS, CAM_ROWS, focusOf } from '../hooks/camera'
import { addSec, COFFEE_MS, DONE_MS, EMPTY, endJob, endTurn, lines, setMood, startJob, startTurn, STOP_MS, view } from '../hooks/office'
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
  expect(label('WebSearch', { query: 'oauth expiry' }).who).toBe('courier')
  expect(label('mcp__claude-in-chrome__navigate', {})).toEqual({ who: 'courier', short: 'chrome', full: 'chrome: navigate' })
  expect(label('SomeNewTool', {}).who).toBe('courier')
  expect(label('TodoWrite', {}).who).toBe('manager')
})

test('secrets in a command are hidden', async () => {
  expect(mask('API_KEY=abc123 curl -H "Authorization: Bearer abcdefghijkl" https://u:p@x.io')).toBe('API_KEY=… curl -H "Authorization: Bearer …" https://…@x.io')
  expect(mask('gh auth login --with-token ghp_abcdefghijklmnop1234')).not.toContain('ghp_')
})

test('a worker with nothing left drinks coffee, then leaves; the turn ending sends everyone out', async () => {
  let o = startTurn(EMPTY, 0)
  o = startJob(o, { id: 't1', role: 'archivist', short: 'auth.ts', full: 'Read src/auth.ts', startedAt: 0 })
  expect(view(o, 10).workers.archivist?.state).toBe('work')
  o = endJob(o, 't1', 'archivist', { short: 'auth.ts', full: 'Read src/auth.ts', err: false, denied: false, endedAt: 100 })
  expect(view(o, 200).workers.archivist?.state).toBe('coffee')
  expect(view(o, 100 + COFFEE_MS + 1).workers.archivist).toBeUndefined()
  const ended = endTurn(o, 'answer', false, 134_000, 300)
  expect(view(ended, 400).workers.archivist).toBeUndefined()
  expect(view(ended, 400).line).toBe('Done in 2m 14s')
  expect(view(ended, 300 + DONE_MS + 1).mood).toBe('idle')
})

test('the same job three times at once is one worker with x3, not three people', async () => {
  let o = startTurn(EMPTY, 0)
  for (const id of ['a', 'b', 'c']) o = startJob(o, { id, role: 'it', short: 'npm test', full: '$ npm test ' + id, startedAt: 0 })
  const v = view(o, 1)
  expect(v.workers.it?.short).toBe('npm t.. x3')
  expect(bigWantOf(v).staff).toEqual(['it'])
  expect(lines(v).map(l => l.what)).toContain('3 at once')
})

test('Esc freezes everyone for a moment, then the Manager naps', async () => {
  const o = endTurn(startTurn(EMPTY, 0), 'aborted', true, 1000, 500)
  expect(view(o, 600).frozen).toBe(true)
  expect(view(o, 500 + STOP_MS + 1).frozen).toBe(false)
  expect(view(o, 500 + STOP_MS + 1).mood).toBe('idle')
})

test('people walk in through the door, and are placed at once after a reload', async () => {
  const sim = new BigSim()
  sim.sync({ staff: [], secs: [], plan: false })
  sim.sync({ staff: ['typist'], secs: [], plan: false })
  const typist = sim.actors.get('typist')!
  expect(typist.t).toBe(0)
  expect(sim.doorOpen()).toBe(true)
  for (let i = 0; i < 40; i++) sim.step(false)
  expect(typist.t).toBe(typist.length)
  sim.sync({ staff: [], secs: [], plan: false })
  for (let i = 0; i < 40; i++) sim.step(false)
  expect(sim.actors.has('typist')).toBe(false)

  const fresh = new BigSim()
  fresh.sync({ staff: ['it'], secs: [], plan: false })
  const it = fresh.actors.get('it')!
  expect(it.t).toBe(it.length)
})

test('more agents than desks wait in line; a waiting teammate gives its desk up', async () => {
  const sim = new BigSim()
  const secs = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, working: true }))
  sim.sync({ staff: [], secs, plan: false })
  expect(sim.seated()).toEqual(['a', 'b', 'c', 'd'])
  expect(sim.queue).toBe(2)
  expect(sim.actors.has('wait0')).toBe(true)

  const waiting = secs.map(s => (s.id === 'b' ? { ...s, working: false } : s))
  sim.sync({ staff: [], secs: waiting, plan: false })
  for (let i = 0; i < 40; i++) sim.step(false)
  sim.sync({ staff: [], secs: waiting, plan: false })
  expect(sim.seated()).toEqual(['a', 'e', 'c', 'd'])
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
  expect((await ui.find({ type: 'Text', text: /Napping/ }))?.text).toContain('Napping')
  await ui.unmount()
})

test('the designed office (64 x 31) is used when it fits: solid cells are spaces, words are ASCII', async () => {
  const v = view(busy(), 2)
  const sim = new BigSim()
  sim.sync(bigWantOf(v))
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
  sim.sync(bigWantOf(v))
  const full = renderBig(v, sim, 1, 2)
  const c = new Camera()
  c.step(v, 40, 32)
  const shot = c.view(full, 40, 32)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) expect(shot.fb.p[y * 40 + x]).toBe(full.fb.p[(y + c.top) * 64 + x + c.left]!)
  expect(bigCells(shot).rows).toBe(16)
})
