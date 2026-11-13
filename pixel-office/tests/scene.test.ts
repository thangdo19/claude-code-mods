import { expect, test } from 'claude-code/testing'

import { renderBig } from '../hooks/scene'
import { BigSim } from '../hooks/walk'
import { EMPTY, endJob, endTurn, NIGHT_MS, PARTY_TURN_MS, startJob, startTurn, view } from '../hooks/office'
import { FURNITURE } from '../hooks/layout'
import type { Office } from '../types'

import { rainyDay, setClock } from '../hooks/world'

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

/** The picture's pixel at (x, y), and the letters of a text row. */
const px = (sc: ReturnType<typeof renderBig>, x: number, y: number) => sc.fb.p[y * 64 + x]
const letters = (sc: ReturnType<typeof renderBig>, row: number) => sc.texts.filter(t => t.row === row).sort((a, b) => a.x - b.x).map(t => t.ch).join('')

test('round 11 on the desks: 4 cups and 6 pages leave every name tag whole; a nearly full memory shows red in the bottle', async () => {
  const sim = new BigSim()
  const turn = startTurn({ ...EMPTY, lastActivity: 1 }, 1)
  const bare = renderBig(run(sim, turn, 2, 40), sim, 1, 2)
  expect(letters(bare, 19)).toBe('JohnClaudeMary-Beth')
  // 40 s of thinking and six edits later.
  let o: Office = { ...turn, context: 97 }
  for (let k = 0; k < 6; k++) {
    o = endJob(startJob(o, { id: 'e' + k, role: 'typist', short: 'a.ts', full: 'Edit a.ts', startedAt: 2 }), 'e' + k, 'typist', { short: 'a.ts', full: 'Edit a.ts', err: false, denied: false, endedAt: 3 })
  }
  sim.life.thought = 320
  const sc = renderBig(view(o, 60_000), sim, 1, 2)
  expect(letters(sc, 19)).toBe('JohnClaudeMary-Beth')
  // Two cups side by side, two more piled on them; the pages' stack is six rows high.
  const C = FURNITURE.cups
  for (const [dx, dy] of [[0, 0], [3, 0], [0, -2], [3, -2]] as const) expect([px(sc, C.x + dx, C.y + dy - 1), px(sc, C.x + dx, C.y + dy)]).toEqual([0x6b4535, 0xf4f6f8])
  const G = FURNITURE.pages
  expect([0, 1, 2, 3, 4, 5, 6].map(i => px(sc, G.x, G.y - i) === px(bare, G.x, G.y - i))).toEqual([false, false, false, false, false, false, true])
  // The bottle: full while the memory is unknown, its last row red at 97%.
  const B = FURNITURE.cooler
  expect([px(bare, B.x + 1, B.y + 4), px(sc, B.x + 1, B.y + 4)]).toEqual([0x79c4ef, 0xf08a8a])
})

test('round 11 at the window: sunlight on the floor by day, none at night or in the rain; rain only with no holiday in the window', async () => {
  const idle = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  const shot = (clock: Parameters<typeof setClock>[0], now = 2) => {
    setClock(clock)
    const sim = new BigSim()
    return renderBig(run(sim, idle, now, 2), sim, 4, 2)
  }
  // (56, 22) is the patch's top right corner; the umbrellas lean by the door.
  const U = FURNITURE.umbrellas
  const floor = (sc: ReturnType<typeof renderBig>) => px(sc, 56, 22)
  const umbrella = (sc: ReturnType<typeof renderBig>) => px(sc, U.x, U.y - 5) === 0xd63a3a
  /** The rainy sky and its drops. */
  const RAIN = [0x8496ad, 0x6f8198, 0xd6e6f5, 0xb9cde2]
  const wet = (sc: ReturnType<typeof renderBig>) => RAIN.includes(px(sc, FURNITURE.window.x + 1, FURNITURE.window.y + 1)!)
  const evening = shot({ hour: 22, date: [2026, 6, 1] })
  const day = shot({ hour: 10, date: [2026, 6, 1] })
  const sunset = shot({ hour: 18, date: [2026, 6, 1] })
  expect(floor(day) !== floor(evening) && floor(sunset) !== floor(evening) && floor(sunset) !== floor(day)).toBe(true)
  expect([umbrella(day), wet(day)]).toEqual([false, false])
  // A rainy day (Nov 14 2026): no sun, a gray sky, two umbrellas; not after dark.
  const rain = shot({ hour: 10, date: [2026, 11, 14] })
  expect([floor(rain) === floor(evening), umbrella(rain), wet(rain)]).toEqual([true, true, true])
  expect(umbrella(shot({ hour: 22, date: [2026, 11, 14] }))).toBe(false)
  // Dec 8 2026 is rainy by its date, but December's snow has the window: no rain, no umbrellas, the sun stays.
  setClock({ hour: 10, date: [2026, 12, 8] })
  expect(rainyDay(0)).toBe(true)
  const snow = shot({ hour: 10, date: [2026, 12, 8] })
  expect([umbrella(snow), wet(snow), floor(snow) === floor(day)]).toEqual([false, false, true])
  setClock(TEST_CLOCK)
})

