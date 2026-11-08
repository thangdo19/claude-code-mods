// The office's state: changes for each event, and what it looks like at a given moment.
// Pure: no Claude Code calls, easy to test.

import type { Job, LastJob, Mood, Office, Role, Sec, SecStatus, Todo } from '../types'
import { fmtDuration } from './labels'

export const EMPTY: Office = {
  mood: 'idle', moodText: null, moodAt: 0, plan: false, turnActive: false, jobs: [], last: {}, bg: [],
  secs: [], todos: null, compacting: false, lastActivity: 0, order: 0,
}

/** A worker with nothing left to do counts as just finished this long (they report it, then are free). */
export const LINGER_MS = 6_000
/** Briefing a new agent keeps the Planner busy this long, though the Agent call runs until the agent is done. */
export const BRIEF_MS = 2_000
/** A finished secretary cheers this long, then walks out. */
export const CHEER_MS = 4_000
/** A red ✗ stays this long. */
export const ERROR_MS = 5_000
/** "Done!" shows this long, then the Manager naps. */
export const DONE_MS = 8_000
/** After Esc everyone stands still this long, then walks out. */
export const STOP_MS = 3_000
/** Night falls in the window after this long with nothing happening. */
export const NIGHT_MS = 10 * 60_000
/** A call running this long was lost (the mod reloaded mid-call): it no longer counts. */
export const STALE_MS = 10 * 60_000
/** The most secretaries kept on record. */
const MAX_SECS = 60

export const ROLES: readonly Role[] = ['archivist', 'typist', 'it', 'courier', 'researcher', 'planner', 'librarian']
export const ROLE_NAME: Record<Role, string> = {
  archivist: 'Archivist', typist: 'Typist', it: 'IT tech', courier: 'Courier', researcher: 'Researcher', planner: 'Planner', librarian: 'Librarian',
}

/** How a list line or bubble reads: plain, dim, warning, failure, success. */
export type Tone = '' | 'warn' | 'bad' | 'good' | 'idle'

/** Text made safe for a bubble: ASCII, at most `n` characters, ".." where it was cut. */
export const ascii = (s: string, n: number): string => {
  const a = s
    .replace(/[…]/g, '...')
    .replace(/[×]/g, 'x')
    .replace(/[·•]/g, '-')
    .replace(/[✓✔]/g, 'ok')
    .replace(/[✗✘]/g, 'x')
    .replace(/[^\x20-\x7e]/g, '?')
  return a.length <= n ? a : a.slice(0, Math.max(0, n - 2)) + '..'
}

/** The list's dot color for each person: the color of their clothes. */
export const DOT = {
  manager: '#d7875f', archivist: '#af87d7', typist: '#d787af', it: '#00afaf', courier: '#ff8700', janitor: '#5f87d7', wait: '#8a8a8a',
  researcher: '#d7af00', planner: '#87af5f', librarian: '#af875f',
  // The agents' eight looks (LOOK.sec in big-sprites.ts, same order).
  sec: ['#ff5f5f', '#5fafff', '#5f5fd7', '#afd700', '#00d7d7', '#a0a8b4', '#d75fd7', '#af005f'],
} as const
/** How many looks agents have: up to 8 can be in the office at once (4 desks, 3 in line, 1 walking out). */
export const SEC_LOOKS = DOT.sec.length
export const secDot = (n: number): string => DOT.sec[((n % SEC_LOOKS) + SEC_LOOKS) % SEC_LOOKS] ?? DOT.wait

/* ===== changes ===== */

export const setMood = (o: Office, mood: Mood, now: number, text: string | null = null): Office => ({ ...o, mood, moodText: text, moodAt: now, lastActivity: now })

/** A main turn starts: the Manager wakes; finished secretaries and old results are gone. */
export const startTurn = (o: Office, now: number): Office => ({
  ...o,
  turnActive: true,
  mood: 'think',
  moodText: null,
  moodAt: now,
  lastActivity: now,
  jobs: [],
  last: {},
  secs: o.secs.filter(s => s.status === 'run' || s.status === 'idle'),
})

