import { expect, test } from 'claude-code/testing'

import { boardTheme, dayOf, dayWords, nameOf, nextTheme, THEME_INK, themesAt } from '../hooks/theme'
import { setClock, type Holiday } from '../hooks/world'

import { TEST_CLOCK } from './helpers'

/** The themes on a date, in words, each with its own day: "veterans Nov 11". */
const on = (y: number, m: number, d: number) => {
  setClock({ hour: 10, date: [y, m, d] })
  return themesAt(0).map(th => th.holiday + ' ' + dayWords(dayOf(th)) + (th.next ? ' · ' + th.next.what + ' ' + th.next.on : ''))
}
/** The board's words on a date. */
const board = (y: number, m: number, d: number) => {
  setClock({ hour: 10, date: [y, m, d] })
  return boardTheme(0)?.map(l => l.text)
}
const DAY = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000

test('the day names its holiday, then the Christmas season under it, each with its own day', async () => {
  expect(on(2026, 11, 11)).toEqual(['veterans Nov 11', 'christmas Dec 25 · a garland ' + DAY(2026, 11, 15)])
  // On Feb 14 Valentine's wins over Tết, whose things are not up that day: only Valentine's is named.
  expect(on(2026, 2, 14)).toEqual(['valentine Feb 14'])
  // Tết's own day is its first (its decor is up a week each side).
  expect(on(2026, 2, 20)).toEqual(['tet Feb 17'])
  expect(on(2026, 6, 10)).toEqual([])
  // New Year is one stretch over the year's end, with the tree still up.
  expect(on(2026, 12, 31)).toEqual(['newyear Jan 1', 'christmas Dec 25'])
  expect(on(2027, 1, 1)).toEqual(['newyear Jan 1', 'christmas Dec 25'])
  expect(on(2027, 1, 2)).toEqual([])
  expect(on(2026, 11, 26)).toEqual(['thanksgiving Nov 26', 'christmas Dec 25 · ornaments and a wreath ' + DAY(2026, 11, 27)])
  // Christmas says its next step until the last one (Santa hats) is on.
  expect(on(2026, 11, 1)[0]).toContain('tree lights ' + DAY(2026, 11, 8))
  expect(on(2026, 12, 23)[0]).toContain('Santa hats ' + DAY(2026, 12, 24))
  expect(on(2026, 12, 25)).toEqual(['christmas Dec 25'])
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
  // The days count to the holiday's own day, not to its decor (MLK's goes up the weekend before, Tết's a week before).
  setClock({ hour: 10, date: [2027, 1, 2] })
  expect(nextTheme(0)).toMatchObject({ holiday: 'mlk', inDays: 16 })
  expect(board(2027, 1, 20)).toEqual(['Next up', 'Tết', 'Feb 6', 'in 17 days'])
  // Christmas over, its decor still up: the board looks ahead to New Year.
  expect(board(2026, 12, 28)).toEqual(['Next up', 'New Year', 'Jan 1', 'in 4 days'])
  setClock(TEST_CLOCK)
})

test('the board says it in 4 rows of 14 letters, every day of the year', async () => {
  // Two at once: each gets its name (in its color) and the days to it.
  expect(board(2026, 11, 11)).toEqual(['Veterans Day', 'today!', 'Christmas', 'in 44 days'])
  expect(boardTheme(0)!.map(l => l.ink)).toEqual([THEME_INK.veterans, '#5a6472', THEME_INK.christmas, '#5a6472'])
  // One alone: its own day, the days to it, and Christmas's next step.
  expect(board(2026, 11, 12)).toEqual(['Christmas', 'Dec 25', 'in 43 days', 'garland Nov 15'])
  expect(board(2026, 12, 24)).toEqual(['Christmas', 'Dec 25', 'tomorrow'])
  expect(board(2026, 12, 25)).toEqual(['Christmas', 'Dec 25', 'today!'])
  // After the day, while its decor stays: Tết wishes you well; New Year's Eve counts to Jan 1.
  expect(board(2026, 2, 20)).toEqual(['Tết', 'Feb 17', 'Happy Tết!'])
  expect(board(2026, 12, 31)).toEqual(['New Year', 'Jan 1', 'tomorrow'])
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
