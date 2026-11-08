// The big office's pixels as Raster cells: two pixel rows per terminal row.
// A cell whose two pixels share a color is a colored space (no glyph at all);
// only a cell with two different colors uses ▀ (top pixel) over its background
// (bottom pixel). Text cells are printable ASCII. Pure.

import type { Scene } from './big-sprites'

export type Cells = { cells: string; columns: number; rows: number }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '='
  }
  return out
}

const UPPER = 0x2580
const SPACE = 0x20
/** The terminal's own color, for pixels nothing was drawn on. */
const DEFAULT = 0x01000000

/**
 * `skip` terminal rows are left off the top (empty wall) and only `keep` rows are
 * kept, so the office fits a pane a few rows short of its full height.
 */
export function bigCells(sc: Scene, skip = 0, keep?: number): Cells & { grid: { ch: number; fg: number; bg: number }[] } {
  const { w, h } = sc.fb
  const all = Math.floor(h / 2)
  const rows = Math.max(1, Math.min(keep ?? all - skip, all - skip))
  const p = sc.fb.p.subarray(skip * 2 * w)
  const grid: { ch: number; fg: number; bg: number }[] = []
  for (let r = 0; r < rows; r++)
    for (let x = 0; x < w; x++) {
      const top = p[2 * r * w + x] ?? -1
      const bottom = p[(2 * r + 1) * w + x] ?? -1
      const t = top < 0 ? DEFAULT : top
      const b = bottom < 0 ? DEFAULT : bottom
      if (t === b) {
        grid.push({ ch: SPACE, fg: b, bg: b })
        continue
      }
      grid.push({ ch: UPPER, fg: t, bg: b })
    }
  for (const c of sc.texts) {
    const row = c.row - skip
    if (row >= 0 && row < rows && c.x >= 0 && c.x < w) grid[row * w + c.x] = { ch: c.ch.charCodeAt(0), fg: c.fg, bg: c.bg }
  }
  const words = new DataView(new ArrayBuffer(grid.length * 12))
  grid.forEach((c, i) => {
    words.setUint32(i * 12, c.ch, true)
    words.setUint32(i * 12 + 4, c.fg & 0x1ffffff, true)
    words.setUint32(i * 12 + 8, c.bg & 0x1ffffff, true)
  })
  return { cells: base64(new Uint8Array(words.buffer)), columns: w, rows, grid }
}