/** A main turn ends: answered, stopped with Esc, or failed. */
export const endTurn = (o: Office, reason: string, aborted: boolean, durationMs: number, now: number): Office => {
  const mood: Mood = aborted || reason === 'aborted' ? 'stopped' : reason === 'error' ? 'hold' : 'done'
  const text = mood === 'done' ? 'Done in ' + fmtDuration(durationMs) : mood === 'hold' ? (o.mood === 'hold' ? o.moodText : 'Stopped on an error') : null
  return { ...o, turnActive: false, jobs: [], compacting: false, mood, moodText: text, moodAt: now, lastActivity: now }
}

export const startJob = (o: Office, job: Job): Office => ({ ...o, jobs: [...o.jobs.filter(j => j.id !== job.id), job].slice(-40), lastActivity: job.startedAt })

/** When a brief job counts as finished: BRIEF_MS after it started. */
const briefEnd = (j: Job): number => j.startedAt + BRIEF_MS

export const endJob = (o: Office, id: string, role: Role, last: LastJob): Office => {
  const job = o.jobs.find(j => j.id === id)
  // A briefing long over (its agent ran; now the call returns) was already finished and reported:
  // it finishes again only when it failed. The newer finish is kept.
  let done = last
  if (job?.brief && !last.err && !last.denied && last.endedAt >= briefEnd(job)) {
    const prev = o.last[role]
    done = prev && prev.endedAt >= briefEnd(job) ? prev : { ...last, endedAt: briefEnd(job) }
  }
  return { ...o, jobs: o.jobs.filter(j => j.id !== id), last: { ...o.last, [role]: done }, lastActivity: last.endedAt }
}

export const addSec = (o: Office, sec: Omit<Sec, 'order'>): Office => {
  const prev = o.secs.find(s => s.id === sec.id)
  const next: Sec = { ...sec, order: prev?.order ?? o.order }
  return {
    ...o,
    order: prev ? o.order : o.order + 1,
    secs: [...o.secs.filter(s => s.id !== sec.id), next].slice(-MAX_SECS),
    lastActivity: sec.startedAt,
  }
}

export const patchSec = (o: Office, id: string, patch: Partial<Sec>): Office =>
  o.secs.some(s => s.id === id) ? { ...o, secs: o.secs.map(s => (s.id === id ? { ...s, ...patch } : s)) } : o

/** How an agent's run ended: a teammate waits for its next message instead of finishing. */
export const endStatus = (reason: string, teammate: boolean): SecStatus =>
  reason === 'answer' ? (teammate ? 'idle' : 'done') : 'fail'

/** TodoWrite's list. */
export const todosFrom = (input: Record<string, unknown>): Todo[] | null => {
  if (!Array.isArray(input.todos)) return null
  return input.todos.flatMap(t => {
    const x = t as { content?: unknown; status?: unknown; activeForm?: unknown }
    const text = typeof x.content === 'string' ? x.content : ''
    const status = x.status === 'completed' || x.status === 'in_progress' ? x.status : 'pending'
    return text ? [{ text, status }] : []
  })
}

/* ===== what it looks like now ===== */

/** `note`: 'reply' — the Typist types Claude's reply (no tool call); 'brief' — only briefings (the Planner). */
export type Worker = { role: Role; state: 'work' | 'linger' | 'error'; short: string; full: string; jobs: string[]; since: number; note?: 'reply' | 'brief' }
export type ShownMood = Mood | 'plan'

export type View = {
  /** The moment this view is of. */
  now: number
  mood: ShownMood
  /** Plan mode is on (the meeting at the board lasts through its dialogs). */
  planning: boolean
  /** The Manager's list line. */
  line: string
  tone: Tone
  /** Esc: nobody moves for a moment. */
  frozen: boolean
  night: boolean
  workers: Partial<Record<Role, Worker>>
  janitor: boolean
  /** Secretaries in the office now: working, waiting for a message, or just finished. */
  secs: Sec[]
  todos: Todo[] | null
  bg: string[]
}

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many)

/** The mood as it really is now (Calm decides what shows). */
export function realMood(o: Office, now: number): ShownMood {
  const since = now - o.moodAt
  let mood: ShownMood = o.mood
  if (mood === 'done' && since > DONE_MS) mood = 'idle'
  if (mood === 'stopped' && since > STOP_MS) mood = 'idle'
  if (!o.turnActive && (mood === 'think' || mood === 'write' || mood === 'work')) mood = 'idle'
  if (o.plan && (mood === 'think' || mood === 'write' || mood === 'work')) mood = 'plan'
  return mood
}

