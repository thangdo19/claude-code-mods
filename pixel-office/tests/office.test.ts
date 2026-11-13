import { expect, test } from 'claude-code/testing'

import { BigSim } from '../hooks/walk'
import {
  addTask, afterCall, ascii, bottleLeft, BRIEF_MS, DONE_MS, EMPTY, endJob, endTurn, ERROR_MS, fitRows, LINGER_MS, lines, MAX_LAG, MIN_SHOW, PARTY_MS, PARTY_TOTAL_MS, patchSec, patchTask,
  setMood, startJob, startTurn, STOP_MS, tasksFrom, textWidth, view, WHO_W, wrapLine, type Line,
} from '../hooks/office'

import { sec } from './helpers'

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
  const ended = endTurn(o, 'answer', false, 34_000, 300)
  expect(view(ended, 400).line).toBe('Done in 34s')
  expect(view(ended, 300 + DONE_MS + 1).mood).toBe('idle')
})

test('a failed job is never "just done": red for a while, then nothing (no ✓ to report)', async () => {
  const job = (o: ReturnType<typeof startTurn>, id: string, at: number, end: number, bad: '' | 'err' | 'no' = '') =>
    endJob(startJob(o, { id, role: 'it', short: id, full: '$ ' + id, startedAt: at }), id, 'it', { short: id, full: '$ ' + id, err: bad === 'err', denied: bad === 'no', endedAt: end })
  for (const bad of ['err', 'no'] as const) {
    const o = job(startTurn(EMPTY, 0), 'npm test', 0, 50, bad)
    expect(view(o, 60).workers.it?.state).toBe('error')
    expect(view(o, 50 + ERROR_MS - 1).workers.it?.state).toBe('error')
    // (It used to turn into "✓ $ npm test" for the last second of LINGER_MS, and was reported.)
    for (let t = 50 + ERROR_MS; t < 50 + ERROR_MS + LINGER_MS; t += 250) expect(view(o, t).workers.it).toBeUndefined()
  }
  // A burst, the last one failing: the failure shows at once and ends the show of what finished before it.
  let b = startTurn(EMPTY, 0)
  b = job(job(job(b, 'a', 0, 5), 'b', 10, 15), 'c', 20, 25, 'err')
  expect(view(b, 100).workers.it?.state).toBe('error')
  for (let t = 25 + ERROR_MS; t < 25 + ERROR_MS + 2 * LINGER_MS; t += 250) expect(view(b, t).workers.it).toBeUndefined()
  // A job after the failure shows, and is done, as ever.
  b = job(b, 'd', 1000, 1100)
  expect(view(b, 1200).workers.it).toMatchObject({ state: 'work', short: 'd' })
  expect(view(b, 1000 + MIN_SHOW + 1).workers.it).toMatchObject({ state: 'linger', full: '✓ $ d' })
})

test('the party: a long turn, or enough work over several turns; it lasts longer; cut off, it comes back', async () => {
  const turn = (o: ReturnType<typeof startTurn>, at: number, ms: number, reason = 'answer') => endTurn(startTurn(o, at), reason, reason === 'aborted', ms, at + ms)
  // One turn of 2 minutes: a party, for PARTY_MS (a short turn: none, DONE_MS).
  const long = turn(EMPTY, 0, 120_000)
  expect(view(long, 120_000 + 1000)).toMatchObject({ party: true, mood: 'done', line: 'Done in 2m 0s' })
  expect(view(long, 120_000 + PARTY_MS - 1).party).toBe(true)
  expect(view(long, 120_000 + PARTY_MS + 1)).toMatchObject({ party: false, mood: 'idle' })
  const short = turn(EMPTY, 0, 100_000)
  expect(view(short, 101_000)).toMatchObject({ party: false, mood: 'done' })
  expect(view(short, 100_000 + DONE_MS + 1).mood).toBe('idle')
  // Work adds up over turns (a stopped and a failed one count too, with no party of their own).
  let o = turn(short, 200_000, 90_000, 'aborted')
  expect(view(o, 290_500).party).toBe(false)
  o = turn(o, 300_000, 90_000, 'error')
  expect(o.workMs).toBe(280_000)
  expect(view(o, 390_500).party).toBe(false)
  o = turn(o, 400_000, 20_000)
  expect(view(o, 421_000).party).toBe(true)
  // Seen: the count starts over.
  o = turn(o, 500_000, 20_000)
  expect([o.workMs, view(o, 521_000).party]).toEqual([20_000, false])
  // A party the next turn cuts off within a few seconds is owed: the next done turn has it.
  let cut = startTurn(long, 121_000)
  expect(cut.workMs).toBe(PARTY_TOTAL_MS)
  expect(view(cut, 122_000).party).toBe(false)
  cut = endTurn(cut, 'answer', false, 5_000, 126_000)
  expect(view(cut, 127_000).party).toBe(true)
  // A refused turn is no "Done!": on hold, no party.
  const refused = turn(EMPTY, 0, 130_000, 'refusal')
  expect(view(refused, 131_000)).toMatchObject({ mood: 'hold', line: 'On hold · refused', party: false })
})

