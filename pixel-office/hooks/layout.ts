// Where everything is in the office (approved layout), in one place: its size, the furniture, the signs, the
// hallways and the spots people stand at, the depth each piece is drawn at among the people, and where the camera
// looks. Pixels: x from the left, y from the top; a text row is two pixel rows. Pure data.

/** The office: 64 × 62 px, shown as 64 columns × 31 rows (2 px per row). */
export const OFFICE_W = 64
export const OFFICE_H = 62
export const BIG_COLS = OFFICE_W
export const BIG_ROWS = OFFICE_H / 2

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
type At = { readonly x: number; readonly y: number }

/** Furniture: the top-left of each piece (and its size, where the art takes one). */
export const FURNITURE = {
  // The back wall.
  door: { x: 2, y: 4, w: 8, h: 17 },
  /** The clock, over the water cooler (moved there in round 6 for the frame). */
  clock: { x: 11, y: 1 },
  /** Employee of the month (approved round 6): a gold frame where the clock was. */
  frame: { x: 24, y: 0, w: 7, h: 8 },
  board: { x: 31, y: 2, w: 16, h: 11 },
  /** The board with the to-do words: two px taller, so its text rows sit inside the white. */
  boardWords: { x: 31, y: 2, w: 16, h: 13 },
  window: { x: 58, y: 2, w: 6, h: 10 },
  cooler: { x: 12, y: 11 },
  cabinets: [{ x: 16, y: 8, w: 4, h: 13 }, { x: 20, y: 8, w: 4, h: 13 }],
  rack: { x: 51, y: 5, w: 6, h: 16 },
  /** The test lamp on the rack's face (approved round 6), below where the IT girl's bubble reaches. */
  testLamp: { x: 52, y: 11 },
  coffee: { x: 58, y: 13 },
  /** The cat napping on the windowsill over the warm coffee machine: its left and its feet. */
  catNap: { x: 58, y: 11 },
  /** Two red lanterns on the wall at Tết (approved round 6). */
  lanterns: [{ x: 17, y: 1 }, { x: 47, y: 1 }],
  /** The printer on the floor by the coffee machine (approved round 6), above the Typist's chair. */
  printer: { x: 57, y: 24 },
  // The middle row: the Courier's desk, the Manager's, the Typist's.
  chairs: [{ x: 4, y: 33, w: 9, h: 9 }, { x: 50, y: 33, w: 9, h: 9 }],
  courierDesk: { x: 0, y: 39, w: 16, h: 6 },
  globe: { x: 0, y: 32 },
  deskPhone: { x: 12, y: 36 },
  bossChair: { x: 26, y: 26 },
  bossDesk: { x: 23, y: 39, w: 20, h: 6 },
  /** The gold name strip on the Manager's desk. */
  bossPlate: { x: 30, y: 41, w: 5, h: 1 },
  bossMonitor: { x: 24, y: 33 },
  /** The Manager's red hotline to the CEO (approved round 6), where the papers were; hold music rises from `holdNotes`. */
  bossPhone: { x: 36, y: 36 },
  holdNotes: { x: 39, y: 34 },
  plant: { x: 39, y: 32 },
  /** The party cake (approved round 6), on the Manager's desk. */
  cake: { x: 35, y: 32 },
  typistDesk: { x: 49, y: 39, w: 15, h: 6 },
  typewriter: { x: 58, y: 39 },
  /** The napping Manager's "z z Z", rising from here. */
  zzz: { x: 37, y: 13 },
} as const satisfies Record<string, Box | At | readonly Box[] | readonly At[]>

/** The front desks (agents' and the front-desk staff's), one every 16 px from the left; each part from its desk's left. */
export const FRONT_DESK = {
  every: 16,
  desk: { x: 0, y: 55, w: 15, h: 7 },
  chair: { x: 1, y: 49, w: 9, h: 9 },
  monitor: { x: 9, y: 49 },
  /** The sign's middle, on text row 29. */
  sign: { x: 7, row: 29 },
  /** The frame round the desk of the agent you are viewing. */
  frame: { x: 0, y: 45, w: 15, h: 17 },
  /** The cat sitting on a free desk by the monitor: its left and its feet. */
  cat: { x: 3, y: 54 },
} as const

