// The office's state: changes for each event, and what it looks like at a given moment.
// Pure: no Claude Code calls, easy to test.

import type { Done, Job, LastJob, Mood, Office, Role, Sec, SecStatus, Todo } from '../types'
import { fmtDuration, plain } from './labels'
import { isMeeting, isStream, isUrgent, isWork } from './moods'
import { AGENT_DESKS, remote } from './world'

export const EMPTY: Office = {
  mood: 'idle', moodText: null, moodAt: 0, plan: false, turnActive: false, jobs: [], last: {}, recent: [], bg: [],
  secs: [], todos: null, compacting: false, lastActivity: 0, order: 0, workMs: 0, party: false,
}

/** A worker with nothing left to do counts as just finished this long (they report it, then are free). */
export const LINGER_MS = 6_000
/** Briefing a new agent keeps the Planner busy this long, though the Agent call runs until the agent is done. */
export const BRIEF_MS = 2_000
/** A finished secretary cheers this long, then walks out. */
export const CHEER_MS = 4_000
/** A red ✗ stays this long. */
export const ERROR_MS = 5_000
/** "Done!" shows this long, then the Manager is on a break. */
export const DONE_MS = 8_000
/**
 * The party (round 6; easier to earn, Nov 2026): a done turn of PARTY_TURN_MS or more, or PARTY_TOTAL_MS of work
 * over the turns since the last party. "Done!" then lasts PARTY_MS. A party the next turn cut off before
 * PARTY_SEEN_MS is owed: the next done turn has it.
 */
export const PARTY_TURN_MS = 120_000
export const PARTY_TOTAL_MS = 300_000
export const PARTY_MS = 15_000
export const PARTY_SEEN_MS = 4_000
/** After Esc everyone stands still this long, then walks out. */
export const STOP_MS = 3_000
/** Night falls in the window after this long with nothing happening. */
export const NIGHT_MS = 10 * 60_000
/** A call running this long was lost (the mod reloaded mid-call): it no longer counts. */
export const STALE_MS = 10 * 60_000
/** The most secretaries kept on record. */
const MAX_SECS = 60
/**
 * Human pace (approved round 4): a tool call takes a tenth of a second, too quick to see. The picture and the list
 * show each job at least MIN_SHOW; a burst is worked one after another, never more than MAX_LAG behind.
 */
export const MIN_SHOW = 2_500
export const MAX_LAG = 6_000
/** Finished calls kept for the pace. */
const MAX_RECENT = 30

export const ROLES: readonly Role[] = ['archivist', 'typist', 'it', 'courier', 'researcher', 'planner', 'librarian']
/** Everyone's name (approved round 8: the user named them; Paige, the Librarian, was Claude's pick). */
export const NAME: Record<Role | 'manager', string> = {
  manager: 'Claude', archivist: 'Susan', typist: 'Mary-Beth', it: 'Lauren', courier: 'John', researcher: 'Leo', planner: 'Molly', librarian: 'Paige',
}
const JOB_WORD: Record<Role | 'manager', string> = {
  manager: 'boss', archivist: 'files', typist: 'edit', it: 'IT', courier: 'mail', researcher: 'web', planner: 'plan', librarian: 'skill',
}
/** What the list calls each one (approved round 8, "Name and job"): "Lauren · IT". */
export const WHO = Object.fromEntries(Object.entries(NAME).map(([k, n]) => [k, n + ' · ' + JOB_WORD[k as Role | 'manager']])) as Record<Role | 'manager', string>

/** How a list line or bubble reads: plain, dim, warning, failure, success. */
export type Tone = '' | 'warn' | 'bad' | 'good' | 'idle'

/** Text made safe for a bubble: ASCII (accents dropped), at most `n` characters, ".." where it was cut. */
export const ascii = (s: string, n: number): string => {
  const a = plain(s)
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
  // The agents' eight looks (LOOK.sec in art/looks.ts, same order).
  sec: ['#ff5f5f', '#5fafff', '#5f5fd7', '#afd700', '#00d7d7', '#a0a8b4', '#d75fd7', '#af005f'],
} as const
/** How many looks agents have: more than the 6 that can be in the office at once (2 desks, 3 in line, 1 walking out). */
export const SEC_LOOKS = DOT.sec.length
export const secDot = (n: number): string => DOT.sec[((n % SEC_LOOKS) + SEC_LOOKS) % SEC_LOOKS] ?? DOT.wait

