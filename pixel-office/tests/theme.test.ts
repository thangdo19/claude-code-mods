import { expect, test } from 'claude-code/testing'

import { boardTheme, datesOf, leftOf, nameOf, nextTheme, THEME_INK, themesAt } from '../hooks/theme'
import { setClock, type Holiday } from '../hooks/world'

import { TEST_CLOCK } from './helpers'

/** The themes on a date, in words: "veterans Nov 11 · today only". */
const on = (y: number, m: number, d: number) => {
  setClock({ hour: 10, date: [y, m, d] })
  return themesAt(0).map(th => th.holiday + ' ' + datesOf(th) + ' · ' + leftOf(th) + (th.next ? ' · ' + th.next.what + ' ' + th.next.on : ''))
}
const DAY = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000

test('the day names its holiday, then the Christmas season under it, each with its first and last day', async () => {
  expect(on(2026, 11, 11)).toEqual(['veterans Nov 11 · today only', 'christmas Nov 1 – Jan 1 · 51 days left · a garland ' + DAY(2026, 11, 15)])
  // On Feb 14 Valentine's wins over Tết, whose things are not up that day: only Valentine's is named.
  expect(on(2026, 2, 14)).toEqual(['valentine Feb 10 – 14 · last day'])
  expect(on(2026, 2, 20)).toEqual(['tet Feb 10 – 24 · 4 days left'])
  expect(on(2026, 6, 10)).toEqual([])
  // New Year is one stretch over the year's end, with the tree still up.
  expect(on(2026, 12, 31)).toEqual(['newyear Dec 31 – Jan 1 · 1 day left', 'christmas Nov 1 – Jan 1 · 1 day left'])
  expect(on(2027, 1, 1)).toEqual(['newyear Dec 31 – Jan 1 · last day', 'christmas Nov 1 – Jan 1 · last day'])
  expect(on(2027, 1, 2)).toEqual([])
  expect(on(2026, 11, 26)).toEqual(['thanksgiving Nov 23 – 26 · last day', 'christmas Nov 1 – Jan 1 · 36 days left · ornaments and a wreath ' + DAY(2026, 11, 27)])
  // Christmas says its next step until the last one (Santa hats) is on.
  expect(on(2026, 11, 1)[0]).toContain('tree lights ' + DAY(2026, 11, 8))
  expect(on(2026, 12, 23)[0]).toContain('Santa hats ' + DAY(2026, 12, 24))
  expect(on(2026, 12, 25)).toEqual(['christmas Nov 1 – Jan 1 · 7 days left'])
  // In letters drawn in the art there is no long dash.
  setClock({ hour: 10, date: [2026, 11, 26] })
  expect(themesAt(0).map(th => datesOf(th, true))).toEqual(['Nov 23-26', 'Nov 1-Jan 1'])
  setClock(TEST_CLOCK)
})

test('a plain day teases the next holiday, over the year end too', async () => {
  setClock({ hour: 10, date: [2026, 6, 10] })
  expect(nextTheme(0)).toMatchObject({ holiday: 'juneteenth', inDays: 9 })
  expect(boardTheme(0)).toEqual([
    { text: 'Next up', ink: '#5a6472' }, { text: 'Juneteenth', ink: THEME_INK.juneteenth }, { text: 'Jun 19', ink: '#5a6472' }, { text: 'in 9 days', ink: '#5a6472' },
  ])
  setClock({ hour: 10, date: [2026, 6, 18] })
  expect(boardTheme(0)![3]!.text).toBe('tomorrow')
  setClock({ hour: 10, date: [2027, 1, 2] })
  expect(nextTheme(0)).toMatchObject({ holiday: 'mlk', inDays: 14 })
  setClock(TEST_CLOCK)
})

test('the board says it in 4 rows of 14 letters, every day of the year', async () => {
  // Two at once: each gets its name (in its color) and its dates.
  setClock({ hour: 12, date: [2026, 11, 11] })
  expect(boardTheme(0)!.map(l => l.text)).toEqual(['Veterans Day', 'Nov 11', 'Christmas', 'Nov 1-Jan 1'])
  expect(boardTheme(0)!.map(l => l.ink)).toEqual([THEME_INK.veterans, '#5a6472', THEME_INK.christmas, '#5a6472'])
  // One alone: there is room for its days left and Christmas's next step.
  setClock({ hour: 12, date: [2026, 11, 12] })
  expect(boardTheme(0)!.map(l => l.text)).toEqual(['Christmas', 'Nov 1-Jan 1', '50 days left', 'garland Nov 15'])
  for (const h of Object.keys(THEME_INK) as Holiday[]) expect(nameOf(h, 14).length).toBeLessThanOrEqual(14)
  for (let k = 0; k < 366; k++) {
    const d = new Date(Date.UTC(2026, 0, 1 + k))
    setClock({ hour: 10, date: [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()] })
    const board = boardTheme(0)
    // (The year's table has a holiday or a next one every day.)
    expect(board).not.toBe(null)
    expect(board!.length).toBeLessThanOrEqual(4)
    for (const l of board!) expect(l.text.length).toBeLessThanOrEqual(14)
  }
  setClock(TEST_CLOCK)
})
