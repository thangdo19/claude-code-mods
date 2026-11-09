// Colors: #rrggbb or 0xRRGGBB to a number, a shade darker or lighter, a mix of two. Pure.

/** A color as #rrggbb or 0xRRGGBB. */
export type Paint = string | number

const cache = new Map<string, number>()
export const C = (v: Paint): number => {
  if (typeof v === 'number') return v
  let n = cache.get(v)
  if (n === undefined) {
    n = parseInt(v.slice(1), 16)
    cache.set(v, n)
  }
  return n
}
export const shade = (c: Paint, f: number): number => {
  const n = C(c)
  const ch = (s: number) => Math.min(255, Math.floor(((n >> s) & 255) * f))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
export const mix = (a: Paint, b: Paint, t: number): number => {
  const x = C(a)
  const y = C(b)
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
