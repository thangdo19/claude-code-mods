// The timing script: how long each part of a tick takes, how many frames the pane sends, and how much garbage it
// leaves (what the garbage collector frees). Run from pixel-office/ (node only):
//   npx -y esbuild@0.24.0 tools/bench.ts --bundle --platform=node --format=cjs --log-level=error | node - [ticks]
// Three offices: a busy turn (full office: 7 jobs, 6 agents, to-dos), between turns, and night.

import { GCProfiler } from 'node:v8'
import type { Office } from '../types'
import { EMPTY, fitRows, lines, NIGHT_MS, setMood, startJob, startTurn, view } from '../hooks/office'
import { BigSim } from '../hooks/walk'
import { renderBig } from '../hooks/scene'
import { CellCoder } from '../hooks/cells'
import { Calm } from '../hooks/calm'
import { Camera } from '../hooks/camera'
import type { Scene } from '../hooks/gfx/fb'
import { addSec } from '../hooks/office'

const TICKS = Number(process.argv[2] ?? 4000)
const T0 = 1_000_000

function busyOffice(): Office {
  let o = setMood(startTurn({ ...EMPTY, lastActivity: T0 }, T0), 'work', T0)
  const jobs: [string, Office['jobs'][number]['role'], string, string][] = [
    ['r', 'archivist', 'auth.ts', 'Read src/auth.ts'], ['e', 'typist', 'auth.ts', 'Edit src/auth.ts'], ['b1', 'it', 'npm test', '$ npm test'],
    ['b2', 'it', 'npm run', '$ npm run lint'], ['w', 'courier', 'chrome', 'chrome: navigate'], ['s', 'researcher', 'oauth', 'Web search: oauth'],
    ['k', 'librarian', 'eli5', 'Look up skill eli5'],
  ]
  for (const [id, role, short, full] of jobs) o = startJob(o, { id, role, short, full, startedAt: T0 })
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f'])
    o = addSec(o, { id, name: 'Explore', task: 'find ' + id, short: 'grep ' + id, full: 'Grep ' + id, status: 'run', startedAt: T0, endedAt: null, teammate: id === 'f' })
  return { ...o, bg: ['npm run dev'], todos: [{ text: 'Find', status: 'completed' }, { text: 'Fix', status: 'in_progress' }, { text: 'Push', status: 'pending' }] }
}
const between: Office = { ...EMPTY, lastActivity: T0, moodAt: T0 }
const night: Office = { ...EMPTY, lastActivity: T0 - NIGHT_MS - 60_000, moodAt: T0 - NIGHT_MS - 60_000 }


const ns = () => Number(process.hrtime.bigint())
function run(name: string, o: Office): void {
  const sim = new BigSim()
  const calm = new Calm()
  const cam = new Camera()
  // (One coder per picture, as the pane keeps one.)
  const coder = new CellCoder()
  const camCoder = new CellCoder()
  const t = { sim: 0, list: 0, draw: 0, encode: 0, camera: 0 }
  let last = ''
  // (One picture drawn over each frame, the camera's window read straight from it: as the pane does.)
  let scene: Scene | undefined
  let sent = 0
  let wasMoving = false
  let quarters = 0
  let len = 0
  const warm = 400
  const gc = new GCProfiler()
  for (let i = 0; i < warm + TICKS; i++) {
    if (i === warm) gc.start()
    const on = i >= warm
    const now = T0 + i * 125
    let a = ns()
    const v = view(o, now, real => calm.step(real, now))
    sim.sync(v)
    sim.step(v)
    let b = ns()
    if (on) t.sim += b - a
    a = b
    fitRows(lines(v, sim.seated(), r => sim.doing(v, r), id => sim.lookOf(id)), 64, 9)
    b = ns()
    if (on) t.list += b - a
    a = b
    // (As the pane: a quiet office with nobody walking is on eco frames, see `onTick`.)
    const moving = sim.walking()
    const eco = !moving && sim.quiet(v)
    quarters += eco ? 1 : 2
    const full = (scene = renderBig(v, sim, quarters >> 2, i, undefined, scene))
    b = ns()
    if (on) t.draw += b - a
    a = b
    const c = coder.encode(full)
    b = ns()
    if (on) t.encode += b - a
    a = b
    cam.step(v, 64, 32, sim)
    camCoder.window(full, cam.left, cam.top, 64, 16)
    b = ns()
    if (on) t.camera += b - a
    // The pane's rule (fullscreen, the full office): every other tick unless someone walks; at night every 8th; a
    // quiet office (Eco) every 4th; the frame where they stop always. Sent only when it changed.
    const stopped = wasMoving && !moving
    wasMoving = moving
    const draw = stopped || !((!moving && i % 2) || (sim.dark(v) && !moving && i % 8) || (eco && i % 4))
    if (on && draw && c.cells !== last) sent++
    if (draw) last = c.cells
    len = c.cells.length
  }
  // Garbage: what the collector freed (young and old), per tick.
  const stats = gc.stop()?.statistics ?? []
  const freed = stats.reduce((n, s) => n + Math.max(0, s.beforeGC.heapStatistics.usedHeapSize - s.afterGC.heapStatistics.usedHeapSize), 0)
  const gcMs = stats.reduce((n, s) => n + s.cost, 0) / 1000
  const ms = (x: number) => (x / TICKS / 1e6).toFixed(3)
  const total = t.sim + t.list + t.draw + t.encode + t.camera
  console.log(
    name.padEnd(8) + ' ms/tick: sim ' + ms(t.sim) + ' · list ' + ms(t.list) + ' · draw ' + ms(t.draw) + ' · encode ' + ms(t.encode) + ' · camera ' + ms(t.camera) +
      ' · total ' + ms(total) + ' | frames sent ' + (sent / (TICKS / 8)).toFixed(1) + '/s · frame ' + len + ' chars | garbage ' + (freed / TICKS / 1024).toFixed(0) + ' KB/tick, ' + stats.length + ' GCs (' + gcMs.toFixed(0) + ' ms)',
  )
}

for (let k = 0; k < 2; k++) {
  if (k) console.log('--')
  run('busy', busyOffice())
  run('between', between)
  run('night', night)
}
