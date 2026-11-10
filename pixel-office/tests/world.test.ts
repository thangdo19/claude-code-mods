import { expect, test } from 'claude-code/testing'

import { decorAt, easter, lunchAt, setClock, skyAt } from '../hooks/world'

import { TEST_CLOCK } from './helpers'

const on = (y: number, m: number, d: number, hour = 10) => {
  setClock({ hour, date: [y, m, d] })
  return decorAt(0)
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

test('holidays by date (approved round 7): every US holiday plus Tết, Monday ones for the long weekend', async () => {
  const h = (y: number, m: number, d: number) => on(y, m, d).holiday
  // A plain June day (the tests' clock): nothing at all, so the golden frames never change.
  expect(on(2026, 6, 1)).toEqual(on(2026, 8, 20))
  expect(h(2026, 6, 1)).toBe(null)
  // New Year (Dec 31 – Jan 1), the computed Mondays (MLK Jan 18 2027, Presidents' Feb 15, Memorial May 31, Labor Sep 6)
  // with the weekend before, Juneteenth, July 1–4, Veterans Day; no Columbus Day (left out).
  expect([h(2027, 1, 1), h(2027, 1, 2), h(2027, 1, 15), h(2027, 1, 16), h(2027, 1, 18), h(2027, 1, 19)]).toEqual(['newyear', null, null, 'mlk', 'mlk', null])
  expect([h(2028, 2, 19), h(2027, 2, 15), h(2027, 5, 29), h(2027, 5, 31), h(2027, 6, 19), h(2027, 6, 30), h(2027, 7, 1), h(2027, 7, 4), h(2027, 7, 5)])
    .toEqual(['presidents', 'presidents', 'memorial', 'memorial', 'juneteenth', null, 'july4', 'july4', null])
  expect([h(2027, 9, 4), h(2027, 9, 6), h(2027, 10, 11), h(2026, 11, 11)]).toEqual(['labor', 'labor', null, 'veterans'])
  // Valentine's Feb 10–14, St. Patrick's Mar 14–17, Halloween Oct 20–31; Tết a week each side wins over Valentine's.
  expect([h(2028, 2, 9), h(2028, 2, 10), h(2028, 2, 14), h(2028, 3, 13), h(2028, 3, 14), h(2028, 3, 17), h(2028, 3, 18)])
    .toEqual([null, 'valentine', 'valentine', null, 'stpatrick', 'stpatrick', null])
  expect([h(2027, 10, 19), h(2027, 10, 20), h(2027, 10, 31)]).toEqual([null, 'halloween', 'halloween'])
  // The jack-o'-lantern stands in the plant corner, not on the Manager's desk (round 9: it sat on the hotline).
  expect([on(2027, 10, 25).desk, on(2027, 10, 25).floor]).toEqual([null, 'pumpkin'])
  expect([h(2027, 1, 29), h(2027, 1, 30), h(2027, 2, 6), h(2027, 2, 13), h(2027, 2, 14), h(2028, 1, 19)]).toEqual([null, 'tet', 'tet', 'tet', 'valentine', 'tet'])
  // Valentine's Day itself wins over Tết (round 9): 2026's Tết week covers Feb 10–24.
  expect([h(2026, 2, 13), h(2026, 2, 14), h(2026, 2, 15)]).toEqual(['tet', 'valentine', 'tet'])
  // Tết by Vietnam's calendar: Feb 2 in 2030 (Feb 3 is China's), so its week is Jan 26 – Feb 9; the table runs to 2045.
  expect([h(2030, 1, 25), h(2030, 1, 26), h(2030, 2, 9), h(2030, 2, 10)]).toEqual([null, 'tet', 'tet', 'valentine'])
  expect([h(2036, 1, 28), h(2045, 2, 17), h(2046, 2, 6)]).toEqual(['tet', 'tet', null])
  // Easter by the computus, shown Monday to Easter Sunday, with the bunny and the basket.
  expect([2026, 2027, 2028, 2029, 2030].map(easter)).toEqual([[4, 5], [3, 28], [4, 16], [4, 1], [4, 21]])
  expect([h(2027, 3, 21), h(2027, 3, 22), h(2027, 3, 28), h(2027, 3, 29)]).toEqual([null, 'easter', 'easter', null])
  expect([on(2027, 3, 24).eggs, on(2027, 3, 24).floor]).toEqual([true, 'basket'])
  // Fireworks on July 4th all day, the evenings before; at New Year, with party hats.
  expect([on(2027, 7, 4).window, on(2027, 7, 3).window, on(2027, 7, 3, 21).window]).toEqual(['fireworks', null, 'fireworks'])
  expect([on(2026, 12, 31).hats, on(2026, 12, 31).window, on(2026, 12, 31).wall]).toEqual(['party', 'fireworks', 'tinsel'])
  setClock(TEST_CLOCK)
})

test('Christmas builds up from November (approved round 7) and comes down after New Year', async () => {
  const look = (y: number, m: number, d: number) => {
    const c = on(y, m, d)
    return [c.tree, c.wall, c.wreath, c.window, c.gifts, c.hats].join(' ')
  }
  // The tree Nov 1, its lights Nov 8, the garland Nov 15, then (after Thanksgiving, Nov 26 2026) ornaments and the
  // wreath; December snow and a gift more every 6 days; Dec 24–25 every gift and Santa hats; then up to New Year.
  // Thanksgiving is Monday to Thursday (round 9): on Friday the office is all Christmas.
  expect(look(2026, 10, 31)).toBe('0 halloween false  0 ')
  expect(look(2026, 11, 1)).toBe('1  false  0 ')
  expect(look(2026, 11, 8)).toBe('2  false  0 ')
  expect(look(2026, 11, 15)).toBe('2 garland false  0 ')
  expect(look(2026, 11, 25)).toBe('2 leaves false  0 ')
  expect(look(2026, 11, 26)).toBe('2 leaves false  0 ')
  expect(look(2026, 11, 27)).toBe('3 garland true  0 ')
  expect(look(2026, 11, 28)).toBe('3 garland true  0 ')
  expect([1, 7, 13, 19, 23].map(d => on(2026, 12, d).gifts)).toEqual([1, 2, 3, 4, 4])
  expect(look(2026, 12, 24)).toBe('3 garland true snow 4 santa')
  expect(look(2026, 12, 25)).toBe('3 garland true snow 4 santa')
  expect(look(2026, 12, 26)).toBe('3 garland true snow 0 ')
  expect(look(2027, 1, 1)).toBe('3 tinsel true fireworks 0 party')
  expect(look(2027, 1, 2)).toBe('0  false  0 ')
  // Thanksgiving week (Mon–Thu) and Veterans Day keep the tree; the turkey stands in the plant corner.
  expect([on(2026, 11, 23).holiday, on(2026, 11, 22).holiday, on(2026, 11, 25).floor, on(2026, 11, 11).tree]).toEqual(['thanksgiving', 'christmas', 'turkey', 2])
  expect([on(2026, 11, 27).holiday, on(2026, 11, 27).floor]).toEqual(['christmas', null])
  // Snow lies on the sill all December, under New Year's fireworks too (round 9).
  expect([on(2026, 11, 30), on(2026, 12, 1), on(2026, 12, 31), on(2027, 1, 1), on(2027, 1, 2)].map(c => c.snowy)).toEqual([false, true, true, true, false])
  setClock(TEST_CLOCK)
})
