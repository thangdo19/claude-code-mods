import { expect, test } from 'claude-code/testing'

import { bigCells, CellCoder } from '../hooks/cells'
import { renderBig } from '../hooks/scene'
import { BIG_COLS, BIG_ROWS } from '../hooks/layout'
import { BigSim } from '../hooks/walk'
import { view } from '../hooks/office'

import { busy } from './helpers'

test('the designed office (64 x 31) is used when it fits: solid cells are spaces, words are ASCII', async () => {
  const v = view(busy(), 2)
  const sim = new BigSim()
  sim.sync(v)
  const sc = renderBig(v, sim, 1, 2)
  const coder = new CellCoder()
  const c = coder.encode(sc)
  expect(c.columns).toBe(BIG_COLS)
  expect(c.rows).toBe(BIG_ROWS)
  const texts = new Set(sc.texts.map(t => t.row * BIG_COLS + t.x))
  const w = coder.words
  expect(w.length).toBe(BIG_COLS * BIG_ROWS * 3)
  for (let i = 0; i < BIG_COLS * BIG_ROWS; i++) {
    const [ch, fg, bg] = [w[i * 3]!, w[i * 3 + 1]!, w[i * 3 + 2]!]
    if (texts.has(i)) expect(ch >= 0x20 && ch <= 0x7e).toBe(true)
    else if (ch === 0x20) expect(fg).toBe(bg)
    else {
      expect(ch === 0x2580 || ch === 0x2584).toBe(true)
      expect(fg).not.toBe(bg)
    }
  }
  // The same frame again gives the same cells back without encoding; a changed one is encoded.
  expect(coder.encode(sc)).toBe(c)
  sc.fb.p[0] = 0x123456
  expect(coder.encode(sc).cells).not.toBe(c.cells)
  expect(coder.encode(sc).cells).toBe(bigCells(sc).cells)
})
