import type { AgentInfo, AudioClip, ClassicEventOf, EngineInterface, Register, Timer } from 'claude-code'

export const TAG = 'sounds/tag.wav'
// One prompt can raise both PermissionRequest and Notification; play it once.
export const COOLDOWN_MS = 4000
// How long a finish waits before it plays. A helper that finished during Claude's
// last reply wakes Claude again at once; that new turn cancels the sound.
export const SETTLE_MS = 1500

// Background work that wakes Claude when it finishes or has news, by the type
// Stop's `background_tasks` names it: Claude ended its turn only to wait for it.
// Teammates are judged by `$.agent.list()`, since an idle one still shows here.
// Claude Code's own chores (dream, memory import, auto-mode scan) never wake
// Claude, and a cloud session can sit waiting on you, so neither keeps it quiet.
const WAITED_ON = new Set(['subagent', 'workflow', 'shell', 'monitor'])

// The notifications that mean "Claude needs you". Every dialog sends
// `permission_prompt` unless it names another type here. The rest (logins, a
// push Claude sent, computer use, a plugin's own alert, an MCP reply) stay quiet.
const NEEDS_YOU = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'worker_permission_prompt',
  'agent_needs_input',
  'agent_completed',
])

// The formats `afplay` plays, by extension, for the `sound` option's file.
const MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
}

export const mimeOf = (path: string): string | undefined =>
  MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]

// What a tool dialog's reminder says. Claude Code sends it once the person has
// been idle 6s at the dialog, after PermissionRequest already played for it.
const TOOL_DIALOG_REMINDERS = [
  'Claude needs your permission',
  'Claude Code needs your approval for the plan',
  'Claude Code wants to enter plan mode',
]
const HEADLESS_REMINDER_PREFIX = 'Claude needs your permission to use '

let lastPlayedAt = -Infinity
// A finish waiting out SETTLE_MS, until it plays or a new main turn cancels it.
let pendingFinish: Timer | undefined
// Tools whose dialog PermissionRequest announced, one entry per dialog, until
// its reminder comes or the tool is done.
const heralds: string[] = []
// The `sound` option: the person's own file, '' for the bundled tag.
let sound = ''

// The person's file, read fresh each time so a replaced file plays at once.
async function ownClip($: EngineInterface): Promise<AudioClip> {
  const mime = mimeOf(sound)
  if (!mime) throw new Error(`not a supported sound file: ${sound}`)
  const path = sound.startsWith('~/') ? `${await $.env.get('HOME')}${sound.slice(1)}` : sound
  const { base64 } = await $.fs.read(path, { as: 'bytes' })
  return { base64, mime }
}

// The person's file when set; the bundled tag when it isn't, or it can't be read or played.
async function playTag($: EngineInterface) {
  if (sound) {
    try {
      return await $.audio.play(await ownClip($))
    } catch {
      // Falls through to the bundled tag.
    }
  }
  await $.audio.play({ asset: TAG })
}

async function play($: EngineInterface) {
  const now = await $.clock.now()
  if (now - lastPlayedAt < COOLDOWN_MS) return
  lastPlayedAt = now
  // Not awaited: the clip never holds up Claude, and a failed play is only a missed sound.
  playTag($).catch(() => {})
}

function cancelFinish() {
  pendingFinish?.cancel()
  pendingFinish = undefined
}

// Claude stopped and nothing will wake it: play, unless a new main turn starts first.
function finish($: EngineInterface) {
  cancelFinish()
  const timer = $.clock.after(SETTLE_MS, () => {
    if (pendingFinish !== timer) return
    pendingFinish = undefined
    play($).catch(() => {})
  })
  pendingFinish = timer
}

// The agent loops of this session; none when the list can't be read.
async function agents($: EngineInterface): Promise<AgentInfo[]> {
  try {
    return await $.agent.list()
  } catch {
    return []
  }
}

// Claude ended its turn only to wait: for a helper, a background command, a
// busy teammate, or a one-time wake-up it scheduled. It comes back on its own.
async function isWaiting($: EngineInterface, e: ClassicEventOf['classic.Stop']) {
  if ((e.session_crons ?? []).some(c => !c.recurring)) return true
  const tasks = (e.background_tasks ?? []).filter(t => WAITED_ON.has(t.type))
  const list = await agents($)
  if (list.some(a => a.teammateId !== undefined && (a.status === 'running' || a.status === 'pending'))) return true
  // A plugin's own agent reports to that plugin, not to Claude.
  return tasks.some(t => t.type !== 'subagent' || list.find(a => a.id === t.id)?.spawnedBy === undefined)
}

function forget(tool: string) {
  const i = heralds.indexOf(tool)
  if (i !== -1) heralds.splice(i, 1)
}

// A tool dialog's reminder while some dialog was announced: that dialog already played.
// Any other dialog's reminder plays, even one opened inside an approved tool.
function isAnnouncedReminder(message: string, type: string) {
  if (type !== 'permission_prompt' || heralds.length === 0) return false
  return TOOL_DIALOG_REMINDERS.includes(message) || message.startsWith(HEADLESS_REMINDER_PREFIX)
}

export const register: Register = (on, options) => {
  sound = typeof options.sound === 'string' ? options.sound.trim() : ''

  // Claude finished its reply. Not a finish: a Stop hook sent Claude back to work
  // (the settings hooks beneath answer `block`), or Claude only waits for work
  // that wakes it. No dialog outlives the turn, so every herald goes.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    heralds.length = 0
    cancelFinish()
    // Caught here: the hooks beneath already ran, and a failure is only a missed sound.
    try {
      if (result.block === undefined && !(await isWaiting($, e))) finish($)
    } catch {}
    return result
  }).catch(($, e, next) => next(e))

  // The turn died on an error (a usage limit, the API down): Claude waits for you.
  on('classic.StopFailure', async ($, e, next) => {
    if (e.agent_id === undefined) finish($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new main turn: Claude is working again, so a finish waiting to play is not one.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) cancelFinish()
    return next(e)
  }).catch(($, e, next) => next(e))

  // A permission dialog is up: a tool approval, or ExitPlanMode's plan approval.
  on('classic.PermissionRequest', async ($, e, next) => {
    heralds.push(e.tool_name)
    await play($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Other "needs you" alerts. The 60s idle nudge is not one: Stop already played.
  on('classic.Notification', async ($, e, next) => {
    if (isAnnouncedReminder(e.message, e.notification_type)) heralds.shift()
    else if (NEEDS_YOU.has(e.notification_type)) await play($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The tool ran, failed or was denied: its dialog is gone, so a later reminder is another's.
  on('classic.PostToolUse', async ($, e, next) => {
    forget(e.tool_name)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PostToolUseFailure', async ($, e, next) => {
    forget(e.tool_name)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PermissionDenied', async ($, e, next) => {
    forget(e.tool_name)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new prompt means no dialog is up.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    heralds.length = 0
    return next(e)
  }).catch(($, e, next) => next(e))
}