/** What the office looks like at `now`; `calm` turns the real mood into the shown one. */
export function view(o: Office, now: number, calm?: (real: ShownMood) => ShownMood): View {
  const since = now - o.moodAt
  const real = realMood(o, now)
  const mood = calm ? calm(real) : real
  const frozen = o.mood === 'stopped' && since <= STOP_MS
  // A new session has done nothing yet: its 10 minutes start when it does.
  const night = !o.turnActive && o.lastActivity > 0 && now - o.lastActivity > NIGHT_MS

  const workers: Partial<Record<Role, Worker>> = {}
  for (const role of ROLES) {
    const mine = o.jobs.filter(j => j.role === role && now - j.startedAt < STALE_MS)
    // A briefing is work for BRIEF_MS; then it counts as finished, though its call still runs.
    const jobs = mine.filter(j => !j.brief || now < briefEnd(j))
    const briefed = mine.filter(j => j.brief && now >= briefEnd(j)).reduce<Job | null>((a, j) => (a && briefEnd(a) >= briefEnd(j) ? a : j), null)
    const prev = o.last[role]
    const last: LastJob | undefined =
      briefed && (!prev || prev.endedAt < briefEnd(briefed)) ? { short: briefed.short, full: briefed.full, err: false, denied: false, endedAt: briefEnd(briefed) } : prev
    const newest = jobs[jobs.length - 1]
    if (newest) {
      const first = Math.min(...jobs.map(j => j.startedAt))
      // Several at once: "auth.ts x3"; agents briefed together (Claude often starts them in parallel): "agents x3".
      const many = (s: string) => ascii(s, 10 - (' x' + jobs.length).length) + ' x' + jobs.length
      const short = jobs.length < 2 ? newest.short : jobs.every(j => j.brief) ? many('agents') : many(newest.short)
      workers[role] = { role, state: 'work', short, full: newest.full, jobs: jobs.map(j => j.full), since: first }
      if (jobs.every(j => j.brief)) workers[role]!.note = 'brief'
    } else if (last && (last.err || last.denied) && now - last.endedAt < ERROR_MS) {
      workers[role] = { role, state: 'error', short: last.denied ? 'No!' : 'Failed', full: (last.denied ? '✗ you said no: ' : '✗ failed: ') + last.full, jobs: [], since: last.endedAt }
    } else if (last && now - last.endedAt < LINGER_MS) {
      workers[role] = { role, state: 'linger', short: '', full: '✓ ' + last.full, jobs: [], since: last.endedAt }
    }
  }

  // Claude writes its reply: the Manager dictates, the Typist types it (unless busy with a file).
  if (mood === 'write' && workers.typist?.state !== 'work')
    workers.typist = { role: 'typist', state: 'work', short: 'reply', full: 'Typing the reply', jobs: [], since: o.moodAt, note: 'reply' }

  const secs = o.secs.filter(s => s.status === 'run' || s.status === 'idle' || (s.endedAt !== null && now - s.endedAt < CHEER_MS))
  const running = o.secs.filter(s => s.status === 'run').length

  let line: string
  let tone: Tone = ''
  switch (mood) {
    case 'idle':
      line = night ? 'Asleep · idle ' + Math.floor((now - o.lastActivity) / 60_000) + 'm' : 'On a break · back when you type'
      tone = 'idle'
      break
    case 'think':
      line = 'Thinking…'
      break
    case 'write':
      line = 'Writing the reply'
      break
    case 'work':
      line = running ? 'Waiting on ' + plural(running, 'agent', 'agents') : Object.keys(workers).length ? 'Handing out work' : 'Working'
      break
    case 'plan':
      line = 'Planning (plan mode)'
      break
    case 'permission':
      line = o.moodText ?? 'Needs your OK'
      tone = 'warn'
      break
    case 'ask':
      line = o.moodText ?? 'Has a question for you'
      tone = 'warn'
      break
    case 'done':
      line = o.moodText ?? 'Done'
      tone = 'good'
      break
    case 'stopped':
      line = 'Stopped by you (Esc)'
      tone = 'bad'
      break
    case 'hold':
      line = o.moodText ?? 'On hold · API busy'
      tone = 'bad'
      break
  }
  return { now, mood, planning: o.plan, line, tone, frozen, night, workers, janitor: o.compacting, secs, todos: o.todos, bg: o.bg }
}

