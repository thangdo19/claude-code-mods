// The fuzz: the seeded office day (tests/scenario.ts) for many ticks, checking the rules in CLAUDE.md ("Before saying
// a change is done") on every tick, and counting what the day covered. Run from pixel-office/ (node only):
//   npx -y esbuild@0.24.0 tools/fuzz.ts --bundle --platform=node --format=cjs --log-level=error | node - [ticks] [seeds] [--draw]
// Default: 6 seeds × 10 000 ticks (60 000), each day with its own night and /clear. --draw also draws every frame.
// Prints the broken rules (at most 5 of each) and the coverage; exits 1 on a broken rule.

import { WHO, ROLES, DOT_W, WHO_W, fitRows, lines, textWidth } from '../hooks/office'
import { workTime } from '../hooks/life'
import { decorAt, REMOTE, skyAt } from '../hooks/world'
import { scenario, type Clock } from '../tests/scenario'

const args = process.argv.slice(2)
const nums = args.filter(a => /^\d+$/.test(a)).map(Number)
const TICKS = nums[0] ?? 10_000
const SEEDS = nums[1] ?? 6
const DRAW = args.includes('--draw')

const BREAK_SPOTS = new Set(['coffee', 'chatA', 'chatB', 'chatC', 'chatD', 'plant', 'visitCourier', 'visitTypist', 'garden'])
/**
 * Each seed's day at its own time (rounds 6 and 7): lunch on Christmas Eve (Santa hats), sunset at Halloween, morning
 * at Tết, a plain day, the evening of July 4th, Thanksgiving. Odd seeds start as a new session (the office opens).
 */
const CLOCKS: Clock[] = [
  { hour: 12, date: [2026, 12, 24] }, { hour: 18, date: [2026, 10, 25] }, { hour: 7, date: [2027, 2, 6] }, { hour: 10, date: [2026, 6, 1] },
  { hour: 19, date: [2027, 7, 4] }, { hour: 11, date: [2026, 11, 25] },
]
/** The Manager thinking this many ticks before a huddle (`HUDDLE_AFTER` in life.ts). */
const HUDDLE_AFTER = 64
const CHATS = new Set(['chat', 'visit', 'host'])
/** Places too close for two at once (`NEAR` in life.ts). */
const CLOSE = [['rep0', 'visitCourier', 'supCourier'], ['rep1', 'visitTypist', 'supTypist']]
/** Walking longer than this many ticks without arriving is "stuck". */
const STUCK = 400
/** After cleaning, this many ticks to walk back in. */
const BACK_IN = 240

const broken = new Map<string, string[]>()
const fail = (rule: string, msg: string) => {
  const l = broken.get(rule) ?? []
  if (l.length < 5) l.push(msg)
  else if (l.length === 5) l.push('…')
  broken.set(rule, l)
}
const seen = new Map<string, number>()
const saw = (k: string) => seen.set(k, (seen.get(k) ?? 0) + 1)

