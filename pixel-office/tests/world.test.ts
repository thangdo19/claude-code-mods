import { expect, test } from 'claude-code/testing'

import { holidayAt, lunchAt, setClock, skyAt } from '../hooks/world'

import { TEST_CLOCK } from './helpers'

const on = (y: number, m: number, d: number) => {
  setClock({ hour: 10, date: [y, m, d] })
  return holidayAt(0)
}
const at = (hour: number) => {
  setClock({ hour, date: [2026, 6, 1] })
  return [skyAt(0), lunchAt(0)] as const
}

test('the window follows the hour, lunch is at noon', async () => {
  expect([5, 6, 9, 10, 12, 16, 17, 19, 20, 23].map(h => at(h)[0])).toEqual(['night', 'morning', 'morning', 'day', 'day', 'day', 'sunset', 'sunset', 'night', 'night'])
  expect([11, 12, 13].map(h => at(h)[1])).toEqual([false, true, false])
  setClock(TEST_CLOCK)
})

test('holidays by date: Halloween from Oct 20, all December, Tết a week each side', async () => {
  expect([on(2026, 10, 19), on(2026, 10, 20), on(2026, 10, 31), on(2026, 11, 1)]).toEqual([null, 'halloween', 'halloween', null])
  expect([on(2026, 12, 1), on(2026, 12, 31), on(2027, 1, 1)]).toEqual(['christmas', 'christmas', null])
  // Tết 2027 is Feb 6; Tết 2028 is Jan 26.
  expect([on(2027, 1, 29), on(2027, 1, 30), on(2027, 2, 6), on(2027, 2, 13), on(2027, 2, 14)]).toEqual([null, 'tet', 'tet', 'tet', null])
  expect(on(2028, 1, 19)).toBe('tet')
  // A year not in the table: no Tết.
  expect(on(2031, 1, 25)).toBe(null)
  setClock(TEST_CLOCK)
})