/** Brass signs over the stations: the middle of the word and its text row. */
export const SIGN_AT = {
  archivist: { x: 18, row: 3 },
  it: { x: 54, row: 1 },
  courier: { x: 8, row: 21 },
  typist: { x: 56, row: 21 },
} as const

/** At the Manager's desk: the thought bubble's top-left, and where the word bubble's tail points (x, text row). */
export const BOSS_BUBBLE = { think: { x: 35, y: 20 }, words: { x: 32, row: 12 } } as const
/** The IT girl's bubble starts here: right of the board's frame (x 31–46), its border included. */
export const IT_BUBBLE_X = 48

/**
 * The depth each piece is drawn at: everyone is drawn at the row of their feet, so a desk drawn at 44.5 hides the legs
 * of whoever sits behind it and is hidden by whoever walks in front of it.
 */
export const DEPTH = {
  /** The back wall's furniture: behind everyone. */
  wall: 20.5,
  /** The cat napping on the windowsill: over the coffee machine. */
  catNap: 20.6,
  /** The printer: by its foot row. */
  printer: 32.5,
  bossChair: 41.4,
  chairs: 41.5,
  /** The Manager in the chair. */
  bossSeat: 42,
  desks: 44.5,
  frontChairs: 57.5,
  /** The plant corner (desk 0): in front of whoever waters it. */
  plantCorner: 59.9,
  frontDesks: 61.5,
  /** The cat sitting on a front desk. */
  catOnDesk: 61.6,
  /** Over everything (the z z Z). */
  top: 99,
} as const

/* ===== hallways and spots ===== */

export type Pt = readonly [number, number]
/** A place to stand (x: the sprite's left edge, feet: its bottom row), reached from `at` on a hallway via `tail`. */
export type Spot = { x: number; feet: number; seat: boolean; at: Pt; tail: readonly Pt[] }

/** Where everyone comes in: the front door, back left. */
export const DOOR: Pt = [3, 21]

/** Hallways. `boss`: only the Manager walks there (behind the Manager's own desk). */
export const LANES: readonly { a: Pt; b: Pt; boss?: boolean }[] = [
  { a: [3, 21], b: [57, 21] }, // along the back wall
  { a: [16, 21], b: [16, 48] }, // left aisle
  { a: [43, 21], b: [43, 48] }, // right aisle
  { a: [2, 48], b: [57, 48] }, // across the front, behind the agents' chairs
  { a: [3, 42], b: [16, 42] }, // behind the Courier's desk
  { a: [43, 42], b: [51, 42] }, // behind the Typist's desk
  { a: [16, 42], b: [43, 42], boss: true }, // behind the Manager's desk
]

const spot = (at: Pt, tail: Pt[] = [], seat = false): Spot => {
  const e = tail[tail.length - 1] ?? at
  return { x: e[0], feet: e[1], seat, at, tail }
}
const desk = (i: number): Spot => spot([i * FRONT_DESK.every + 2, 48], [[i * FRONT_DESK.every + 2, 58]], true)