const t0 = Date.now()
for (let seed = 1; seed <= SEEDS; seed++) {
  const walkingSince = new Map<string, number>()
  /** Per role: had a job since its last report started. */
  const workedSince = new Map<string, boolean>()
  const lastAct = new Map<string, string | undefined>()
  let cleanEnded = -1
  let prevJanitor = false
  /** The thinking stretch (sim ticks): since when, and the tick its huddle started. */
  let thinkSince = -1
  let huddleAt = -1
  const huddling = new Set<string>()
  let catWalking = -1
  scenario({ ticks: TICKS, seed, draw: DRAW, clock: CLOCKS[(seed - 1) % CLOCKS.length], opening: seed % 2 === 1 }, t => {
    const { v, sim, i } = t
    const at = (m: string) => fail(m.split(':')[0]!, 'seed ' + seed + ' tick ' + i + ': ' + m)
    const life = sim.life
    const inside = [...sim.actors.values()]
    const staying = inside.filter(a => !a.leaving)

    // Coverage.
    saw('mood ' + v.mood)
    if (v.night) saw('night')
    if (v.janitor) saw('cleaning')
    if (v.planning) saw('plan mode')
    if (v.frozen) saw('frozen (Esc)')
    if (sim.queue > 0) saw('line at the door')
    if (v.todos?.length) saw('to-dos')
    if (v.bg.length) saw('background commands')
    for (const r of ROLES) {
      const w = v.workers[r]
      if (w) saw('worker ' + w.state + (w.note ? ' ' + w.note : ''))
      if (sim.borrowed(r)) saw('desk borrowed')
      const k = life.activity(r)
      if (k) saw('act ' + k)
    }
    const mk = life.activity('manager')
    if (mk) saw('manager act ' + mk)
    const md = sim.actors.get('manager')?.dest ?? ''
    if (/^(sup|patrol)/.test(md)) saw('manager checks in')
    if (md === 'board') saw('manager at the board')
    for (const s of v.secs) saw('agent ' + s.status + (s.teammate ? ' (teammate)' : ''))
    saw('sky ' + (v.night ? 'night (idle)' : skyAt(v.now)))
    const deco = decorAt(v.now)
    if (deco.holiday) saw('holiday ' + deco.holiday + (deco.hats ? ' + hats' : '') + (deco.tree ? ' + tree' : ''))
    if (i < 200 && life.arriving.size) saw('opening: coming in')
    if (life.activity('it') === 'hello' || life.activity('archivist') === 'hello') saw('opening: wave')
    if (life.caller(sim.tick)) saw('opening: hi on the TV')
    // The opening: the Manager comes in first; nobody is on the way in for long.
    if (i === 1 && seed % 2 === 1 && inside.some(a => a.id !== 'manager' && a.arrivedAt >= 0)) at('opening: someone in place at once')
    if (i > 400 && life.arriving.size) at('opening: still coming in after 400 ticks: ' + [...life.arriving].join(', '))
    saw('cat ' + sim.cat.pose() + (sim.cat.desk() >= 0 ? ' on desk ' + sim.cat.desk() : ''))
    if (v.mood === 'think' && (/^pace/.test(md) || md === 'coffee' || md === 'board')) saw('manager thinks at ' + md)
    if (life.calling(sim.tick)) saw('manager calls out')
    if (life.lap) saw('laptop ' + life.lap)
    if (v.mood === 'done' && /Done in ([2-9]|\d\d+)m/.test(v.line)) saw('party')
    if (sim.actors.get('courier')?.dest === 'door') saw('parcel at the door')

    // Round 6: the Researcher and the Librarian work from home; agents only at desks 3 and 1.
    for (const r of REMOTE) if (sim.actors.has(r)) at('remote inside: ' + r + ' to ' + sim.actors.get(r)!.dest)
    const sd = sim.seated()
    if (sd[0] || sd[2]) at('agent desk: ' + JSON.stringify(sd))
    for (const a of inside) if (a.id.startsWith('sec:') && (a.dest === 'desk0' || a.dest === 'desk2')) at('agent desk: ' + a.id + ' to ' + a.dest)
    // The cat never stuck.
    const cw = sim.cat.t < sim.cat.length
    if (!cw || v.frozen) catWalking = -1
    else if (catWalking < 0) catWalking = i
    else if (i - catWalking > STUCK) at('stuck: the cat walking to ' + sim.cat.dest + ' since tick ' + catWalking)
    // Huddles: never before 8 s of thinking, once a stretch.
    if (!v.frozen) {
      if (v.mood !== 'think') thinkSince = huddleAt = -1
      else if (thinkSince < 0) thinkSince = sim.tick
      for (const r of ROLES) {
        const on = life.activity(r) === 'huddle'
        if (on && !huddling.has(r)) {
          if (thinkSince < 0 || sim.tick - thinkSince < HUDDLE_AFTER) at('huddle early: ' + r + ' after ' + (sim.tick - thinkSince) + ' ticks')
          else if (huddleAt >= 0 && huddleAt !== sim.tick) at('huddle twice in a stretch: ' + r)
          huddleAt = sim.tick
        }
        if (on) huddling.add(r)
        else huddling.delete(r)
      }
    }

    // No one stuck walking.
    for (const id of [...walkingSince.keys()]) if (!sim.actors.has(id)) walkingSince.delete(id)
    for (const a of inside) {
      const walking = a.delay > 0 || a.t < a.length
      if (!walking || v.frozen) walkingSince.delete(a.id)
      else if (!walkingSince.has(a.id)) walkingSince.set(a.id, i)
      else if (i - walkingSince.get(a.id)! > STUCK) at('stuck: ' + a.id + ' walking to ' + a.dest + ' since tick ' + walkingSince.get(a.id))
    }
    // One person per spot (where they are or are headed).
    const dests = new Map<string, string>()
    for (const a of staying) {
      const o = dests.get(a.dest)
      if (o !== undefined) at('two on one spot: ' + a.dest + ' (' + o + ', ' + a.id + ')')
      dests.set(a.dest, a.id)
    }
    for (const g of CLOSE) {
      const there = staying.filter(a => g.includes(a.dest))
      if (there.length > 1) at('crowded: ' + there.map(a => a.id + '@' + a.dest).join(', '))
    }
    // Chats two-sided; at most 2 in a huddle.
    for (const [who, act] of life.acts) {
      if (!CHATS.has(act.kind)) continue
      const mate = act.partner ? life.acts.get(act.partner) : undefined
      if (!mate || mate.partner !== who || !CHATS.has(mate.kind)) at('one-sided chat: ' + who + ' ' + act.kind + ' with ' + act.partner)
    }
    const huddle = ROLES.filter(r => life.activity(r) === 'huddle').length
    if (huddle > 2) at('huddle: ' + huddle + ' at once')
    // Work time: nobody heading to a break spot.
    if (workTime(v))
      for (const r of ROLES) {
        const a = sim.actors.get(r)
        if (a && !a.leaving && BREAK_SPOTS.has(a.dest)) at('break in work time: ' + r + ' to ' + a.dest)
      }
    // Each finished job reported once: a new report only after a job (or the reply) since the last one.
    for (const r of ROLES) {
      const w = v.workers[r]
      if (w?.state === 'work') workedSince.set(r, true)
      const k = life.activity(r)
      if (k === 'report' && lastAct.get(r) !== 'report') {
        if (workedSince.get(r) === false) at('reported twice: ' + r)
        workedSince.set(r, false)
      }
      lastAct.set(r, k ?? undefined)
    }
    // Agents: no two look alike; only waiting agents in the line at the door.
    const looks = inside.filter(a => a.id.startsWith('sec:')).map(a => sim.lookOf(a.id.slice(4)))
    if (looks.includes(undefined) || new Set(looks).size !== looks.length) at('look: agents ' + looks.join(','))
    const seated = sim.seated()
    for (const a of staying)
      if (a.dest.startsWith('wait') && (!a.id.startsWith('sec:') || seated.includes(a.id.slice(4)))) at('line: ' + a.id + ' at ' + a.dest)
    // Cleaning: inside only the Janitor, busy agents at desks, workers with a job; everyone back after.
    if (v.janitor) {
      for (const a of staying) {
        const sec = a.id.startsWith('sec:') ? a.id.slice(4) : undefined
        const ok =
          a.id === 'janitor' ||
          (sec !== undefined && v.secs.some(s => s.id === sec && s.status === 'run') && sim.desks.includes(sec)) ||
          ((ROLES as readonly string[]).includes(a.id) && v.workers[a.id as (typeof ROLES)[number]] !== undefined)
        if (!ok) at('inside while cleaning: ' + a.id + ' to ' + a.dest)
      }
    }
    if (prevJanitor && !v.janitor) cleanEnded = i
    if (v.janitor) cleanEnded = -1
    prevJanitor = v.janitor
    if (cleanEnded >= 0 && i - cleanEnded === BACK_IN) {
      cleanEnded = -1
      const gone = ['manager', ...ROLES.filter(r => !REMOTE.includes(r))].filter(r => !sim.actors.has(r) || sim.actors.get(r)!.leaving)
      if (!v.night && gone.length) at('not back after cleaning: ' + gone.join(', '))
    }
    // The board ticks only done lines.
    const done = new Set((v.todos ?? []).filter(x => x.status === 'completed').map(x => x.text))
    for (const x of life.ticked) if (!done.has(x)) at('board: ticked "' + x + '" is not done')
    // The list: every staff member on exactly one line; fitRows within its rows, the Manager first, no row too wide.
    const ls = lines(v, seated, r => sim.doing(v, r), id => sim.lookOf(id))
    for (const r of ROLES) {
      const n = ls.filter(l => l.who === WHO[r]).length
      if (n !== 1) at('list: ' + WHO[r] + ' on ' + n + ' lines')
    }
    for (const [w, rows] of [[64, 40], [40, 12], [30, 4], [36, 2], [64, 1]] as const) {
      const fit = fitRows(ls, w, rows)
      if (fit.length > rows) at('fitRows: ' + fit.length + ' rows for ' + rows)
      if (fit[0]?.who !== WHO.manager) at('fitRows: first row is ' + fit[0]?.who)
      for (const l of fit) if (textWidth(l.what) > Math.max(8, w - DOT_W - WHO_W)) at('fitRows: too wide at ' + w + ': ' + l.what)
    }
  })
}

console.log('fuzz: ' + SEEDS + ' seeds × ' + TICKS + ' ticks' + (DRAW ? ', drawn' : '') + ' in ' + (Date.now() - t0) + ' ms')
console.log('covered: ' + [...seen.keys()].sort().map(k => k + ' ' + seen.get(k)).join(' · '))
if (!broken.size) console.log('every rule held')
for (const [rule, msgs] of broken) console.log('BROKEN ' + rule + ':\n  ' + msgs.join('\n  '))
process.exitCode = broken.size ? 1 : 0
