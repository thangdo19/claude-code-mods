// What several test files share: a small office, the pane's props, running the office for some ticks.

import { BigSim } from '../hooks/walk'
import { addSec, EMPTY, setMood, startJob, startTurn, view, type View } from '../hooks/office'
import type { Office } from '../types'

export const sec = (o: Office, id: string, now: number, status: 'run' | 'done' | 'idle' = 'run') =>
  addSec(o, { id, name: 'Explore', task: 'find ' + id, short: 'grep ' + id, full: 'Grep ' + id, status, startedAt: now, endedAt: status === 'run' ? null : now, teammate: status === 'idle' })

/** A busy office: workers, a background command, six agents (more than the desks), plan items. */
export function busy(): Office {
  let o = setMood(startTurn(EMPTY, 1), 'permission', 1, 'Needs your OK: git push')
  o = startJob(o, { id: 'r', role: 'archivist', short: 'auth.ts', full: 'Read src/auth.ts', startedAt: 1 })
  o = startJob(o, { id: 'e', role: 'typist', short: 'auth.ts', full: 'Edit src/auth.ts', startedAt: 1 })
  o = startJob(o, { id: 'b1', role: 'it', short: 'npm test', full: '$ npm test', startedAt: 1 })
  o = startJob(o, { id: 'b2', role: 'it', short: 'npm test', full: '$ npm run lint', startedAt: 1 })
  o = startJob(o, { id: 'w', role: 'courier', short: 'oauth…', full: 'Web search: oauth', startedAt: 1 })
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) o = sec(o, id, 1)
  return { ...o, bg: ['npm run dev'], todos: [{ text: 'Find', status: 'completed' }, { text: 'Fix', status: 'in_progress' }, { text: 'Push', status: 'pending' }] }
}

/** Runs the office `n` ticks (8 a second) from `now`. */
export function run(sim: BigSim, o: Office, now: number, n: number): View {
  let v = view(o, now)
  for (let i = 0; i < n; i++) {
    v = view(o, now + i * 125)
    sim.sync(v)
    sim.step(v)
  }
  return v
}

/** A turn whose to-do list has its first `k` lines done. */
export const todoTurn = (k: number): Office => ({
  ...startTurn({ ...EMPTY, lastActivity: 1 }, 1),
  mood: 'work',
  todos: ['Find the bug', 'Fix it', 'Run the tests'].map((text, i) => ({ text, status: i < k ? 'completed' : i === k ? 'in_progress' : 'pending' })),
})