/* ===== changes ===== */

export const setMood = (o: Office, mood: Mood, now: number, text: string | null = null): Office => ({ ...o, mood, moodText: text, moodAt: now, lastActivity: now })

/**
 * A main turn starts: the Manager wakes; old results are gone. (Finished secretaries stay on record: one woken again
 * later gets its desk back; `view` hides them once they have cheered.)
 */
export const startTurn = (o: Office, now: number): Office => {
  // The party: seen, the count of work starts over; cut off by this turn before anyone saw it, it is owed.
  const seen = o.mood !== 'done' || now - o.moodAt >= PARTY_SEEN_MS
  const workMs = !o.party ? (o.workMs ?? 0) : seen ? 0 : Math.max(o.workMs ?? 0, PARTY_TOTAL_MS)
  return { ...o, turnActive: true, mood: 'think', moodText: null, moodAt: now, lastActivity: now, jobs: [], last: {}, recent: [], workMs, party: false }
}

/** A main turn ends: answered, stopped with Esc, refused, or failed. */
export const endTurn = (o: Office, reason: string, aborted: boolean, durationMs: number, now: number): Office => {
  // (A refusal is no "Done!": the Manager has something to tell you, as after an error.)
  const mood: Mood = aborted || reason === 'aborted' ? 'stopped' : reason === 'error' || reason === 'refusal' ? 'hold' : 'done'
  const text =
    mood === 'done' ? 'Done in ' + fmtDuration(durationMs)
    : mood === 'hold' ? (o.mood === 'hold' ? o.moodText : reason === 'refusal' ? 'On hold · refused' : 'Stopped on an error')
    : null
  // Every turn's time counts toward the party (stopped and failed ones too); only a done turn has one. (By the
  // seconds the line shows: "Done in 2m 0s" is a party.)
  const workMs = (o.workMs ?? 0) + Math.max(0, durationMs)
  const party = mood === 'done' && (Math.round(durationMs / 1000) * 1000 >= PARTY_TURN_MS || workMs >= PARTY_TOTAL_MS)
  return { ...o, turnActive: false, jobs: [], compacting: false, mood, moodText: text, moodAt: now, lastActivity: now, workMs, party }
}

/**
 * A tool call ended (`agent`: whose call, undefined for the Manager's own), so the dialog that waited on it is
 * answered: "Your OK?" asked for a call of `askedBy` (undefined: the Manager's own) goes when a call of theirs ends;
 * "Question?" put up by a notice (an MCP server or a teammate asking; `asking`: an AskUserQuestion call is open, which
 * ends its own) goes when one of the Manager's calls ends.
 */
export const afterCall = (o: Office, now: number, agent: string | undefined, askedBy: string | undefined, asking: boolean): Office =>
  (o.mood === 'permission' && agent === askedBy) || (o.mood === 'ask' && agent === undefined && !asking) ? setMood(o, 'work', now) : o

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
  // (A briefing is not paced: it is busy BRIEF_MS anyway.)
  const recent: Done[] = job?.brief
    ? (o.recent ?? [])
    : [...(o.recent ?? []), { role, short: last.short, full: last.full, startedAt: job?.startedAt ?? last.endedAt, endedAt: last.endedAt, ...(last.err || last.denied ? { err: true } : {}) }].slice(-MAX_RECENT)
  return { ...o, jobs: o.jobs.filter(j => j.id !== id), last: { ...o.last, [role]: done }, recent, lastActivity: last.endedAt }
}

/** A job as shown: from `s` to `e`. */
type Shown = { short: string; full: string; s: number; e: number }

/**
 * A role's jobs (this turn's finished ones and those running) as shown at a human pace. A failure is not paced (it
 * shows at once, as it is, and never as done), and it ends the show of what finished before it (`failedAt`).
 */
