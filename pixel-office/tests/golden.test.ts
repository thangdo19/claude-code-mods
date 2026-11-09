import { expect, test } from 'claude-code/testing'

import { EVERY, GOLDEN, TICKS } from './golden'
import { fingerprints } from './scenario'

// The guard for every speed-up and tidy-up: a seeded office day must draw exactly the frames it drew before, pixel
// for pixel (full office, both cameras, a short office, the list). A changed hash names the block of ticks that differs.
// (About 9 s in the test sandbox, 3.5 s in node.)
test('a seeded office day draws every frame exactly as approved', { timeoutMs: 60_000 }, () => {
  const got = fingerprints(TICKS, EVERY)
  const bad = got.flatMap((h, k) => (h === GOLDEN[k] ? [] : ['ticks ' + k * EVERY + '-' + ((k + 1) * EVERY - 1)]))
  expect(bad).toEqual([])
  expect(got.length).toBe(GOLDEN.length)
})
