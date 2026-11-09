import { expect, mock, test } from 'claude-code/testing'

import { CAM_COLS, CAM_ROWS } from '../hooks/camera'

// The test environment has timers; its type declarations name none.
const wait = (ms: number) => new Promise<void>(r => (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, ms))

const PANE = {
  plugin: 'pixel-office',
  component: 'Pane',
  requestId: 'office',
  props: { title: 'Office', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

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
    expect((await ui.find({ type: 'Text', text: /Susan/ }))?.text).toContain('Susan · files')
    await ui.unmount()
  }
  // Above the prompt in the classic renderer: the half-size office, the list beside it.
  const inline = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement: 'inline', bodyColumns: 165, scroll: { offset: 0, bodyRows: 16 } } })
  expect((await inline.find({ type: 'Text', text: /Susan/ }))?.text).toContain('Susan · files')
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
