import { expect, test } from 'claude-code/testing'

import { walkStep } from '../hooks/scene'
import { FB } from '../hooks/gfx/fb'
import { LOOK } from '../hooks/art/looks'
import { drawPerson, type Face, type PersonOpts } from '../hooks/art/people'
import { dirAt } from '../hooks/walk'

test('walking: a new step on every frame drawn, facing the way they go, the side view as wide as the front', () => {
  // Above the prompt every other tick is drawn: hurrying goes foot, foot; a stroll foot, pass, foot, pass. Never the
  // same step twice in a row (hurrying legs froze there before, and strollers limped).
  const drawn = (speed: number, every: number) => [0, 1, 2, 3, 4, 5].map(i => walkStep({ speed, walked: i * every }) % 4)
  expect(drawn(3, 2)).toEqual([0, 2, 0, 2, 0, 2])
  expect(drawn(1.5, 2)).toEqual([0, 1, 2, 3, 0, 1])
  expect(drawn(3, 1)).toEqual([0, 1, 2, 3, 0, 1])
  const pic = (o: PersonOpts, L = LOOK.manager) => {
    const fb = new FB(20, 18)
    drawPerson(fb, 6, 3, L, o)
    return fb
  }
  const px = (o: PersonOpts, L = LOOK.manager) => Array.from(pic(o, L).p).join()
  for (const face of ['down', 'right', 'up', 'left'] as Face[])
    for (let s = 0; s < 4; s++) expect(px({ arms: 'walk', f: s, face })).not.toBe(px({ arms: 'walk', f: (s + 1) % 4, face }))
  // The way they go along a route; left is the right side mirrored.
  const r = [[0, 0], [10, 0], [10, 5], [3, 5], [3, 0]] as const
  expect([1, 11, 16, 23, 99].map(t => dirAt(r, t))).toEqual(['right', 'down', 'left', 'up', 'down'])
  const flipped = pic({ arms: 'down', face: 'left' })
  const right = pic({ arms: 'down', face: 'right' })
  for (let y = 0; y < 18; y++) for (let x = 0; x <= 6; x++) expect(flipped.p[y * 20 + 6 + x]).toBe(right.p[y * 20 + 12 - x])
  // From the side: the body as wide as the front (not a stick), and no nose sticking out of the face.
  const cols = (fb: FB, y0: number, y1: number) => new Set([...Array(20 * 18).keys()].filter(i => fb.p[i]! >= 0 && Math.floor(i / 20) >= y0 && Math.floor(i / 20) <= y1).map(i => i % 20)).size
  expect(cols(right, 3 + 6, 3 + 8)).toBeGreaterThanOrEqual(4)
  expect(cols(right, 3 + 2, 3 + 4)).toBeLessThanOrEqual(5)
  // Talking at rest they may turn; anything else at rest faces you.
  expect(px({ arms: 'mug', face: 'right' })).toBe(px({ arms: 'mug' }))
  // The ponytail hangs still while she sits at work; it swings as she walks.
  const head = (o: PersonOpts) => Array.from(pic(o, LOOK.it).p.slice(0, 20 * (3 + 5))).join()
  expect(head({ arms: 'type', seat: true, f: 0 })).toBe(head({ arms: 'type', seat: true, f: 1 }))
  expect(head({ arms: 'walk', f: 0 })).not.toBe(head({ arms: 'walk', f: 2 }))
})
