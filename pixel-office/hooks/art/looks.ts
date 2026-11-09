// What each person looks like (approved art): skin, hair, clothes and extras, as a palette for the people sprites.
// No two people look alike: the staff, the Janitor, and eight looks for agents.

import { C, mix, shade } from '../gfx/color'
import { OUT, PHONE } from './palette'

export type Look = {
  pal: Record<string, number>
  /**
   * 'straight' (the IT girl, approved round 7): long straight hair over the shoulders, wispy bangs. 'bob' (the
   * Archivist, approved round 7): a shoulder-length bob with side-swept bangs.
   */
  style?: 'long' | 'bun' | 'cap' | 'straight' | 'bob'
  /** Rosy cheeks. */
  blush?: boolean
  /** Always a small smile (the IT girl, as in the user's photo). */
  smiley?: boolean
  glasses?: boolean
  /** Thin round glasses: a gold bridge. */
  wire?: boolean
  headset?: boolean
  /** The headset as silver headphones over the head, with a mic by the mouth (reads apart from dark hair). */
  silver?: boolean
  badge?: boolean
  bag?: boolean
  tie?: boolean
}
type LookDef = { skin: string; hair: string; shirt: string; inner?: string; tie?: string; pants?: string; cap?: string; shoes?: string } & Omit<Look, 'pal' | 'tie'>

const look = (d: LookDef): Look => {
  const inner = d.inner ?? '#f4f4f4'
  const pants = d.pants ?? '#2f3443'
  return {
    style: d.style, glasses: d.glasses, wire: d.wire, silver: d.silver, headset: d.headset, badge: d.badge, bag: d.bag, tie: d.tie !== undefined,
    blush: d.blush, smiley: d.smiley,
    pal: {
      h: C(d.hair), H: shade(d.hair, 1.45), s: C(d.skin), S: shade(d.skin, 0.86), e: C(OUT), m: mix(d.skin, '#a8434a', 0.45),
      c: C(d.shirt), C: shade(d.shirt, 0.78), k: C(inner), T: C(d.tie ?? inner), p: C(pants), P: shade(pants, 0.75), f: C(d.shoes ?? '#1a1d24'),
      g: C('#2b2f38'), G: C('#bfe3ff'), w: C('#ffffff'), K: C('#6b4226'), B: C('#7a4a2a'), q: C(d.cap ?? d.hair), y: C('#e8c47a'), Y: C('#c9a256'),
      r: C('#e04b4b'), n: C('#d4ecff'), M: C('#9aa3ae'), W: C('#8a5a32'), Z: C('#d9b75e'), v: C('#e3e8ee'),
      L: C('#3fa37a'), D: C('#5bb8f0'), j: C('#d3dae3'), J: C('#8d97a5'),
      b: mix(d.skin, '#ff6f91', 0.5), R: C(PHONE.hand), o: mix(d.skin, '#3a1014', 0.7),
      // Holiday hats (approved round 7): Santa's red and its shade, a party hat's blue and yellow.
      u: C('#d63a3a'), U: C('#a82a2a'), x: C('#4aa3ff'), z: C('#ffd84a'),
      // The heart sticker on the IT girl's laptop (approved round 8).
      i: C('#ff6f91'),
    },
  }
}

export const LOOK = {
  manager: look({ skin: '#f1c7a2', hair: '#3a2a1e', shirt: '#2c3550', tie: '#d97757', pants: '#232a3d' }),
  // The Archivist (approved Nov 2026, round 7 "Bob": the gray bun and glasses read as an old lady): a chestnut
  // shoulder-length bob, side-swept bangs, rosy cheeks, the purple top.
  archivist: look({ skin: '#d9a47e', hair: '#8a4f2e', style: 'bob', shirt: '#8a64bd', inner: '#efe6d6', pants: '#3d3550', blush: true }),
  typist: look({ skin: '#f2cfb0', hair: '#b8452e', style: 'long', shirt: '#e07fa6', inner: '#fff0f5', pants: '#3b3f4f' }),
  // The IT girl (approved Nov 2026, round 7 "Tee + jeans", from the user's photo): long straight dark hair over the
  // shoulders, wispy bangs, a small smile, rosy cheeks, the silver headset with its mic, a teal tee, blue jeans, white
  // sneakers. No glasses.
  it: look({
    skin: '#f3d3bd', hair: '#35211a', style: 'straight', shirt: '#3a9a84', inner: '#2f7566', pants: '#4a6fa5', shoes: '#eef0f3',
    blush: true, smiley: true, headset: true, silver: true,
  }),
  courier: look({ skin: '#e8b58e', hair: '#6b3e1e', style: 'cap', cap: '#e8a33d', shirt: '#d0603c', inner: '#f2e2c4', pants: '#3b4a6b', bag: true }),
  janitor: look({ skin: '#c98f6a', hair: '#4a3a2a', style: 'cap', cap: '#2f5f9e', shirt: '#3c6fb4', inner: '#e8eef7', pants: '#335f9c' }),
  researcher: look({ skin: '#f0c8a0', hair: '#2b2b2b', shirt: '#e6b432', inner: '#fff6dc', pants: '#3b3f4f', glasses: true }),
  planner: look({ skin: '#b97a56', hair: '#3b2418', style: 'long', shirt: '#5fa04e', inner: '#eef7e8', pants: '#2f3443' }),
  librarian: look({ skin: '#f3d6c0', hair: '#c9a24a', style: 'bun', shirt: '#9c6b43', inner: '#f5ead8', pants: '#4a3b30' }),
  // Agents ("secretaries"): eight looks, so up to 8 in the office at once never look alike (4 desks + 3 in line + one
  // walking out). Each differs from every staff member in shirt color and hair; all wear the agency badge.
  sec: [
    look({ skin: '#f1c9a5', hair: '#1b1512', style: 'long', shirt: '#c8384e', inner: '#fbe4e8', badge: true }),
    look({ skin: '#f3d0b4', hair: '#7a4a26', style: 'bun', shirt: '#56b4e9', inner: '#e6f5ff', badge: true }),
    look({ skin: '#f6d8c2', hair: '#e07b39', shirt: '#5b52d1', inner: '#e4e2fb', badge: true }),
    look({ skin: '#7a4a30', hair: '#121010', style: 'bun', shirt: '#b3cf32', inner: '#f3f9dc', badge: true }),
    // Short hair: long dark hair and a blue-green top would look like the IT girl.
    look({ skin: '#e2ae84', hair: '#3a2216', shirt: '#2fc4d6', inner: '#e3fbfd', badge: true }),
    look({ skin: '#a86b48', hair: '#1c1714', shirt: '#7f8a99', inner: '#e6eaef', badge: true, glasses: true }),
    look({ skin: '#f7e0d0', hair: '#efe3b8', shirt: '#d04bb8', inner: '#fbe3f6', badge: true }),
    look({ skin: '#5e3a26', hair: '#141110', shirt: '#8c2f47', inner: '#f3dde3', badge: true }),
  ],
}
export const secLook = (n: number): Look => LOOK.sec[((n % LOOK.sec.length) + LOOK.sec.length) % LOOK.sec.length] ?? LOOK.manager