test('round 11: the clock tells the time; the napping cat\'s eyes glow only in the dark', async () => {
  const idle = { ...EMPTY, lastActivity: 1, moodAt: 1 }
  const K = FURNITURE.clock
  const face = (hour: number, minute: number) => {
    setClock({ hour, minute, date: [2026, 6, 1] })
    const sim = new BigSim()
    const sc = renderBig(run(sim, idle, 2, 2), sim, 4, 2)
    // The face's 3 × 3 pixels: R the red minute hand, H the dark hour hand and the middle, . white.
    return [1, 2, 3].map(y => [1, 2, 3].map(x => (px(sc, K.x + x, K.y + y) === 0xf6f7f9 ? '.' : px(sc, K.x + x, K.y + y) === px(sc, K.x + 2, K.y + 2) ? 'H' : 'R')).join('')).join('/')
  }
  // 3:00: the hour hand right, the minute hand up. 6:30: both down (the hour hand on top). 10:10 at night.
  expect([face(3, 0), face(6, 30), face(22, 10)]).toEqual(['.R./.HH/...', '.../.H./.H.', 'H.R/.H./...'])
  setClock(TEST_CLOCK)
  // The cat naps on the sill all night: by day no pixel is the eyes' green; in the dark its two eyes are.
  const eyes = (sc: ReturnType<typeof renderBig>) => sc.fb.p.filter(c => c === 0xd8ff7a).length
  const lit = new BigSim()
  expect(eyes(renderBig(run(lit, idle, 2, 2), lit, 0, 2))).toBe(0)
  const sim = new BigSim()
  const v = run(sim, idle, NIGHT_MS + 10, 2)
  expect([sim.dark(v), sim.cat.pose(), eyes(renderBig(v, sim, 0, 2))]).toEqual([true, 'nap', 2])
})

test('round 11 at a party: a slice of cake in every raised hand, the cat in its hat on the Manager\'s monitor', async () => {
  const o = endTurn(startTurn({ ...EMPTY, lastActivity: 1 }, 1), 'answer', false, PARTY_TURN_MS, PARTY_TURN_MS)
  const sim = new BigSim()
  const v = run(sim, o, PARTY_TURN_MS + 1, 4)
  expect(v.party).toBe(true)
  const sc = renderBig(v, sim, 2, 4)
  // The hat's yellow tip is 7 rows over the monitor's top; cherries: one for everyone in the office.
  const M = FURNITURE.bossMonitor
  expect(px(sc, M.x + 2, M.y - 7)).toBe(0xffd84a)
  expect(sim.actors.size).toBe(6)
  let cherries = 0
  for (const a of sim.actors.values()) {
    const [x, y] = sim.at(a)
    for (let dy = -16; dy <= -11; dy++) if (px(sc, x + 7, y + dy) === 0xe04b4b) cherries++
  }
  expect(cherries).toBeGreaterThan(3)
})
