// A whole day at the office, the same every run (seeded): turns, every kind of job, errors, a "no", dialogs, plan
// mode, agents (more than fit), teammates, to-dos, background commands, compacting, a /clear and a night.
// It drives the pure parts as the pane does (view → sim → camera → picture → cells, the list) and hands each tick's
// output to `each`. Used by the golden frames test (golden.test.ts, tools/golden.ts) and the fuzz (tools/fuzz.ts).

import type { Office, Role } from '../types'
import { describe } from '../hooks/labels'
import {
  addSec, EMPTY, endJob, endStatus, endTurn, fitRows, lines, NIGHT_MS, patchSec, setMood, startJob, startTurn, todosFrom, view, type View,
} from '../hooks/office'
import { BigSim } from '../hooks/walk'
import { renderBig } from '../hooks/scene'
import { CellCoder } from '../hooks/cells'
import { Calm } from '../hooks/calm'
import { Camera } from '../hooks/camera'
import type { Scene } from '../hooks/gfx/fb'
import { setClock } from '../hooks/world'

/** The same random numbers every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 32-bit FNV-1a of a string, folded into `h`. */
export function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

const TOOLS: [string, Record<string, unknown>][] = [
  ['Read', { file_path: '/p/src/auth.ts' }], ['Read', { file_path: '/p/README.md' }], ['Grep', { pattern: 'login' }],
  ['Glob', { pattern: '**/*.tsx' }], ['Bash', { command: 'npm test' }], ['Bash', { command: 'git push' }], ['Bash', { command: 'ls src' }], ['Bash', { command: 'sleep 8 && echo hi', run_in_background: true }],
  ['Edit', { file_path: '/p/src/auth.ts' }], ['Write', { file_path: '/p/notes.md' }], ['WebSearch', { query: 'oauth expiry' }],
  ['WebFetch', { url: 'https://example.dev/docs' }], ['TodoWrite', {}], ['Skill', { skill: 'eli5' }], ['ToolSearch', { query: 'select:Read' }],
  ['SendMessage', { to: 'tester' }], ['mcp__claude-in-chrome__navigate', {}], ['Agent', { description: 'find the login bug' }],
  ['TaskList', {}],
]
const TODO_TEXT = ['Find the bug', 'Fix the login', 'Write a test', 'Update the docs', 'Run the checks']

export type Tick = {
  i: number
  now: number
  v: View
  sim: BigSim
  /** The full office's scene and cells, the camera's (64 × 16 and 40 × 12), and the list at three sizes. */
  full: Scene
  cells: string
  cam: string
  camSmall: string
  /** Every 50 ticks: the office a few rows short (top row left off). */
  short?: string
  list: string
}

/** The hour and date the day runs at (`setClock`); by default a June day at 10, so the golden frames never change. */
export type Clock = { hour?: number; date?: readonly [number, number, number] }
export type Options = { ticks: number; seed?: number; draw?: boolean; clock?: Clock; /** The day starts as a new session: the office opens. */ opening?: boolean }