function paced(o: Office, role: Role, now: number, failedAt: number): Shown[] {
  // The turn is over: what was left ends with it (never before the job itself did).
  const cut = o.turnActive ? Infinity : o.moodAt
  const all = [
    ...(o.recent ?? []).filter(d => d.role === role && !d.err && d.endedAt > failedAt).map(d => ({ short: d.short, full: d.full, start: d.startedAt, end: d.endedAt })),
    ...o.jobs.filter(j => j.role === role && !j.brief && now - j.startedAt < STALE_MS).map(j => ({ short: j.short, full: j.full, start: j.startedAt, end: Infinity })),
  ].sort((a, b) => a.start - b.start)
  let free = -Infinity
  let busy = -Infinity
  const out: Shown[] = []
  for (const j of all) {
    // Started while another really ran: at the same time ("x3"). Else after the one before, but never more than
    // MAX_LAG late (then they show at once: "x2").
    const s = j.start < busy ? j.start : Math.max(j.start, Math.min(free, j.start + MAX_LAG))
    const e = Math.min(Math.max(j.end, s + MIN_SHOW), Math.max(cut, j.end))
    free = Math.max(free, e)
    busy = Math.max(busy, j.end)
    out.push({ short: j.short, full: j.full, s, e })
  }
  return out
}

/** At most MAX_SECS on record: the oldest finished ones go first (never one still working or waiting, while any finished is left). */
const capSecs = (secs: Sec[]): Sec[] => {
  while (secs.length > MAX_SECS) {
    const i = secs.findIndex(s => s.status === 'done' || s.status === 'fail')
    secs.splice(Math.max(0, i), 1)
  }
  return secs
}

export const addSec = (o: Office, sec: Omit<Sec, 'order'>): Office => {
  const prev = o.secs.find(s => s.id === sec.id)
  const next: Sec = { ...sec, order: prev?.order ?? o.order }
  return {
    ...o,
    order: prev ? o.order : o.order + 1,
    secs: capSecs([...o.secs.filter(s => s.id !== sec.id), next]),
    lastActivity: sec.startedAt,
  }
}

export const patchSec = (o: Office, id: string, patch: Partial<Sec>): Office =>
  o.secs.some(s => s.id === id) ? { ...o, secs: o.secs.map(s => (s.id === id ? { ...s, ...patch } : s)) } : o

/** How an agent's run ended: a teammate waits for its next message instead of finishing. */
export const endStatus = (reason: string, teammate: boolean): SecStatus =>
  reason === 'answer' ? (teammate ? 'idle' : 'done') : 'fail'

/** A task list's status as the board shows it ('deleted' is gone from the list). */
const taskStatus = (s: unknown): Todo['status'] => (s === 'completed' || s === 'in_progress' ? s : 'pending')

/** TaskCreate made a task: it goes on the board. */
export const addTask = (todos: Todo[] | null, id: string, text: string): Todo[] => [...(todos ?? []).filter(t => t.id !== id), { id, text, status: 'pending' }]

/** TaskUpdate changed a task: its status or words; 'deleted' takes it off the board. */
export const patchTask = (todos: Todo[] | null, id: string, input: Record<string, unknown>): Todo[] | null => {
  if (!todos?.some(t => t.id === id)) return todos
  if (input.status === 'deleted') return todos.filter(t => t.id !== id)
  return todos.map(t =>
    t.id !== id ? t : { ...t, ...(input.status ? { status: taskStatus(input.status) } : {}), ...(typeof input.subject === 'string' && input.subject ? { text: input.subject } : {}) },
  )
}

/** TaskList's answer: the whole task list. */
export const tasksFrom = (result: unknown): Todo[] | null => {
  const tasks = (result as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(tasks)) return null
  return tasks.flatMap(t => {
    const x = t as { id?: unknown; subject?: unknown; status?: unknown }
    return typeof x.id === 'string' && typeof x.subject === 'string' && x.subject ? [{ id: x.id, text: x.subject, status: taskStatus(x.status) }] : []
  })
}

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
  /** A party is on: the turn that just ended earned one (see PARTY_TURN_MS), for as long as "Done!" shows. */
  party: boolean
  /** Secretaries in the office now: working, waiting for a message, or just finished. */
  secs: Sec[]
  todos: Todo[] | null
  bg: string[]
  /** The Typist's finished edits this turn, failed and refused ones left out (round 11: pages pile up on the desk). */
  edits: number
  /** How full the memory (context) is, 0–100 (round 11: the cooler's bottle); 0 while unknown. */
  context: number
}

/**
 * Round 11: the rows of water left in the cooler's bottle (4 full … 0 empty) when the memory is `used` percent full.
 * The stored figure changes only when this does.
 */