export const SPOTS = {
  door: spot(DOOR),
  archivist: spot([24, 21]),
  it: spot([44, 21]),
  // (2 px in from the desk's end: the globe stands left of the Courier, the desk phone right.)
  courier: spot([5, 42], [], true),
  typist: spot([51, 42], [], true),
  desk0: desk(0),
  desk1: desk(1),
  desk2: desk(2),
  desk3: desk(3),
  wait0: spot([13, 21]),
  wait1: spot([9, 21]),
  wait2: spot([3, 21]),
  // A break: the coffee machine under the window, the water cooler by the door, the plant.
  coffee: spot([51, 21]),
  chatA: spot([3, 21], [[3, 26]]),
  chatB: spot([17, 21], [[17, 26]]),
  chatC: spot([32, 21], [[32, 25]]),
  chatD: spot([39, 21], [[39, 25]]),
  plant: spot([43, 36], [[44, 36]]),
  visitCourier: spot([16, 42]),
  visitTypist: spot([43, 42]),
  // Plan mode: the meeting in front of the board.
  meet0: spot([23, 21], [[23, 22]]),
  meet1: spot([46, 21], [[46, 22]]),
  meet2: spot([30, 21], [[30, 28]]),
  meet3: spot([43, 28], [[42, 28]]),
  meet4: spot([18, 21], [[18, 27]]),
  meet5: spot([50, 21], [[50, 27]]),
  meet6: spot([43, 32], [[36, 32]]),
  // The Manager.
  chair: spot([29, 42], [], true),
  board: spot([36, 21]),
  supArchivist: spot([31, 21]),
  supIt: spot([37, 21]),
  supCourier: spot([16, 42]),
  supTypist: spot([43, 42]),
  // The Janitor's round while compacting: a stop in each part of the office, along the hallways.
  sweep0: spot([12, 21]),
  sweep1: spot([30, 21]),
  sweep2: spot([50, 21]),
  sweep3: spot([43, 30]),
  sweep4: spot([43, 44]),
  sweep5: spot([55, 48]),
  sweep6: spot([30, 48]),
  sweep7: spot([5, 48]),
  sweep8: spot([16, 44]),
  sweep9: spot([16, 28]),
  // Right behind an agent's chair, clear of the next desks' bubbles.
  patrol0: spot([5, 48]),
  patrol1: spot([21, 48]),
  patrol2: spot([37, 48]),
  patrol3: spot([53, 48]),
  // Reporting a finished job: at either end of the Manager's desk, the Manager still in view.
  rep0: spot([16, 40]),
  rep1: spot([43, 40]),
  // Thinking on the move (approved round 6, "Many ways to think"): pacing behind the Manager's desk, on the Manager's
  // own hallway.
  paceL: spot([20, 42]),
  paceR: spot([38, 42]),
  // The plant corner at the first front desk (approved round 6): watering its plants.
  garden: spot([6, 48], [[6, 60]]),
  // The cat's stops (approved round 6), on the hallways: the windowsill (it jumps up), the two front desks with a
  // monitor, and a few places to sit.
  catSill: spot([57, 21]),
  catDesk1: spot([24, 48]),
  catDesk3: spot([56, 48]),
  catMid: spot([16, 31]),
  catRight: spot([43, 31]),
  catCooler: spot([11, 21]),
} as const satisfies Record<string, Spot>

/** A spot's name: a typo in one is a type error. */
export type SpotId = keyof typeof SPOTS
/** The front desks, left to right. */
export const DESK_SPOTS = ['desk0', 'desk1', 'desk2', 'desk3'] as const satisfies readonly SpotId[]
export const DESKS = DESK_SPOTS.length
/** Behind each front desk's chair (the Manager's round). */
export const PATROL_SPOTS = ['patrol0', 'patrol1', 'patrol2', 'patrol3'] as const satisfies readonly SpotId[]
/** The line at the door, first in line first. */
export const WAIT_SPOTS = ['wait0', 'wait1', 'wait2'] as const satisfies readonly SpotId[]
/** The Janitor's stops, visited in turn. */
export const SWEEP_SPOTS = ['sweep0', 'sweep1', 'sweep2', 'sweep3', 'sweep4', 'sweep5', 'sweep6', 'sweep7', 'sweep8', 'sweep9'] as const satisfies readonly SpotId[]
/** Where a finished job is reported: either end of the Manager's desk. */
export const REPORT_SPOTS = ['rep0', 'rep1'] as const satisfies readonly SpotId[]
/** The Manager looking over a back-wall or middle-row worker's shoulder. */
export const SUP_SPOTS = ['supArchivist', 'supIt', 'supCourier', 'supTypist'] as const satisfies readonly SpotId[]
/** `id` is one of `list` (a spot of that kind). */
export const among = <T extends SpotId>(list: readonly T[], id: SpotId): id is T => (list as readonly SpotId[]).includes(id)

/* ===== the camera ===== */

/** Where the small view looks: the window's top for each part of the office (even: whole rows), and columns to center. */
export const CAMERA = {
  /** The back wall: door, cabinets, rack, board. */
  back: 0,
  /** The Manager's row, with the Courier and the Typist. */
  middle: 14,
  /** The agents' desks. */
  front: 30,
  /** Feet on a row up to this are at the back; up to `middleTo` in the middle; else at the front. */
  backTo: 30,
  middleTo: 44,
  center: { board: 38, boss: 32, frontDesks: 32, files: 22, rack: 46, filesAndRack: 34, cooler: 13, boardChat: 39 },
} as const
