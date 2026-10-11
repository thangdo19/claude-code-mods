import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COOLDOWN_MS, mimeOf, TAG } from '../hooks/register'

// Answers the engine's side: the classic events, and audio.play recorded instead of heard.
function setup(on: On) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-11T10:00:00Z') })
  const plays: unknown[] = []
  on('audio.play', ($, e) => {
    plays.push(e)
    return { value: undefined }
  })
  on('classic.Stop', () => ({}))
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

describe('producer-tag', () => {
  test('plays the tag when Claude finishes', async ($, on) => {
    const { plays } = setup(on)
    await $.classic.Stop(stop)
    expect(plays).toEqual([expect.objectContaining({ clip: { asset: TAG } })])
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
    await $.classic.Stop(stop)
    await clock.advance(COOLDOWN_MS)
    await $.classic.PermissionRequest(planApproval)
    expect(plays).toHaveLength(2)
  })

  test('stays quiet for the idle nudge and for a Stop hook re-run', async ($, on) => {
    const { plays } = setup(on)
    await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
    await $.classic.Stop({ stop_hook_active: true })
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
    await $.classic.Stop(stop)
    expect(plays).toHaveLength(2)
  })

  test('a turn end or a new prompt forgets announced dialogs', async ($, on) => {
    const { clock, plays } = setup(on)
    await $.classic.PermissionRequest(bashApproval)
    await $.classic.Stop(stop)
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(permissionNotice)
    await $.classic.PermissionRequest(bashApproval)
    await $.classic.UserPromptSubmit({ prompt: 'next' })
    await clock.advance(REMINDER_DELAY_MS)
    await $.classic.Notification(permissionNotice)
    expect(plays).toHaveLength(3)
  })

  test('a failed play does not break the hook', async ($, on) => {
    mock.clock(on, { now: 0 })
    on('audio.play', () => {
      throw new Error('no player')
    })
    on('classic.Stop', () => ({ block: 'kept' }))
    expect(await $.classic.Stop(stop)).toEqual({ block: 'kept' })
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
// several steps, so the clock moves on a moment to let them all land.
async function finish($: Engine, clock: MockClock) {
  await $.classic.Stop(stop)
  await clock.advance(1)
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
