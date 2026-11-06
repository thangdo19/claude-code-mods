import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import { COOLDOWN_MS, LAST_PLAYED_KEY, mimeOf, SETTLE_MS, TAG } from '../hooks/register'

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
  on('classic.PostToolUse', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  return { clock, plays }
}

const stop = { stop_hook_active: false }
const planApproval = { tool_name: 'ExitPlanMode', tool_input: { plan: '# plan' } }
const bashApproval = { tool_name: 'Bash', tool_input: { command: 'ls' } }
const permissionNotice = { message: 'Claude needs your permission', notification_type: 'permission_prompt' }
const planReminder = { message: 'Claude Code needs your approval for the plan', notification_type: 'permission_prompt' }
const networkReminder = { message: 'A sandboxed command needs network access', notification_type: 'permission_prompt' }
// Claude Code reminds about an open dialog once the person has been idle 6s.
const REMINDER_DELAY_MS = 10_000

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

// Claude stops, and the short wait for a new turn passes.
async function stopped($: Engine, clock: MockClock, e: Parameters<Engine['classic']['Stop']>[0] = stop) {
  await $.classic.Stop(e)
  await clock.advance(SETTLE_MS)
}

describe('producer-tag', () => {
  test('plays the tag when Claude finishes', async ($, on) => {
    const { clock, plays } = setup(on)
    await stopped($, clock)
    expect(plays).toEqual([expect.objectContaining({ clip: { asset: TAG } })])
  })

  test('a finish waits a moment before it plays', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.Stop(stop)
    await clock.advance(SETTLE_MS - 1)
    expect(plays).toHaveLength(0)
    await clock.advance(1)
    expect(plays).toHaveLength(1)
  })

  test('plays the tag when a plan waits for approval', async ($, on) => {
    const { plays } = setup(on)
    await $.classic.PermissionRequest(planApproval)
    expect(plays).toHaveLength(1)
  })

  test('one prompt raising two events plays once', async ($, on) => {
    const { plays } = setup(on)
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(1)
  })

  test('plays again once the cooldown has passed', async ($, on) => {
    const { clock, plays } = setup(on)
    await stopped($, clock)
    await clock.advance(COOLDOWN_MS)
    await $.classic.PermissionRequest(planApproval)
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
      await clock.advance(COOLDOWN_MS)
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

  test("a plan's 6s reminder does not replay the tag", async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(planApproval)
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(planReminder)
    expect(plays).toHaveLength(1)
  })

  test("a tool approval's reminder does not replay the tag, however late", async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await clock.advance(30_000)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(1)
  })

  test('a reminder after the announced tool ran plays', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await $.classic.PostToolUse({ ...bashApproval, tool_response: {}, tool_use_id: 't1' })
    await clock.advance(30_000)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(2)
  })

  test('another dialog opened inside an approved tool plays', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(networkReminder)
    expect(plays).toHaveLength(2)
  })

  test('one announcement covers one reminder only', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(permissionNotice)
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(2)
  })

  test('the finish after an approved plan still plays', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(planApproval)
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(planReminder)
    await $.classic.PostToolUse({ ...planApproval, tool_response: {}, tool_use_id: 't1' })
    await clock.advance(REMINDER_DELAY_MS)
    await stopped($, clock)
    expect(plays).toHaveLength(2)
  })

  test('a turn end or a new prompt forgets announced dialogs', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await stopped($, clock)
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(permissionNotice)
    await $.classic.PermissionRequest(bashApproval)
    await $.classic.UserPromptSubmit({ prompt: 'next' })
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(3)
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
    await $.classic.Stop(stop)
    await clock.advance(100)
    await $.turn.start({ text: '', turnId: 't2' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(0)
  })

  test("a subagent's turn does not cancel the finish", async ($, on) => {
    const { clock, plays } = setup(on)
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
    await $.classic.StopFailure({ error: 'rate_limit', agent_id: 'a1' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(0)
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.advance(SETTLE_MS)
    expect(plays).toHaveLength(1)
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
    await $.classic.PermissionRequest(bashApproval)
    expect(plays).toHaveLength(1)
  })

  test('a play tells the other windows when it played', async ($, on) => {
    const stored = {}
    const { clock } = setup(on, [], undefined, stored)
    await stopped($, clock)
    expect(stored).toEqual({ [LAST_PLAYED_KEY]: START + SETTLE_MS })
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
