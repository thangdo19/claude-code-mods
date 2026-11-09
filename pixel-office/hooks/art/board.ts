// The board on the back wall (approved art): empty, the plan-mode meeting's boxes and arrows, or the to-do words.

import { plain } from '../labels'
import type { FB, Scene } from '../gfx/fb'
import { P } from './palette'

/** The board with nothing on it, or boxes and arrows in plan mode (the to-do words: boardWords). */
export function board(fb: FB, x: number, y: number, w: number, h: number, plan: boolean, f: number): void {
  fb.r(x, y, w, h, P.boardFrame)
  fb.r(x + 1, y + 1, w - 2, h - 2, P.board)
  fb.r(x + 2, y + h - 1, w - 4, 1, '#6d7682')
  fb.s(x + 3, y + h - 1, P.red)
  fb.s(x + 5, y + h - 1, P.ink)
  if (plan) {
    for (let i = 0; i < 3; i++) {
      if (i > ((f >> 1) % 4)) break
      const b = x + 2 + i * 4
      fb.r(b, y + 2, 3, 3, i === 2 ? P.green : P.ink)
      fb.s(b + 1, y + 3, P.board)
      if (i < 2) fb.s(b + 3, y + 3, '#555c66')
    }
    fb.r(x + 2, y + 6, Math.min(10, w - 4), 1, '#8a93a0')
    fb.r(x + 2, y + 8, 6, 1, '#8a93a0')
  } else {
    fb.r(x + 3, y + 3, 7, 1, '#c5ccd6')
    fb.r(x + 3, y + 5, 4, 1, '#c5ccd6')
  }
}

export type BoardItem = { text: string; state: 'done' | 'doing' | 'todo' }
const BOARD_INK = { done: P.green, doing: '#d9822b', todo: P.ink } as const
/**
 * The to-do board with words (approved: "Words + Manager ticks"): one line per item, "v" done, ">" doing, "-" next,
 * about 12 letters each. More than fit: a top line says how many done are above, the current one stays in view, a
 * bottom line says how many more.
 */
export function boardWords(sc: Scene, x: number, y: number, w: number, h: number, items: readonly BoardItem[]): void {
  const fb = sc.fb
  fb.r(x, y, w, h, P.boardFrame)
  fb.r(x + 1, y + 1, w - 2, h - 2, P.board)
  fb.r(x + 2, y + h - 1, w - 4, 1, '#6d7682')
  fb.s(x + 3, y + h - 1, P.red)
  fb.s(x + 5, y + h - 1, P.ink)
  // Text rows fully inside the white (a cell is two pixel rows), letters from the frame's inner edge.
  const first = Math.ceil((y + 1) / 2)
  const rows = Math.floor((y + h - 1) / 2) - first
  const cols = w - 2
  const n = items.length
  let start = 0
  let end = n
  if (n > rows) {
    const open = items.findIndex(t => t.state !== 'done')
    const cur = open < 0 ? n : open
    start = Math.max(0, Math.min(cur - 1, n - (rows - 1)))
    let slots = start > 0 ? rows - 1 : rows
    end = Math.min(n, start + slots)
    if (end < n) end = start + --slots
  }
  const top = start > 0 ? 1 : 0
  if (top) sc.text(x + 1, first, ('v ' + start + ' done').padEnd(cols, ' '), BOARD_INK.done, P.board)
  items.slice(start, end).forEach((it, k) => {
    const mark = it.state === 'done' ? 'v' : it.state === 'doing' ? '>' : '-'
    const t = plain(it.text).replace(/\s+/g, ' ').trim()
    const words = t.length <= cols - 2 ? t : t.slice(0, cols - 4) + '..'
    sc.text(x + 1, first + top + k, (mark + ' ' + words).padEnd(cols, ' '), BOARD_INK[it.state], P.board)
  })
  if (end < n) sc.text(x + 1, first + top + (end - start), ('+ ' + (n - end) + ' more').padEnd(cols, ' '), '#8a93a0', P.board)
}