/** Runs the day; `each` sees every tick. With `draw: false` only the people move (for the fuzz's rule checks). */
export function scenario(opt: Options, each: (t: Tick) => void): void {
  const rand = seeded(opt.seed ?? 1)
  const pick = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(rand() * xs.length)] : undefined)
  const draw = opt.draw !== false
  setClock(opt.clock ?? { hour: 10, date: [2026, 6, 1] })
  let now = 1_000_000
  let o: Office = { ...EMPTY, lastActivity: now, moodAt: now }
  const sim = new BigSim()
  sim.opening = !!opt.opening
  const calm = new Calm()
  const cam = new Camera()
  const camSmall = new Camera()
  // One coder per picture, as the pane keeps one: an unchanged frame comes back without encoding.
  const coders = { full: new CellCoder(), cam: new CellCoder(), camSmall: new CellCoder(), short: new CellCoder() }
  let open: { id: string; tool: string; input: Record<string, unknown>; role: Role }[] = []
  let n = 0
  let agentN = 0
  let todoAt = 0
  let dialogUntil = -1
  let compactUntil = -1
  let viewing: string | undefined
  const nightAt = Math.floor(opt.ticks * 0.55)
  const clearAt = Math.floor(opt.ticks * 0.8)

  const startTool = () => {
    const [tool, input0] = pick(TOOLS)!
    const input =
      tool === 'TodoWrite'
        ? { todos: TODO_TEXT.map((content, k) => ({ content, status: k < todoAt ? 'completed' : k === todoAt ? 'in_progress' : 'pending' })) }
        : input0
    const label = describe(tool, input, '/p')
    if (label.who === 'manager') return
    const id = 't' + n++
    if (tool === 'TodoWrite') {
      o = { ...o, todos: todosFrom(input) }
      todoAt = (todoAt + 1) % (TODO_TEXT.length + 1)
    }
    o = startJob(o, { id, role: label.who, short: label.short, full: label.full, startedAt: now, ...(label.brief ? { brief: true } : {}) })
    open.push({ id, tool, input, role: label.who })
    if (tool === 'Agent') {
      const teammate = rand() < 0.3
      o = addSec(o, { id: 'ag' + agentN, name: 'Explore', task: 'find bug ' + agentN, short: 'grep login', full: 'Search "login"', status: 'run', startedAt: now, endedAt: null, teammate })
      agentN++
    }
  }
  const endTool = () => {
    const j = pick(open)
    if (!j) return
    open = open.filter(x => x !== j)
    const r = rand()
    const err = r < 0.08
    const denied = !err && r < 0.12
    const label = describe(j.tool, j.input, '/p')
    o = endJob(o, j.id, j.role, { short: label.short, full: label.full, err, denied, endedAt: now })
    if (j.tool === 'Bash' && j.input.run_in_background === true && !err) o = { ...o, bg: [...o.bg, 'sleep 8 && echo hi'].slice(-8) }
  }

  for (let i = 0; i < opt.ticks; i++) {
    now += 125
    if (i === nightAt) {
      // The day ends: everything stops, then nothing happens for a long while.
      if (o.turnActive) o = endTurn(o, 'answer', false, 30_000, now)
      open = []
      dialogUntil = compactUntil = -1
      o = { ...o, compacting: false, secs: o.secs.map(s => (s.status === 'run' || s.status === 'idle' ? { ...s, status: 'done' as const, endedAt: now } : s)) }
      now += NIGHT_MS + 60_000
    } else if (i === clearAt) {
      // /clear: a fresh office; running agents keep their desks.
      o = { ...EMPTY, secs: o.secs.filter(s => s.status === 'run' || s.status === 'idle'), bg: o.bg, order: o.order, moodAt: now, lastActivity: now }
      open = []
      dialogUntil = compactUntil = -1
    } else if (i > nightAt && i < nightAt + 400) {
      // Night: quiet.
    } else if (!o.turnActive) {
      if (rand() < 0.012) o = startTurn(o, now)
    } else {
      if (dialogUntil > 0 && now >= dialogUntil) {
        o = setMood(o, 'think', now)
        dialogUntil = -1
      }
      if (compactUntil > 0 && now >= compactUntil) {
        o = { ...o, compacting: false }
        compactUntil = -1
      }
      const r = rand()
      if (r < 0.07) startTool()
      else if (r < 0.13) endTool()
      else if (r < 0.15) {
        if (['think', 'write', 'work'].includes(o.mood)) o = { ...o, mood: pick(['think', 'write', 'work'] as const)!, moodText: null, moodAt: now, lastActivity: now }
      } else if (r < 0.154) {
        if (dialogUntil < 0) {
          o = rand() < 0.6 ? setMood(o, 'permission', now, 'Needs your OK: git push') : setMood(o, 'ask', now, 'Which way?')
          dialogUntil = now + 2000 + rand() * 3000
        }
      } else if (r < 0.162) {
        const s = pick(o.secs.filter(x => x.status === 'run'))
        if (s) o = patchSec(o, s.id, { status: rand() < 0.15 ? 'fail' : endStatus('answer', s.teammate), endedAt: now })
      } else if (r < 0.166) {
        const idle = o.secs.find(s => s.status === 'idle')
        if (idle) o = patchSec(o, idle.id, { status: 'run', endedAt: null })
      } else if (r < 0.168) o = { ...o, plan: !o.plan }
      else if (r < 0.1695) {
        if (compactUntil < 0) {
          o = { ...o, compacting: true, lastActivity: now }
          compactUntil = now + 3000 + rand() * 6000
        }
      } else if (r < 0.1715) {
        if (open.length === 0 && dialogUntil < 0) {
          const k = rand()
          o = endTurn(o, k < 0.75 ? 'answer' : k < 0.9 ? 'aborted' : 'error', k >= 0.75 && k < 0.9, 20_000 + Math.floor(rand() * 200_000), now)
          compactUntil = -1
        }
      } else if (r < 0.173) o = { ...o, bg: o.bg.slice(1) }
    }
    if (i % 300 === 0) viewing = pick(o.secs.filter(s => s.status === 'run'))?.id

    const v = view(o, now, real => calm.step(real, now))
    sim.sync(v)
    sim.step(v)
    if (!draw) {
      each({ i, now, v, sim, full: undefined as unknown as Scene, cells: '', cam: '', camSmall: '', list: '' })
      continue
    }
    cam.step(v, 64, 32, sim)
    camSmall.step(v, 40, 24, sim)
    const full = renderBig(v, sim, i >> 1, i, viewing)
    const ls = lines(v, sim.seated(), r => sim.doing(v, r), id => sim.lookOf(id))
    const list = [fitRows(ls, 64, 40), fitRows(ls, 40, 12), fitRows(ls, 30, 4)]
      .map(rows => rows.map(l => l.dot + '|' + l.who + '|' + l.what + '|' + l.tone).join('\n'))
      .join('\n--\n')
    each({
      i, now, v, sim, full,
      cells: coders.full.encode(full).cells,
      cam: coders.cam.encode(cam.view(full, 64, 32)).cells,
      camSmall: coders.camSmall.encode(camSmall.view(full, 40, 24)).cells,
      short: i % 50 === 0 ? coders.short.encode(full, 1, 29).cells : undefined,
      list,
    })
  }
}

/** Golden fingerprints: one hash of everything drawn, per block of `every` ticks. */
export function fingerprints(ticks: number, every: number, seed = 1): string[] {
  const out: string[] = []
  let h = 0x811c9dc5
  scenario({ ticks, seed }, t => {
    h = fnv(t.cells, h)
    h = fnv(t.cam, h)
    h = fnv(t.camSmall, h)
    if (t.short) h = fnv(t.short, h)
    h = fnv(t.list, h)
    if ((t.i + 1) % every === 0) {
      out.push(h.toString(16).padStart(8, '0'))
      h = 0x811c9dc5
    }
  })
  return out
}
