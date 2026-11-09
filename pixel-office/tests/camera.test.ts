import { expect, test } from 'claude-code/testing'

import { bigCells } from '../hooks/cells'
import { renderBig } from '../hooks/scene'
import { BigSim } from '../hooks/walk'
import { Camera, focusOf } from '../hooks/camera'
import { EMPTY, setMood, startJob, startTurn, view } from '../hooks/office'
import type { Office } from '../types'

import { busy, sec } from './helpers'

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
  expect(cam.moving()).toBe(true)
  for (let i = 0; i < 20; i++) cam.step(back, 64, 32)
  expect(cam.top).toBe(0)
  expect(cam.moving()).toBe(false)

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
