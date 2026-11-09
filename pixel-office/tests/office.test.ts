import { expect, test } from 'claude-code/testing'

import { BigSim } from '../hooks/walk'
import {
  addTask, ascii, BRIEF_MS, DONE_MS, EMPTY, endJob, endTurn, fitRows, LINGER_MS, lines, MAX_LAG, MIN_SHOW, patchTask, startJob, startTurn, STOP_MS, tasksFrom, textWidth, view, WHO_W, wrapLine, type Line,
} from '../hooks/office'

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

test('a job shows at a human pace, a burst one after another; then the worker stays a moment, then is free', async () => {
  let o = startTurn(EMPTY, 0)
  o = startJob(o, { id: 't1', role: 'archivist', short: 'auth.ts', full: 'Read src/auth.ts', startedAt: 0 })
  expect(view(o, 10).workers.archivist?.state).toBe('work')
  o = endJob(o, 't1', 'archivist', { short: 'auth.ts', full: 'Read src/auth.ts', err: false, denied: false, endedAt: 100 })
  // A tenth of a second of work shows MIN_SHOW.
  expect(view(o, 200).workers.archivist?.state).toBe('work')
  expect(view(o, MIN_SHOW + 1).workers.archivist).toMatchObject({ state: 'linger', since: MIN_SHOW })
  expect(view(o, MIN_SHOW + LINGER_MS + 1).workers.archivist).toBeUndefined()
  // Four quick reads: one after another, never more than MAX_LAG behind (then two at once).
  let b = startTurn(EMPTY, 0)
  ;['a.ts', 'b.ts', 'c.ts', 'd.ts'].forEach((f, i) => {
    const j = { id: f, role: 'archivist' as const, short: f, full: 'Read ' + f, startedAt: i * 10 }
    b = endJob(startJob(b, j), f, 'archivist', { short: f, full: j.full, err: false, denied: false, endedAt: i * 10 + 5 })
  })
  expect(view(b, 100).workers.archivist?.short).toBe('a.ts')
  expect(view(b, MIN_SHOW + 100).workers.archivist?.short).toBe('b.ts')
  expect(view(b, 2 * MIN_SHOW + 100).workers.archivist?.short).toBe('c.ts')
  expect(view(b, MAX_LAG + 100).workers.archivist?.short).toBe('d.ts x2')
  // The turn ends: what was left ends with it.
  expect(view(endTurn(b, 'answer', false, 3_000, 3_000), 3_001).workers.archivist).toMatchObject({ state: 'linger', full: '✓ Read b.ts' })
  // A failure shows at once.
  const failed = endJob(startJob(startTurn(EMPTY, 0), { id: 'x', role: 'it', short: 'npm test', full: '$ npm test', startedAt: 0 }), 'x', 'it', { short: 'npm test', full: '$ npm test', err: true, denied: false, endedAt: 50 })
  expect(view(failed, 60).workers.it?.state).toBe('error')
  const ended = endTurn(o, 'answer', false, 134_000, 300)
  expect(view(ended, 400).line).toBe('Done in 2m 14s')
  expect(view(ended, 300 + DONE_MS + 1).mood).toBe('idle')
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

test('the list: everyone keeps a line; long lines wrap; short of rows it gives way step by step and names who is left out', async () => {
  const L = (who: string, what: string, more: Partial<Line> = {}): Line => ({ dot: '#fff', who, what, tone: '', ...more })
  const free = (name: string, job: string, what: string) => L(name + ' · ' + job, what, { tone: 'idle', rank: 5, free: name, name, group: 'on a break' })
  const all = [
    L('Claude · boss', 'Planning (plan mode)', { rank: 0, name: 'Claude' }),
    L('Susan · files', 'Read src/components/settings/NotificationPreferencesPanel.tsx', { rank: 2, name: 'Susan' }),
    free('Mary-Beth', 'edit', 'having a coffee'),
    free('Lauren', 'IT', 'chatting with John'),
    L('To-do', '1/3 · Fix it', { tone: 'idle', rank: 6 }),
  ]
  const rows = fitRows(all, 64, 10)
  expect(rows.map(r => r.who)).toEqual(['Claude · boss', 'Susan · files', '', 'Mary-Beth · edit', 'Lauren · IT', 'To-do'])
  // A path breaks after a "/", never inside a name; no row is wider than the room beside the names.
  expect(rows[1]!.what).toBe('Read src/components/settings/')
  expect(rows[2]!.what).toBe('NotificationPreferencesPanel.tsx')
  for (const r of rows) expect(textWidth(r.what)).toBeLessThanOrEqual(64 - 2 - WHO_W)
  const fit = (n: number) => fitRows(all, 64, n).map(r => r.who + ': ' + r.what)
  // 1. Short of rows: a long line gets one row, cut with "…"; everyone still has their own line.
  expect(fit(5)).toEqual(['Claude · boss: Planning (plan mode)', 'Susan · files: Read src/components/settings/ …', 'Mary-Beth · edit: having a coffee', 'Lauren · IT: chatting with John', 'To-do: 1/3 · Fix it'])
  // 2. Fewer: the free share one line that still names them.
  expect(fit(4)[2]).toBe('Others: Mary-Beth, Lauren · on a break')
  // 3. Fewer still: the least important go and the last row names them (by name); the Manager always stays.
  expect(fit(3)).toEqual(['Claude · boss: Planning (plan mode)', 'Susan · files: Read src/components/settings/ …', '+3 more: Mary-Beth, Lauren, To-do'])
  expect(fit(1)).toEqual(['Claude · boss: Planning (plan mode)'])
  expect(fitRows([all[0]!, all[1]!, all[4]!, L('John · mail', 'Bash: git status', { rank: 2, name: 'John' })], 64, 3).at(-1)?.what).toBe('To-do, John')
  // A worker's several jobs share one line before anyone else gives way.
  const many = [all[0]!, L('Lauren · IT', '2 at once', { rank: 2, merged: '2 at once: $ npm test · $ npm run lint' }), L('', '└ $ npm test', { rank: 2, sub: true }), L('', '└ $ npm run lint', { rank: 2, sub: true }), free('Mary-Beth', 'edit', 'proofreading'), free('John', 'mail', 'sorting the mail')]
  expect(fitRows(many, 64, 4).map(r => r.who)).toEqual(['Claude · boss', 'Lauren · IT', 'Mary-Beth · edit', 'John · mail'])
  // Very long: three rows at most, the last ending with an ellipsis.
  const long = wrapLine(L('Desk 1', 'word '.repeat(80)), 40)
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
