import { expect, test } from 'claude-code/testing'

import { Calm, CALM_HOLD } from '../hooks/calm'

test('a fast think / tool loop never flashes a bubble; moods that need you show at once', async () => {
  const calm = new Calm()
  let shown = calm.step('think', 0)
  let changedAt = 0
  // 0.1 s of thinking between 0.1 s tool calls, for 6 s: whatever shows, stays at least CALM_HOLD.
  for (let t = 125; t < 6000; t += 125) {
    const now = calm.step(Math.floor(t / 100) % 2 ? 'work' : 'think', t)
    if (now !== shown) {
      expect(t - changedAt).toBeGreaterThanOrEqual(CALM_HOLD)
      shown = now
      changedAt = t
    }
  }
  // A long stretch of one mood takes over, no sooner than CALM_HOLD after the last change.
  const c2 = new Calm()
  c2.step('think', 0)
  expect(c2.step('write', 125)).toBe('think')
  let t = 125
  while (c2.step('write', t) === 'think') t += 125
  expect(t).toBeGreaterThanOrEqual(CALM_HOLD)
  expect(c2.step('permission', t + 125)).toBe('permission')
  expect(new Calm().peek('think', 0)).toBe('think')
})
