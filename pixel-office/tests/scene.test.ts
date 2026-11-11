import { expect, test } from 'claude-code/testing'

import { renderBig } from '../hooks/scene'
import { BigSim } from '../hooks/walk'
import { EMPTY, NIGHT_MS, startJob, startTurn, view } from '../hooks/office'

import { setClock } from '../hooks/world'

import { run, TEST_CLOCK, todoTurn } from './helpers'

test('the IT girl at work: her bubble stays clear of the to-do words on the board', async () => {
  const o = startJob(todoTurn(1), { id: 'b', role: 'it', short: 'npm test', full: '$ npm test', startedAt: 1 })
  const sim = new BigSim()
  run(sim, o, 2, 40)
  const sc = renderBig(view(o, 5_000), sim, 1, 2)
  expect(sc.texts.some(t => t.ch === 'n' && t.row === 2 && t.x >= 48)).toBe(true)
  // The board's first two lines are whole: nothing covers them.
  for (const r of [2, 3]) expect(sc.texts.filter(t => t.row === r && t.x >= 32 && t.x <= 45).length).toBe(14)
})

test('at night with everyone gone the lights are off: the room and its letters go dark, the rack lights still glow', async () => {
  const idle = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  const day = new BigSim()
  const lit = renderBig(run(day, idle, 2, 2), day, 4, 2)
  const sim = new BigSim()
  const v = run(sim, idle, NIGHT_MS + 10, 2)
  expect(sim.dark(v)).toBe(true)
  const sc = renderBig(v, sim, 4, 2)
  // The wall's corner and the MANAGER sign's brass are darker than by day; a green rack light is as bright as ever.
  const sum = (c: number) => (c >> 16) + ((c >> 8) & 255) + (c & 255)
  expect(sum(sc.fb.p[0]!)).toBeLessThan(sum(lit.fb.p[0]!) / 2)
  const sign = (s: typeof sc) => s.texts.find(t => t.row === 21 && t.ch === 'G')!.bg
  expect(sum(sign(sc))).toBeLessThan(sum(sign(lit)) / 2)
  expect(sc.fb.p.includes(0x3fd273)).toBe(true)
  // In December the tree's lights glow; the clock's red hand and the MAIL sign's brass do not.
  setClock({ hour: 22, date: [2026, 12, 20] })
  const dec = new BigSim()
  const xmas = renderBig(run(dec, idle, NIGHT_MS + 10, 2), dec, 4, 2)
  setClock(TEST_CLOCK)
  const row = (y: number, x0: number, x1: number) => Array.from(xmas.fb.p.slice(y * 64 + x0, y * 64 + x1 + 1))
  expect([42, 43].flatMap(y => row(y, 6, 10)).includes(0xe8c25a)).toBe(false)
  expect([1, 2, 3, 4, 5].flatMap(y => row(y, 11, 15)).includes(0xe04b4b)).toBe(false)
  expect([45, 47, 49, 51].flatMap(y => row(y, 0, 8)).some(c => [0xff5050, 0xffd84a, 0x5fb8ff, 0x5ff08a].includes(c))).toBe(true)
})

/** The letters on text row `row` from column x0 to x1, as drawn (a hidden letter is a space). */
const words = (sc: ReturnType<typeof renderBig>, row: number, x0: number, x1: number) => {
  const out = Array.from({ length: x1 - x0 + 1 }, () => ' ')
  for (const t of sc.texts) if (t.row === row && t.x >= x0 && t.x <= x1) out[t.x - x0] = t.ch
  return out.join('').trim()
}

test('the board names the holiday when it has no to-dos (approved round 10); to-dos and doodles win; nowhere else', async () => {
  // A plain day (June 1): the next holiday.
  const idle = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  const sim = new BigSim()
  const plain = renderBig(run(sim, idle, 2, 2), sim, 4, 2)
  expect([2, 3, 4, 5].map(r => words(plain, r, 32, 45))).toEqual(['Next up', 'Juneteenth', 'Jun 19', 'in 18 days'])
  // To-dos win the board.
  const busy = new BigSim()
  run(busy, todoTurn(1), 2, 40)
  expect(words(renderBig(view(todoTurn(1), 5_000), busy, 1, 2), 3, 32, 45)).toBe('> Fix it')
  // Thinking at the board, the Manager doodles on a plain board: no words under the marks.
  const thinker = new BigSim()
  const turn = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  let v = view(turn, 2)
  for (let i = 0; i < 400 && !(thinker.here('manager', 'board') && thinker.tick - thinker.actors.get('manager')!.arrivedAt > 4); i++) v = run(thinker, turn, 2 + i * 125, 1)
  expect(thinker.here('manager', 'board')).toBe(true)
  expect([2, 3, 4, 5].map(r => words(renderBig(v, thinker, 4, thinker.tick), r, 32, 45)).join('')).toBe('')
  // Veterans Day in the Christmas season: both on the board; no banner over it, nothing on the idle TV.
  setClock({ hour: 10, date: [2026, 11, 11] })
  const vets = new BigSim()
  const sc = renderBig(run(vets, idle, 2, 2), vets, 4, 2)
  setClock(TEST_CLOCK)
  expect([2, 3, 4, 5].map(r => words(sc, r, 32, 45))).toEqual(['Veterans Day', 'Nov 11', 'Christmas', 'Nov 1-Jan 1'])
  expect(words(sc, 0, 31, 46)).toBe('')
  expect(words(sc, 26, 32, 47)).toBe('')
})
