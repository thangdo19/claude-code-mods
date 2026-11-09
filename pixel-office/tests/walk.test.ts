import { expect, test } from 'claude-code/testing'

import { LOOK } from '../hooks/art/looks'
import { BigSim, routeTo, SPOTS, type SpotId } from '../hooks/walk'
import { DOT, EMPTY, startTurn, view } from '../hooks/office'

import { run, sec } from './helpers'

test('walks follow the hallways, never through a desk', async () => {
  // Staff (who never go to the Manager's chair) and the Manager (who also walks behind their own desk).
  for (const boss of [false, true])
    for (const to of (Object.keys(SPOTS) as SpotId[]).filter(k => boss || k !== 'chair'))
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
