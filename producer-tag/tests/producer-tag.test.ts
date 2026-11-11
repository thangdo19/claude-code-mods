import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import {
  COOLDOWN_MS,
  LAST_PLAYED_KEY,
  LAST_RELAYED_KEY,
  MIN_WORK_MS,
  mimeOf,
  RELAY_COVER_MS,
  SETTLE_MS,
  TAG,
} from '../hooks/register'

// When every test's clock starts.
const START = Date.parse('2026-10-11T10:00:00Z')

// Answers the engine's side: the classic events, and audio.play recorded instead of heard.
// `agents` is what $.agent.list() answers (null refuses it); `stopAnswer` is
// what the settings hooks beneath Stop answer; `stored` is what the plugin's
// store holds, which every window shares (null refuses it).
function setup(
  on: On,
  agents: AgentInfo[] | null = [],
  stopAnswer: () => { block?: string } = () => ({}),
  stored: Record<string, unknown> | null = {},
) {
  const clock = mock.clock(on, { now: START })
  if (stored) {
    on('store.get', ($, e) => ({ value: stored[e.key] }))
    on('store.set', ($, e) => {
      stored[e.key] = e.value
      return { value: undefined }
    })
  } else {
    on('store.get', () => ({ deny: 'locked' }))
    on('store.set', () => ({ deny: 'locked' }))
  }
  const plays: unknown[] = []
  on('audio.play', ($, e) => {
    plays.push(e)
    return { value: undefined }
  })
  on('agent.list', () => (agents ? { value: agents } : { deny: 'unavailable' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('classic.Stop', () => stopAnswer())
  on('classic.StopFailure', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.Notification', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  return { clock, plays }
}

const stop = { stop_hook_active: false }
const bashApproval = { tool_name: 'Bash', tool_input: { command: 'ls' } }
// What Claude Code sends once a dialog has waited 6s for you: a tool approval or a
// question, a plan, a dialog inside a running tool, a goal Claude proposed.
const permissionNotice = { message: 'Claude needs your permission', notification_type: 'permission_prompt' }
const planReminder = { message: 'Claude Code needs your approval for the plan', notification_type: 'permission_prompt' }
const networkReminder = { message: 'A sandboxed command needs network access', notification_type: 'permission_prompt' }
const goalReminder = { message: 'Claude proposed a session goal', notification_type: 'permission_prompt' }

// One in-flight background task as Stop's `background_tasks` lists it.
const task = (type: string, id = `${type}-1`) => ({ id, type, status: 'running', description: type })
const subagent = task('subagent', 'a1')
const agent = (id: string, more: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  description: 'look around',
  type: 'Explore',
  status: 'running',
  ...more,
})
// A one-time wake-up (ScheduleWakeup) and a repeating schedule (/loop 5m).
const wakeUp = { id: 'c1', schedule: '30 10 11 10 *', recurring: false, prompt: 'check back' }
const everyFive = { id: 'c2', schedule: '*/5 * * * *', recurring: true, prompt: 'poll' }

// Claude works on a turn you did not type (a wake-up), for `ms`.
async function works($: Engine, clock: MockClock, ms = MIN_WORK_MS) {
  await $.turn.start({ text: '', turnId: 't' })
  await clock.advance(ms)
}

// You send a message and Claude works on it for `ms`.
async function asked($: Engine, clock: MockClock, ms = MIN_WORK_MS) {
  await $.classic.UserPromptSubmit({ prompt: 'go' })
  await works($, clock, ms)
}

// Claude works long enough to count, stops, and the short wait for a new turn passes.
async function stopped($: Engine, clock: MockClock, e: Parameters<Engine['classic']['Stop']>[0] = stop) {
  await works($, clock)
  await $.classic.Stop(e)
  await clock.advance(SETTLE_MS)
}

describe('done: only after work of 10s or more', () => {
  test('plays the tag when Claude finishes', async ($, on) => {
    const { clock, plays } = setup(on)
    await stopped($, clock)
    expect(plays).toEqual([expect.objectContaining({ clip: { asset: TAG } })])
  })

  test('a finish waits a moment before it plays', async ($, on) => {
    const { clock, plays } = setup(on)
    await works($, clock)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS - 1)
    expect(plays).toHaveLength(0)
    await clock.advance(1)
    expect(plays).toHaveLength(1)
  })

  test('stays quiet for work under 10s, plays at 10s', async ($, on) => {
    const { clock, plays } = setup(on)
    await asked($, clock, MIN_WORK_MS - 1)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(0)
    await asked($, clock, MIN_WORK_MS)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('the count starts again at your message', async ($, on) => {
    const { clock, plays } = setup(on)
    await asked($, clock, 60_000)
    await asked($, clock, 3000)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(0)
  })

  test('the count runs through a wait for background work', async ($, on) => {
    const { clock, plays } = setup(on, [agent('a1')])
    await asked($, clock, 2000)
    await $.classic.Stop({ ...stop, background_tasks: [subagent] })
    await clock.advance(60_000)
    await works($, clock, 2000)
    await $.classic.Stop({ ...stop, background_tasks: [] })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('a finish a new turn cancelled keeps its count', async ($, on) => {
    const { clock, plays } = setup(on)
    await asked($, clock, MIN_WORK_MS - 1000)
    await $.classic.Stop(stop)
    await clock.advance(100)
    await works($, clock, 1000)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('a short wake-up after the finish stays quiet', async ($, on) => {
    const { clock, plays } = setup(on)
    await stopped($, clock)
    await clock.advance(COOLDOWN_MS)
    await works($, clock, 3000)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('work whose start was not seen plays', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('a failed play does not break the hook', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    mock.store(on)
    on('audio.play', () => {
      throw new Error('no player')
    })
    on('classic.Stop', () => ({ additionalContext: ['kept'] }))
    expect(await $.classic.Stop(stop)).toEqual({ additionalContext: ['kept'] })
    await clock.advance(SETTLE_MS)
  })
})

describe('asks: only a dialog that waits for you', () => {
  test("plays for a dialog's reminder, whatever the dialog", async ($, on) => {
    const { clock, plays } = setup(on)
    for (const reminder of [permissionNotice, planReminder, networkReminder, goalReminder]) {
      await $.classic.Notification(reminder)
      await clock.advance(COOLDOWN_MS)
    }
    expect(plays).toHaveLength(4)
  })

  test('a permission request alone stays quiet: no dialog may follow', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await clock.advance(COOLDOWN_MS)
    await $.classic.PermissionRequest({ tool_name: 'ExitPlanMode', tool_input: { plan: '# plan' } })
    expect(plays).toHaveLength(0)
  })

  test('dialogs that open together play once', async ($, on) => {
    const { plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await $.classic.Notification(permissionNotice)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(1)
  })

  test('an ask in the middle of short work plays, the finish after it does not', async ($, on) => {
    const { clock, plays } = setup(on)
    await asked($, clock, 6000)
    await $.classic.Notification(permissionNotice)
    await clock.advance(1000)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('plays again once the cooldown has passed', async ($, on) => {
    const { clock, plays } = setup(on)
    await stopped($, clock)
    await clock.advance(COOLDOWN_MS)
    await $.classic.Notification(planReminder)
    expect(plays).toHaveLength(2)
  })

  test('stays quiet for the idle nudge', async ($, on) => {
    const { plays } = setup(on)
    await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
    expect(plays).toHaveLength(0)
  })

  test('plays for alerts that need you', async ($, on) => {
    const { clock, plays } = setup(on)
    for (const type of ['elicitation_dialog', 'elicitation_url_dialog', 'worker_permission_prompt', 'agent_needs_input']) {
      await $.classic.Notification({ message: 'needs you', notification_type: type })
      await clock.advance(RELAY_COVER_MS)
    }
    expect(plays).toHaveLength(4)
  })

  test('stays quiet for alerts that do not need you', async ($, on) => {
    const { clock, plays } = setup(on)
    const types = [
      'auth_success',
      'push_notification',
      'computer_use_enter',
      'computer_use_exit',
      'plugin_notification',
      'elicitation_complete',
      'elicitation_response',
      'quota_auto_resume_fired',
      'model_refusal_fallback',
      'something_new',
    ]
    for (const type of types) {
      await $.classic.Notification({ message: 'fyi', notification_type: type })
      await clock.advance(COOLDOWN_MS)
    }
    expect(plays).toHaveLength(0)
  })
})

describe('waiting is not finishing', () => {
  test('stays quiet while a background subagent runs, plays once it is done', async ($, on) => {
    const { clock, plays } = setup(on, [agent('a1')])
    await stopped($, clock, { ...stop, background_tasks: [subagent] })
    expect(plays).toHaveLength(0)
    await stopped($, clock, { ...stop, background_tasks: [] })
    expect(plays).toHaveLength(1)
  })

  test('stays quiet while a workflow, a background command or a monitor runs', async ($, on) => {
    const { clock, plays } = setup(on)
    for (const type of ['workflow', 'shell', 'monitor']) {
      await stopped($, clock, { ...stop, background_tasks: [task(type)] })
    }
    expect(plays).toHaveLength(0)
  })

  test("plays despite Claude Code's own chores and cloud sessions", async ($, on) => {
    const { clock, plays } = setup(on)
    const chores = ['dream', 'auto-mode scan', 'memory import', 'memory save', 'cloud session', 'MCP task', 'teammate']
    await stopped($, clock, { ...stop, background_tasks: chores.map(t => task(t)) })
    expect(plays).toHaveLength(1)
  })

  test("plays despite a plugin's own background agent", async ($, on) => {
    const { clock, plays } = setup(on, [agent('a1', { spawnedBy: 'some-plugin' })])
    await stopped($, clock, { ...stop, background_tasks: [subagent] })
    expect(plays).toHaveLength(1)
  })

  test('stays quiet while a teammate works, plays once it is idle', async ($, on) => {
    const teammate = { teammateId: 'ana@team', type: 'teammate' }
    const agents = [agent('t1', { ...teammate, status: 'running' })]
    const { clock, plays } = setup(on, agents)
    await stopped($, clock)
    expect(plays).toHaveLength(0)
    agents[0] = agent('t1', { ...teammate, status: 'idle' })
    await stopped($, clock)
    expect(plays).toHaveLength(1)
  })

  test('stays quiet with a one-time wake-up pending, not for a repeating schedule', async ($, on) => {
    const { clock, plays } = setup(on)
    await stopped($, clock, { ...stop, session_crons: [wakeUp, everyFive] })
    expect(plays).toHaveLength(0)
    await stopped($, clock, { ...stop, session_crons: [everyFive] })
    expect(plays).toHaveLength(1)
  })

  test('still plays when the agent list cannot be read', async ($, on) => {
    const { clock, plays } = setup(on, null)
    await stopped($, clock)
    expect(plays).toHaveLength(1)
  })

  test('a new main turn right after the finish cancels it', async ($, on) => {
    const { clock, plays } = setup(on)
    await works($, clock)
    await $.classic.Stop(stop)
    await clock.advance(100)
    await $.turn.start({ text: '', turnId: 't2' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(0)
  })

  test("a subagent's turn does not cancel the finish", async ($, on) => {
    const { clock, plays } = setup(on)
    await works($, clock)
    await $.classic.Stop(stop)
    await $.turn.start({ text: '', turnId: 't2', agentId: 'a1' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('a Stop hook that sends Claude back stays quiet; the real finish after it plays', async ($, on) => {
    let block: string | undefined = 'keep going'
    const { clock, plays } = setup(on, [], () => (block ? { block } : {}))
    await stopped($, clock)
    expect(plays).toHaveLength(0)
    block = undefined
    await stopped($, clock, { stop_hook_active: true })
    expect(plays).toHaveLength(1)
  })

  test("a subagent loop's Stop stays quiet", async ($, on) => {
    const { clock, plays } = setup(on)
    await stopped($, clock, { ...stop, agent_id: 'a1', agent_type: 'Explore' })
    expect(plays).toHaveLength(0)
  })

  test('plays when the turn dies on an error, not for a subagent', async ($, on) => {
    const { clock, plays } = setup(on)
    await works($, clock)
    await $.classic.StopFailure({ error: 'rate_limit', agent_id: 'a1' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(0)
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
  })

  test('an error right after your message stays quiet', async ($, on) => {
    const { clock, plays } = setup(on)
    await asked($, clock, 2000)
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(0)
  })
})

// Alerts one window passes on for another: `claude agents` for a background
// session, a team lead for its teammate.
const relays = [
  { message: 'fix login needs your input: approve Bash', notification_type: 'agent_needs_input' },
  { message: 'ana needs permission for Bash', notification_type: 'worker_permission_prompt' },
]
// Another window played a second ago.
const justPlayed = () => ({ [LAST_PLAYED_KEY]: START - 1000 })

describe('one sound across windows', () => {
  test("`claude agents` stays quiet for a session's finish: the session plays its own", async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.Notification({ message: 'fix login finished', notification_type: 'agent_completed' })
    await clock.advance(COOLDOWN_MS)
    await $.classic.Notification({ message: 'fix login failed', notification_type: 'agent_completed' })
    expect(plays).toHaveLength(0)
  })

  test('a passed-on alert stays quiet when another window just played', async ($, on) => {
    const { clock, plays } = setup(on, [], undefined, justPlayed())
    for (const relay of relays) await $.classic.Notification(relay)
    expect(plays).toHaveLength(0)
    await clock.advance(COOLDOWN_MS - 1000)
    await $.classic.Notification(relays[0]!)
    expect(plays).toHaveLength(1)
  })

  test("this window's own alerts play even right after another window's", async ($, on) => {
    const { plays } = setup(on, [], undefined, justPlayed())
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(1)
  })

  test("a dialog's own reminder stays quiet when it was just passed on", async ($, on) => {
    const stored = {}
    const { clock, plays } = setup(on, [], undefined, stored)
    await $.classic.Notification(relays[0]!)
    expect(stored).toEqual({ [LAST_PLAYED_KEY]: START, [LAST_RELAYED_KEY]: START })
    await clock.advance(RELAY_COVER_MS - 1)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(1)
    await clock.advance(1)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(2)
  })

  test("another window's passed-on alert covers this window's reminder too", async ($, on) => {
    const { plays } = setup(on, [], undefined, { [LAST_RELAYED_KEY]: START - 6000 })
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(0)
  })

  test('a play tells the other windows when it played', async ($, on) => {
    const stored = {}
    const { clock } = setup(on, [], undefined, stored)
    await stopped($, clock)
    expect(stored).toEqual({ [LAST_PLAYED_KEY]: START + MIN_WORK_MS + SETTLE_MS })
  })

  test("a passed-on alert plays when the store can't be read", async ($, on) => {
    const { clock, plays } = setup(on, [], undefined, null)
    await $.classic.Notification(relays[0]!)
    await clock.advance(COOLDOWN_MS)
    await $.classic.Notification(relays[1]!)
    expect(plays).toHaveLength(2)
  })

  test('a recorded time ahead of now (the clock was set back) does not mute an alert', async ($, on) => {
    const { plays } = setup(on, [], undefined, { [LAST_PLAYED_KEY]: START + 60_000 })
    await $.classic.Notification(relays[0]!)
    expect(plays).toHaveLength(1)
  })
})

// The person's files, as fs.read hands them back; any other path is missing.
function disk(on: On, files: Record<string, string>) {
  const reads: string[] = []
  on('fs.read', ($, e) => {
    reads.push(e.path)
    if (!(e.path in files)) return { deny: `ENOENT: ${e.path}` }
    return { value: { base64: files[e.path]! } }
  })
  return reads
}

// Claude finishes. Your own file is fetched and played in the background over
// several steps, so the clock moves on a moment more to let them all land.
async function finish($: Engine, clock: MockClock) {
  await $.classic.Stop(stop)
  await clock.advance(SETTLE_MS + 1)
}

describe('the sound option', () => {
  test('knows the formats afplay plays', () => {
    expect(mimeOf('/a/b.wav')).toBe('audio/wav')
    expect(mimeOf('/a/b.MP3')).toBe('audio/mpeg')
    expect(mimeOf('/a/b.m4a')).toBe('audio/mp4')
    expect(mimeOf('/a/b.aif')).toBe('audio/aiff')
    expect(mimeOf('/a/b.ogg')).toBeUndefined()
    expect(mimeOf('/a/noext')).toBeUndefined()
  })

  test('plays your own file in place of the tag', { options: { sound: '/music/done.mp3' } }, async ($, on) => {
    const { clock, plays } = setup(on)
    disk(on, { '/music/done.mp3': 'QUJD' })
    await finish($, clock)
    expect(plays).toEqual([expect.objectContaining({ clip: { base64: 'QUJD', mime: 'audio/mpeg' } })])
  })

  test('a path starting with ~/ is read from your home folder', { options: { sound: '~/sounds/ok.wav' } }, async ($, on) => {
    const { clock, plays } = setup(on)
    mock.env(on, { HOME: '/Users/me' })
    const reads = disk(on, { '/Users/me/sounds/ok.wav': 'UklGRg==' })
    await finish($, clock)
    expect(reads).toEqual(['/Users/me/sounds/ok.wav'])
    expect(plays).toEqual([expect.objectContaining({ clip: { base64: 'UklGRg==', mime: 'audio/wav' } })])
  })

  test('a missing file plays the default tag', { options: { sound: '/gone.wav' } }, async ($, on) => {
    const { clock, plays } = setup(on)
    disk(on, {})
    await finish($, clock)
    expect(plays).toEqual([expect.objectContaining({ clip: { asset: TAG } })])
  })

  test('an unsupported format plays the default tag, unread', { options: { sound: '/a/song.ogg' } }, async ($, on) => {
    const { clock, plays } = setup(on)
    const reads = disk(on, { '/a/song.ogg': 'T2dn' })
    await finish($, clock)
    expect(reads).toEqual([])
    expect(plays).toEqual([expect.objectContaining({ clip: { asset: TAG } })])
  })

  test("a file that can't play falls back to the default tag", { options: { sound: '/bad.wav' } }, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    mock.store(on)
    disk(on, { '/bad.wav': 'AAAA' })
    const plays: unknown[] = []
    on('audio.play', ($, e) => {
      plays.push(e.clip)
      if (e.clip.asset === undefined) return { deny: 'not audio' }
      return { value: undefined }
    })
    on('classic.Stop', () => ({}))
    await finish($, clock)
    expect(plays).toEqual([{ base64: 'AAAA', mime: 'audio/wav' }, { asset: TAG }])
  })

  test('an empty option keeps the default tag', { options: { sound: '  ' } }, async ($, on) => {
    const { clock, plays } = setup(on)
    const reads = disk(on, {})
    await finish($, clock)
    expect(reads).toEqual([])
    expect(plays).toEqual([expect.objectContaining({ clip: { asset: TAG } })])
  })
})
