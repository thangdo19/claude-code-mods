import type { AudioClip, EngineInterface, Register } from 'claude-code'

export const TAG = 'sounds/tag.wav'
// One prompt can raise both PermissionRequest and Notification; play it once.
export const COOLDOWN_MS = 4000

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

  // Claude finished its reply. A Stop hook that sent Claude back to work isn't a finish.
  // No dialog outlives the turn, so every herald goes.
  on('classic.Stop', async ($, e, next) => {
    heralds.length = 0
    if (!e.stop_hook_active) await play($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A permission dialog is up: a tool approval, or ExitPlanMode's plan approval.
  on('classic.PermissionRequest', async ($, e, next) => {
    heralds.push(e.tool_name)
    await play($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Other "needs you" alerts. The 60s idle nudge is left out: Stop already played.
  on('classic.Notification', async ($, e, next) => {
    if (isAnnouncedReminder(e.message, e.notification_type)) heralds.shift()
    else if (e.notification_type !== 'idle_prompt') await play($)
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