test('dialogs end when they are answered: an agent\'s "Your OK?" with its call, a notice\'s "Question?" with the next call', async () => {
  const o = startTurn(EMPTY, 0)
  const ok = setMood(o, 'permission', 10, 'Needs your OK: Explore wants rm x')
  // Asked for agent a1's call: another agent's or the Manager's own call ending leaves it; a1's ends it.
  expect(afterCall(ok, 20, 'a2', 'a1', false).mood).toBe('permission')
  expect(afterCall(ok, 20, undefined, 'a1', false).mood).toBe('permission')
  expect(afterCall(ok, 20, 'a1', 'a1', false)).toMatchObject({ mood: 'work', moodText: null })
  // Asked for the Manager's own call.
  expect(afterCall(ok, 20, undefined, undefined, false).mood).toBe('work')
  expect(afterCall(ok, 20, 'a1', undefined, false).mood).toBe('permission')
  // "Question?": a notice's goes with the Manager's next call; AskUserQuestion's own stays while it is open.
  const ask = setMood(o, 'ask', 10, 'Needs your input: pick a repo')
  expect(afterCall(ask, 20, undefined, undefined, false).mood).toBe('work')
  expect(afterCall(ask, 20, undefined, undefined, true).mood).toBe('ask')
  expect(afterCall(ask, 20, 'a1', undefined, false).mood).toBe('ask')
  expect(afterCall(o, 20, undefined, undefined, false)).toBe(o)
})

test('agents: a finished one woken again gets a desk back; with no picture the list names the two agent desks', async () => {
  let o = sec(sec(sec(startTurn(EMPTY, 0), 'a', 0), 'b', 0), 'c', 0)
  o = patchSec(o, 'a', { status: 'done', endedAt: 1000 })
  // The next turn keeps its record (hidden once it has cheered), so a later wake-up finds it.
  o = startTurn(endTurn(o, 'answer', false, 2000, 2000), 60_000)
  expect(view(o, 60_001).secs.map(s => s.id)).toEqual(['b', 'c'])
  o = patchSec(o, 'a', { status: 'run', endedAt: null })
  expect(view(o, 60_002).secs.map(s => s.id).sort()).toEqual(['a', 'b', 'c'])
  // No picture: the first two sit at desk 4, then desk 2 (the Planner's); the third waits.
  const ls = lines(view(o, 60_002)).filter(l => /^Desk|^In line/.test(l.who))
  expect(ls.map(l => l.who)).toEqual(['Desk 2', 'Desk 4', 'In line'])
  expect(ls[1]!.what).toContain('Explore')
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

test('round 11: the bottle has a row of water less for every quarter of the memory used; a page for each edit that worked', async () => {
  expect([0, 12, 13, 37, 38, 62, 63, 87, 88, 100].map(bottleLeft)).toEqual([4, 4, 3, 3, 2, 2, 1, 1, 0, 0])
  // The memory's fill is unknown until measured: a full bottle.
  expect(view(EMPTY, 0).context).toBe(0)
  expect(view({ ...EMPTY, context: 97 }, 0).context).toBe(97)
  // The Typist's edits this turn: failed and refused ones leave no page, other workers' jobs neither.
  const ends = { short: 'a.ts', full: 'Edit a.ts', err: false, denied: false, endedAt: 2 }
  let o = startTurn(EMPTY, 0)
  o = endJob(startJob(o, { id: 'e1', role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 1 }), 'e1', 'typist', ends)
  o = endJob(startJob(o, { id: 'e2', role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 1 }), 'e2', 'typist', { ...ends, err: true })
  o = endJob(startJob(o, { id: 'e3', role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 1 }), 'e3', 'typist', { ...ends, denied: true })
  o = endJob(startJob(o, { id: 'r', role: 'archivist', short: 'a.ts', full: 'Read a.ts', startedAt: 1 }), 'r', 'archivist', ends)
  o = endJob(startJob(o, { id: 'e4', role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 1 }), 'e4', 'typist', ends)
  expect(view(o, 3).edits).toBe(2)
  // The pages stay after the turn, until the next one starts.
  o = endTurn(o, 'answer', false, 1000, 4)
  expect(view(o, 5).edits).toBe(2)
  expect(view(startTurn(o, 6), 7).edits).toBe(0)
})
