// The big office's pixels as Raster cells: two pixel rows per terminal row.
// A cell whose two pixels share a color is a colored space (no glyph at all);
// only a cell with two different colors uses ▀ (top pixel) over its background
// (bottom pixel). Text cells are printable ASCII. Pure.

import type { Scene } from './gfx/fb'

export type Cells = { cells: string; columns: number; rows: number }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_CODES = Uint8Array.from(B64, c => c.charCodeAt(0))
const EQ = '='.charCodeAt(0)
/** ASCII char codes to a string: TextDecoder (a mod's global) does it in one go; else 1024 at a time. */
const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null
const piece = new Array<number>(1024)
function ascii(codes: Uint8Array): string {
  if (decoder) return decoder.decode(codes)
  let s = ''
  for (let k = 0; k < codes.length; k += piece.length) {
    const n = Math.min(piece.length, codes.length - k)
    piece.length = n
    for (let j = 0; j < n; j++) piece[j] = codes[k + j]!
    s += String.fromCharCode.apply(null, piece)
  }
  piece.length = 1024
  return s
}

/** Base64 of `bytes`, written as char codes into `out` (reused), then made a string at once (not char by char). */
export function base64(bytes: Uint8Array, out = new Uint8Array(Math.ceil(bytes.length / 3) * 4)): string {
  const T = B64_CODES
  let o = 0
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out[o++] = T[(n >> 18) & 63]!
    out[o++] = T[(n >> 12) & 63]!
    out[o++] = T[(n >> 6) & 63]!
    out[o++] = T[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out[o++] = T[(n >> 18) & 63]!
    out[o++] = T[(n >> 12) & 63]!
    out[o++] = EQ
    out[o++] = EQ
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out[o++] = T[(n >> 18) & 63]!
    out[o++] = T[(n >> 12) & 63]!
    out[o++] = T[(n >> 6) & 63]!
    out[o++] = EQ
  }
  return ascii(out.subarray(0, o))
}

const UPPER = 0x2580
const SPACE = 0x20
/** The terminal's own color, for pixels nothing was drawn on. */
const DEFAULT = 0x01000000
/** The Raster wants little-endian words; a Uint32Array is in the machine's order (little-endian almost everywhere). */
const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

/**
 * Turns frames into Raster cells, one pane's frames after another: the words (char, fg, bg per cell) go into a buffer
 * kept from frame to frame, and a frame whose words are the same as the last one's gives the last cells string back
 * without encoding it again.
 */
export class CellCoder {
  private cur = new Uint32Array(0)
  private next = new Uint32Array(0)
  private b64 = new Uint8Array(0)
  private last: Cells | null = null

  /** The last frame's words (char, fg, bg for each cell), until the next `encode`. */
  get words(): Uint32Array {
    return this.cur
  }

  /**
   * `skip` terminal rows are left off the top (empty wall) and only `keep` rows are
   * kept, so the office fits a pane a few rows short of its full height.
   */
  encode(sc: Scene, skip = 0, keep?: number): Cells {
    const { w, h } = sc.fb
    const all = Math.floor(h / 2)
    const rows = Math.max(1, Math.min(keep ?? all - skip, all - skip))
    const n = rows * w * 3
    if (this.next.length !== n) this.next = new Uint32Array(n)
    const out = this.next
    const p = sc.fb.p
    const base = skip * 2 * w
    for (let r = 0, k = 0; r < rows; r++)
      for (let x = 0; x < w; x++, k += 3) {
        const ti = base + 2 * r * w + x
        const bi = ti + w
        const top = ti >= 0 && ti < p.length ? p[ti]! : -1
        const bottom = bi >= 0 && bi < p.length ? p[bi]! : -1
        const t = top < 0 ? DEFAULT : top
        const b = bottom < 0 ? DEFAULT : bottom
        out[k] = t === b ? SPACE : UPPER
        out[k + 1] = (t === b ? b : t) & 0x1ffffff
        out[k + 2] = b & 0x1ffffff
      }
    for (const c of sc.texts) {
      const row = c.row - skip
      if (row < 0 || row >= rows || c.x < 0 || c.x >= w) continue
      const k = (row * w + c.x) * 3
      out[k] = c.ch.charCodeAt(0)
      out[k + 1] = c.fg & 0x1ffffff
      out[k + 2] = c.bg & 0x1ffffff
    }
    // The same as the last frame: the same cells.
    const prev = this.cur
    this.next = prev
    this.cur = out
    if (this.last && this.last.columns === w && this.last.rows === rows && prev.length === n) {
      let same = true
      for (let i = 0; i < n; i++)
        if (prev[i] !== out[i]) {
          same = false
          break
        }
      if (same) return this.last
    }
    const bytes = LITTLE ? new Uint8Array(out.buffer, out.byteOffset, n * 4) : littleEndian(out)
    const size = Math.ceil(bytes.length / 3) * 4
    if (this.b64.length < size) this.b64 = new Uint8Array(size)
    this.last = { cells: base64(bytes, this.b64), columns: w, rows }
    return this.last
  }
}

function littleEndian(words: Uint32Array): Uint8Array {
  const dv = new DataView(new ArrayBuffer(words.length * 4))
  words.forEach((v, i) => dv.setUint32(i * 4, v, true))
  return new Uint8Array(dv.buffer)
}

/** One frame's cells (no frames before it). */
export function bigCells(sc: Scene, skip = 0, keep?: number): Cells {
  return new CellCoder().encode(sc, skip, keep)
}