/* ===== the list under the office ===== */

export type Line = { dot: string; who: string; what: string; tone: Tone }

const secTone = (s: Sec): Tone => (s.status === 'done' ? 'good' : s.status === 'fail' ? 'bad' : s.status === 'idle' ? 'warn' : '')
const secWhat = (s: Sec): string =>
  s.name + ' · ' + (s.status === 'done' ? '✓ done: ' + s.task : s.status === 'fail' ? '✗ stopped: ' + s.task : s.status === 'idle' ? 'waiting for a message' : s.full)

/**
 * One line per person, busiest first: the Manager, the workers, the janitor, the
 * secretaries at desks, the line at the door, the to-do list, who is on a break.
 * `seated` is the secretaries at desks in desk order; without it the first four are. `lookOf` gives an agent's
 * look in the picture, so their dot matches their clothes.
 */
export function lines(v: View, seated?: readonly (string | null)[], breakLine?: { who: string; what: string } | null, lookOf?: (id: string) => number | undefined): Line[] {
  const out: Line[] = [{ dot: DOT.manager, who: 'Manager', what: v.line, tone: v.tone }]
  const order: Record<Worker['state'], number> = { work: 0, error: 1, linger: 2 }
  const ws = ROLES.flatMap(r => (v.workers[r] ? [v.workers[r]!] : [])).sort((a, b) => order[a.state] - order[b.state])
  for (const w of ws) {
    if (w.state === 'work' && w.jobs.length > 1) {
      out.push({ dot: DOT[w.role], who: ROLE_NAME[w.role], what: w.jobs.length + ' at once', tone: '' })
      w.jobs.slice(0, 3).forEach(j => out.push({ dot: '', who: '', what: '└ ' + j, tone: '' }))
      if (w.jobs.length > 3) out.push({ dot: '', who: '', what: '└ +' + (w.jobs.length - 3) + ' more', tone: 'idle' })
    } else out.push({ dot: DOT[w.role], who: ROLE_NAME[w.role], what: w.full, tone: w.state === 'error' ? 'bad' : w.state === 'linger' ? 'idle' : '' })
  }
  if (v.bg.length) out.push({ dot: v.workers.it ? '' : DOT.it, who: v.workers.it ? '' : 'IT tech', what: plural(v.bg.length, 'command', 'commands') + ' running in background', tone: 'idle' })
  if (v.janitor) out.push({ dot: DOT.janitor, who: 'Janitor', what: 'Tidying memory (compacting)', tone: '' })
  const atDesk = seated ? v.secs.filter(s => seated.includes(s.id)) : v.secs.slice(0, 4)
  const deskOf = (s: Sec) => (seated ? seated.indexOf(s.id) : atDesk.indexOf(s))
  for (const s of [...atDesk].sort((a, b) => deskOf(a) - deskOf(b))) out.push({ dot: secDot(lookOf?.(s.id) ?? s.order), who: 'Desk ' + (deskOf(s) + 1), what: secWhat(s), tone: secTone(s) })
  const waiting = v.secs.length - atDesk.length
  if (waiting > 0) out.push({ dot: DOT.wait, who: 'In line', what: plural(waiting, 'agent waits', 'agents wait') + ' for a free desk', tone: 'warn' })
  if (v.todos && v.todos.length) {
    const done = v.todos.filter(t => t.status === 'completed').length
    const now = v.todos.find(t => t.status === 'in_progress')
    out.push({ dot: '', who: 'To-do', what: done + '/' + v.todos.length + (now ? ' · ' + now.text : ''), tone: 'idle' })
  }
  if (breakLine) out.push({ dot: '', who: breakLine.who, what: breakLine.what, tone: 'idle' })
  return out
}

/** Lines cut to `max`, the last one saying how many were left out. */
export function fitLines(all: Line[], max: number): Line[] {
  if (max <= 0) return []
  if (all.length <= max) return all
  const kept = all.slice(0, Math.max(0, max - 1))
  return [...kept, { dot: '', who: '', what: '+' + (all.length - kept.length) + ' more', tone: 'idle' }]
}