export const bottleLeft = (used: number): number => Math.max(0, Math.min(4, Math.round(((100 - used) / 100) * 4)))

const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many)

/** The mood as it really is now (Calm decides what shows). */
export function realMood(o: Office, now: number): ShownMood {
  const since = now - o.moodAt
  let mood: ShownMood = o.mood
  if (mood === 'done' && since > (o.party ? PARTY_MS : DONE_MS)) mood = 'idle'
  if (mood === 'stopped' && since > STOP_MS) mood = 'idle'
  if (!o.turnActive && isStream(mood)) mood = 'idle'
  if (o.plan && isStream(mood)) mood = 'plan'
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
  /** When each worker's last failure this turn ended. */
  const lastFailure: Partial<Record<Role, number>> = {}
  for (const d of o.recent ?? []) if (d.err) lastFailure[d.role] = Math.max(lastFailure[d.role] ?? -Infinity, d.endedAt)
  for (const role of ROLES) {
    const mine = o.jobs.filter(j => j.role === role && now - j.startedAt < STALE_MS)
    // A briefing is work for BRIEF_MS; then it counts as finished, though its call still runs.
    const jobs = mine.filter(j => !j.brief || now < briefEnd(j))
    const briefed = mine.filter(j => j.brief && now >= briefEnd(j)).reduce<Job | null>((a, j) => (a && briefEnd(a) >= briefEnd(j) ? a : j), null)
    const prev = o.last[role]
    const last: LastJob | undefined =
      briefed && (!prev || prev.endedAt < briefEnd(briefed)) ? { short: briefed.short, full: briefed.full, err: false, denied: false, endedAt: briefEnd(briefed) } : prev
    // A failure (or your "no") shows red for ERROR_MS and is never "just done": no ✓, no report, no green lamp.
    const failed = !!last && (last.err || last.denied)
    const failedAt = Math.max(failed ? last!.endedAt : -Infinity, lastFailure[role] ?? -Infinity)
    const newest = jobs[jobs.length - 1]
    if (newest) {
      const first = Math.min(...jobs.map(j => j.startedAt))
      // Several at once: "auth.ts x3"; agents briefed together (Claude often starts them in parallel): "agents x3".
      const many = (s: string) => ascii(s, 10 - (' x' + jobs.length).length) + ' x' + jobs.length
      const short = jobs.length < 2 ? newest.short : jobs.every(j => j.brief) ? many('agents') : many(newest.short)
      workers[role] = { role, state: 'work', short, full: newest.full, jobs: jobs.map(j => j.full), since: first }
      if (jobs.every(j => j.brief)) workers[role]!.note = 'brief'
    } else if (last && failed && now - last.endedAt < ERROR_MS) {
      workers[role] = { role, state: 'error', short: last.denied ? 'No!' : 'Failed', full: (last.denied ? '✗ you said no: ' : '✗ failed: ') + last.full, jobs: [], since: last.endedAt }
    } else if (last && !failed && now - last.endedAt < LINGER_MS) {
      workers[role] = { role, state: 'linger', short: '', full: '✓ ' + last.full, jobs: [], since: last.endedAt }
    }
    // The human pace: each job shows a while, a burst one after another. A failure shows at once, as it is; so does a
    // briefing (busy BRIEF_MS anyway).
    const real = workers[role]
    if (real?.state === 'error' || jobs.some(j => j.brief)) continue
    const shown = paced(o, role, now, failedAt)
    const on = shown.filter(j => j.s <= now && now < j.e)
    const top = on[on.length - 1]
    const ended = shown.filter(j => j.e <= now).reduce<Shown | null>((a, j) => (a && a.e >= j.e ? a : j), null)
    if (top) {
      const many = (s: string) => ascii(s, 10 - (' x' + on.length).length) + ' x' + on.length
      workers[role] = { role, state: 'work', short: on.length < 2 ? top.short : many(top.short), full: top.full, jobs: on.map(j => j.full), since: Math.min(...on.map(j => j.s)) }
    } else if (ended && now - ended.e < LINGER_MS && !(real && real.since > ended.e))
      workers[role] = { role, state: 'linger', short: '', full: '✓ ' + ended.full, jobs: [], since: ended.e }
    // (Else as it really is: nothing, or a briefing that finished later.)
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
      line = night ? 'Gone home · idle ' + Math.floor((now - o.lastActivity) / 60_000) + 'm' : 'On a break · back when you type'
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
  // Compacting: everyone stepped out while the Janitor cleans (unless the Manager is needed or just finished).
  if (o.compacting && !isUrgent(mood)) {
    line = 'Stepped out while the Janitor cleans'
    tone = ''
  }
  let edits = 0
  for (const d of o.recent ?? []) if (d.role === 'typist' && !d.err) edits++
  return { now, mood, planning: o.plan, line, tone, frozen, night, workers, janitor: o.compacting, party: !!o.party && mood === 'done', secs, todos: o.todos, bg: o.bg, edits, context: o.context ?? 0 }
}

/* ===== the list under the office ===== */

/**
 * One row of the list. For when rows run out (see fitRows): `rank` — how much it matters, kept first (0 the Manager,
 * 1 a failure, 2 at work, 3 waiting or cleaning, 4 just done, 5 free, 6 background and the to-do count); `free` — a
 * staff member with no job (their name), who may share one line with the others (`group`: where they are, in a
 * word); `sub` — one of a worker's several jobs, and `merged` — the worker's line with all of them on it.
 */
export type Line = { dot: string; who: string; what: string; tone: Tone; rank?: number; free?: string; group?: string; sub?: boolean; merged?: string; name?: string }

const secTone = (s: Sec): Tone => (s.status === 'done' ? 'good' : s.status === 'fail' ? 'bad' : s.status === 'idle' ? 'warn' : '')
const secRank = (s: Sec): number => (s.status === 'run' ? 2 : s.status === 'fail' ? 1 : 4)
const secWhat = (s: Sec): string =>
  s.name + ' · ' + (s.status === 'done' ? '✓ done: ' + s.task : s.status === 'fail' ? '✗ stopped: ' + s.task : s.status === 'idle' ? 'waiting for a message' : s.full)

/** Where the staff with no job are, in a word, when the list can't say what each one does. */
export function freeWords(v: View): string {
  if (v.janitor) return 'stepped out'
  if (v.night) return 'gone home'
  if (v.planning && isMeeting(v.mood)) return 'at the board'
  return isWork(v.mood) ? 'at their desks' : 'on a break'
}

/**
 * The list (approved round 4: "Everyone, fixed order"): the Manager, then every staff member on their own line, always,
 * in the same order — their job, what they just did, or what they do meanwhile (`doing`; without it, `freeWords`) —
 * then the Janitor, the agents at desks, the line at the door, the to-do count.
 * `seated` is the secretaries at desks in desk order; without it (no picture) the first two are, at the agents' desks
 * in the order they are taken (`AGENT_DESKS`). `lookOf` gives an agent's look in the picture, so their dot matches
 * their clothes.
 */
export function lines(
  v: View, seated?: readonly (string | null)[], doing?: (r: Role) => string, lookOf?: (id: string) => number | undefined, closing = false,
): Line[] {
  // (Night with the Manager still in, `closing`: "Closing up" until the door shuts behind them.)
  const boss = closing ? v.line.replace('Gone home', 'Closing up') : v.line
  const out: Line[] = [{ dot: DOT.manager, who: WHO.manager, what: boss, tone: v.tone, rank: 0, name: NAME.manager }]
  for (const r of ROLES) {
    const w = v.workers[r]
    // Working from home (approved round 6): on a call while they have a job.
    if (w && remote(r) && w.state !== 'error') {
      out.push({ dot: DOT[r], who: WHO[r], name: NAME[r], what: (w.state === 'linger' ? w.full : w.jobs.length > 1 ? w.jobs.length + ' at once: ' + w.jobs.join(' · ') : w.full) + ' (on a call)', tone: w.state === 'linger' ? 'idle' : '', rank: w.state === 'linger' ? 4 : 2 })
      continue
    }
    if (!w) out.push({ dot: DOT[r], who: WHO[r], name: NAME[r], what: doing?.(r) ?? freeWords(v), tone: 'idle', rank: 5, free: NAME[r], group: freeWords(v) })
    else if (w.state === 'work' && w.jobs.length > 1) {
      out.push({ dot: DOT[r], who: WHO[r], name: NAME[r], what: w.jobs.length + ' at once', tone: '', rank: 2, merged: w.jobs.length + ' at once: ' + w.jobs.join(' · ') })
      w.jobs.slice(0, 3).forEach(j => out.push({ dot: '', who: '', what: '└ ' + j, tone: '', rank: 2, sub: true }))
      if (w.jobs.length > 3) out.push({ dot: '', who: '', what: '└ +' + (w.jobs.length - 3) + ' more', tone: 'idle', rank: 2, sub: true })
    } else out.push({ dot: DOT[r], who: WHO[r], name: NAME[r], what: w.full, tone: w.state === 'error' ? 'bad' : w.state === 'linger' ? 'idle' : '', rank: w.state === 'error' ? 1 : w.state === 'linger' ? 4 : 2 })
    if (r === 'it' && v.bg.length) out.push({ dot: '', who: '', what: '└ ' + plural(v.bg.length, 'command', 'commands') + ' running in background', tone: 'idle', rank: 6 })
  }
  if (v.janitor) out.push({ dot: DOT.janitor, who: 'Janitor', what: 'Tidying memory (compacting)', tone: '', rank: 3 })
  const atDesk = seated ? v.secs.filter(s => seated.includes(s.id)) : v.secs.slice(0, AGENT_DESKS.length)
  const deskOf = (s: Sec) => (seated ? seated.indexOf(s.id) : AGENT_DESKS[atDesk.indexOf(s)]!)
  for (const s of [...atDesk].sort((a, b) => deskOf(a) - deskOf(b)))
    out.push({ dot: secDot(lookOf?.(s.id) ?? s.order), who: 'Desk ' + (deskOf(s) + 1), what: secWhat(s), tone: secTone(s), rank: secRank(s) })
  const waiting = v.secs.length - atDesk.length
  if (waiting > 0) out.push({ dot: DOT.wait, who: 'In line', what: plural(waiting, 'agent waits', 'agents wait') + ' for a free desk', tone: 'warn', rank: 3 })
  if (v.todos && v.todos.length) {
    const done = v.todos.filter(t => t.status === 'completed').length
    const now = v.todos.find(t => t.status === 'in_progress')
    out.push({ dot: '', who: 'To-do', what: done + '/' + v.todos.length + (now ? ' · ' + now.text : ''), tone: 'idle', rank: 6 })
  }
  return out
}

/* ===== the list, wrapped to the pane ===== */

/** The name column: always this wide (it never shrinks for a long line); "Mary-Beth · edit" and a space. */
export const WHO_W = 17
/** The dot column ("● "). */
export const DOT_W = 2
/** A long line takes at most this many rows. */
const MOST_ROWS = 3

/** A character's width in terminal cells: 2 for wide (CJK, most emoji), 0 for accents and joiners, else 1. */
const widthOf = (c: number): number => {
  if ((c >= 0x300 && c <= 0x36f) || c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  if (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
    return 2
  return 1
}
export const cellWidth = (ch: string): number => widthOf(ch.codePointAt(0) ?? 0)
/** A text's width in terminal cells (character by character, with no list of them made). */
export const textWidth = (s: string): number => {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x300) n++
    else if (c >= 0xd800 && c <= 0xdfff) {
      // Half of a pair (an emoji): the two count as one character.
      const cp = s.codePointAt(i)!
      n += widthOf(cp)
      if (cp > 0xffff) i++
    } else n += widthOf(c)
  }
  return n
}

/** The longest start of `s` at most `n` cells wide. */
const take = (s: string, n: number): string => {
  let out = ''
  let w = 0
  for (const ch of s) {
    if (w + cellWidth(ch) > n) break
    w += cellWidth(ch)
    out += ch
  }
  return out
}

/**
 * One list line as rows of a list `width` cells wide: the words go on below, under the words (not under the
 * name), breaking after a space or a "/" in a path, never inside a name; at most `most` rows (3), the last ending "…".
 */
export function wrapLine(l: Line, width: number, most = MOST_ROWS): Line[] {
  const room = Math.max(8, width - DOT_W - WHO_W)
  // (Most lines fit one row as they are.)
  if (textWidth(l.what) <= room) return [{ ...l, what: l.what.trimEnd() }]
  const rows: string[] = []
  let cur = ''
  for (const word of l.what.split(/(?<= )|(?<=\/)/)) {
    if (textWidth(cur + word.trimEnd()) <= room) {
      cur += word
      continue
    }
    if (cur.trimEnd()) rows.push(cur.trimEnd())
    cur = word
    // One word wider than the row: cut where it must be.
    while (textWidth(cur.trimEnd()) > room) {
      const piece = take(cur, room)
      rows.push(piece)
      cur = cur.slice(piece.length)
    }
  }
  if (cur.trimEnd() || !rows.length) rows.push(cur.trimEnd())
  if (rows.length > most) {
    rows.length = most
    rows[most - 1] = take(rows[most - 1]!, room - 2).trimEnd() + ' …'
  }
  return rows.map((what, i) => (i ? { dot: '', who: '', what, tone: l.tone } : { ...l, what }))
}

/** Names that fit `room` cells: "Archivist, Typist +3". */
function nameList(names: string[], room: number): string {
  for (let k = names.length; k > 0; k--) {
    const s = names.slice(0, k).join(', ') + (k < names.length ? ' +' + (names.length - k) : '')
    if (textWidth(s) <= room) return s
  }
  return '+' + names.length
}

/**
 * The lines as rows of a list `width` wide, in at most `max` rows. Everyone keeps their own line as long as at all
 * possible; with too few rows, step by step:
 *  1. long lines wrap to three rows, then two, then one (cut with "…"; the Manager keeps two);
 *  2. a worker's several jobs share their one line ("3 at once: Read a.ts · Read b.ts");
 *  3. the staff with no job share one line that still names them ("Others  Courier, Planner · on a break", or
 *     "Staff  all gone home");
 *  4. the least important go (to-do, background, the free, just done …; never the Manager), and the last row names
 *     who is left out ("+2 more  To-do, Desk 4").
 */
export function fitRows(all: Line[], width: number, max: number): Line[] {
  if (max <= 0) return []
  const lay = (ls: Line[], most: number) => ls.flatMap(l => wrapLine(l, width, l.rank === 0 ? Math.max(most, 2) : most))
  for (const most of [MOST_ROWS, 2, 1]) {
    const rows = lay(all, most)
    if (rows.length <= max) return rows
  }
  let ls = all.filter(l => !l.sub).map(l => (l.merged ? { ...l, what: l.merged } : l))
  if (lay(ls, 1).length <= max) return lay(ls, 1)
  const free = ls.filter(l => l.free)
  if (free.length > 1) {
    const room = Math.max(8, width - DOT_W - WHO_W)
    const where = free.every(l => l.what === free[0]!.what) ? free[0]!.what : (free[0]!.group ?? 'free')
    const everyone = free.length === ROLES.length
    const names = free.map(l => l.free!)
    // Who comes first: every name with where they are, else every name, else as many names as fit ("+2").
    const list = names.join(', ')
    const what = everyone ? 'all ' + where : textWidth(list + ' · ' + where) <= room ? list + ' · ' + where : textWidth(list) <= room ? list : nameList(names, room)
    const one: Line = { dot: '', who: everyone ? 'Staff' : 'Others', what, tone: 'idle', rank: 5, free: list }
    const first = ls.indexOf(free[0]!)
    ls = ls.filter(l => !l.free)
    ls.splice(first, 0, one)
  }
  const rows = lay(ls, 1)
  if (rows.length <= max) return rows
  if (max === 1) return rows.slice(0, 1)
  // The most important first (the Manager, failures, work …), each in its own place; the last row for who is left out.
  const order = ls.map((_, i) => i).sort((a, b) => (ls[a]!.rank ?? 2) - (ls[b]!.rank ?? 2) || a - b)
  const keep = new Map<number, number>()
  let used = 1
  for (const i of order) {
    const l = ls[i]!
    // (The Manager keeps a second row only if there is room for it.)
    const n = Math.min(wrapLine(l, width, l.rank === 0 ? 2 : 1).length, max - used)
    if (n < 1) continue
    keep.set(i, n)
    used += n
  }
  const kept = ls.flatMap((l, i) => (keep.has(i) ? wrapLine(l, width, keep.get(i)) : []))
  const gone = ls.filter((_, i) => !keep.has(i)).flatMap(l => (l.free ? l.free.split(', ') : l.name ? [l.name] : l.who ? [l.who] : ['background']))
  if (!gone.length) return kept
  return [...kept, { dot: '', who: '+' + gone.length + ' more', what: nameList(gone, Math.max(8, width - DOT_W - WHO_W)), tone: 'idle', rank: 6 }]
}
