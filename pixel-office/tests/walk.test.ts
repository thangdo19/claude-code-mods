import { expect, test } from 'claude-code/testing'

import { LOOK } from '../hooks/art/looks'
import { BigSim, routeTo, SPOTS, type SpotId } from '../hooks/walk'
import { DOT, EMPTY, startTurn, view } from '../hooks/office'
import { AGENT_DESKS } from '../hooks/world'

import { run, sec } from './helpers'

test('walks follow the hallways, never through a desk', async () => {
  // Staff (who never go behind the Manager's desk: the chair, the pacing spots) and the Manager (who also walks there).
  const bossOnly = ['chair', 'paceL', 'paceR']
  for (const boss of [false, true])
    for (const to of (Object.keys(SPOTS) as SpotId[]).filter(k => boss || !bossOnly.includes(k)))
      for (const from of boss ? [SPOTS.chair!, SPOTS.board!] : [SPOTS.door!, SPOTS.desk2!, SPOTS.typist!]) {
        const r = routeTo([from.x, from.feet], to, boss)
        r.slice(1).forEach((p, i) => expect(p[0] === r[i]![0] || p[1] === r[i]![1]).toBe(true))
      }
})

test("more agents than desks wait in line; agents take the free desk, then the Planner's; a waiting teammate gives its desk up", async () => {
  const sim = new BigSim()
  let o = startTurn(EMPTY, 1)
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) o = sec(o, id, 1)
  sim.sync(view(o, 2))
  // (Approved round 6: never the plant corner, desk 0, or the video-call desk, desk 2.)
  expect(AGENT_DESKS).toEqual([3, 1])
  expect(sim.seated()).toEqual([null, 'b', null, 'a'])
  expect(sim.queue).toBe(4)
  // The line at the door is the waiting agents themselves, first come first served; the rest wait outside.
  expect(['c', 'd', 'e'].map(id => sim.actors.get(`sec:${id}`)?.dest)).toEqual(['wait0', 'wait1', 'wait2'])
  expect(sim.actors.has('sec:f')).toBe(false)
  expect(sim.borrowed('planner')).toBe(true)

  const waiting = { ...o, secs: o.secs.map(s => (s.id === 'b' ? { ...s, status: 'idle' as const } : s)) }
  run(sim, waiting, 2, 60)
  expect(sim.seated()).toEqual([null, 'c', null, 'a'])
  expect(sim.queue).toBe(4)
  // c walked from the line to the desk; b walked out and waits behind the working ones.
  expect(sim.here('sec:c', 'desk1')).toBe(true)
  expect(['d', 'e', 'f'].map(id => sim.actors.get(`sec:${id}`)?.dest)).toEqual(['wait0', 'wait1', 'wait2'])
  expect(sim.actors.has('sec:b')).toBe(false)
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
