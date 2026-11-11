import type { AgentInfo, AudioClip, ClassicEventOf, EngineInterface, Register, Timer } from 'claude-code'

export const TAG = 'sounds/tag.wav'
// Several dialogs can open at once, each with its own alert; play it once.
export const COOLDOWN_MS = 4000
// The shortest work whose finish plays, counted from your last message. Under
// it you are still at the screen, and the sound would only be noise.
export const MIN_WORK_MS = 10_000
// How long a finish waits before it plays. A helper that finished during Claude's
// last reply wakes Claude again at once; that new turn cancels the sound.
export const SETTLE_MS = 1500

// Background work that wakes Claude when it finishes or has news, by the type
// Stop's `background_tasks` names it: Claude ended its turn only to wait for it.
// Teammates are judged by `$.agent.list()`, since an idle one still shows here.
// Claude Code's own chores (dream, memory import, auto-mode scan) never wake
// Claude, and a cloud session can sit waiting on you, so neither keeps it quiet.
const WAITED_ON = new Set(['subagent', 'workflow', 'shell', 'monitor'])

// The notifications that mean "Claude needs you", and the only sign of it the
// mod trusts: Claude Code sends one per open dialog, once nobody has touched a
// key for 6s. (PermissionRequest is no sign: it is also raised with no dialog,
// for a helper that can't ask or an action refused outright.) Every dialog sends
// `permission_prompt` unless it names another type here. The rest (logins, a
// push Claude sent, computer use, a plugin's own alert, an MCP reply) stay quiet.
// So does `agent_completed`: only `claude agents` sends it, for a background
// session on this computer, and that session plays its own finish (it alone
// knows whether it still waits for helpers).
const NEEDS_YOU = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'worker_permission_prompt',
  'agent_needs_input',
])

// Alerts one window passes on for another, which mostly played already: `claude
// agents` for a background session's dialog, a team lead for its teammate's
// request. They play only if no window played within COOLDOWN_MS.
const RELAYED = new Set(['agent_needs_input', 'worker_permission_prompt'])
// Where every window records its last play, in this plugin's own store: one
// file on disk, read afresh on every get, so all windows share it.
export const LAST_PLAYED_KEY = 'lastPlayedAt'
// When any window last played a passed-on alert. The window it was passed on
// for reminds of the same dialog itself, about 6s later: that one stays quiet.
export const LAST_RELAYED_KEY = 'lastRelayedAt'
export const RELAY_COVER_MS = 10_000

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

let lastPlayedAt = -Infinity
let lastRelayedAt = -Infinity
// A finish waiting out SETTLE_MS, until it plays or a new main turn cancels it.
let pendingFinish: Timer | undefined
// When the work Claude is on began: your last message, or the first turn that
// started without one (a wake-up, a schedule). Unknown once a finish settled.
let workStartedAt: number | undefined
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

// A time every window shares; never, when the store can't be read.
async function shared($: EngineInterface, key: string): Promise<number> {
  try {
    const at = await $.store.get(key)
    return typeof at === 'number' ? at : -Infinity
  } catch {
    return -Infinity
  }
}

// True when `at` is less than `ms` before `now`. A time ahead of now (the clock
// was set back) counts as never, so a sound is never lost to it.
const within = (now: number, at: number, ms: number) => now - at >= 0 && now - at < ms

// What a play is for. `done`: Claude finished. `ask`: a dialog of this window
// waits for you. `relay`: an alert this window passes on for another, which
// mostly played already, so a play in any window counts against it.
type Why = 'done' | 'ask' | 'relay'

async function play($: EngineInterface, why: Why) {
  const now = await $.clock.now()
  const last = why === 'relay' ? Math.max(lastPlayedAt, await shared($, LAST_PLAYED_KEY)) : lastPlayedAt
  if (within(now, last, COOLDOWN_MS)) return
  if (why === 'ask') {
    const relayed = Math.max(lastRelayedAt, await shared($, LAST_RELAYED_KEY))
    if (within(now, relayed, RELAY_COVER_MS)) return
  }
  lastPlayedAt = now
  if (why === 'relay') lastRelayedAt = now
  // Recorded before the clip starts, so a relay right after it stays quiet.
  // A failed write only loses the record, never the sound.
  try {
    await $.store.set(LAST_PLAYED_KEY, now)
    if (why === 'relay') await $.store.set(LAST_RELAYED_KEY, now)
  } catch {}
  // Not awaited: the clip never holds up Claude, and a failed play is only a missed sound.
  playTag($).catch(() => {})
}

function cancelFinish() {
  pendingFinish?.cancel()
  pendingFinish = undefined
}

// Claude stopped at `stoppedAt` and nothing will wake it: play, unless a new main
// turn starts first (the work goes on, and so does its count) or the work was
// short. Work whose start nobody saw (the mod loaded mid-turn) plays.
function finish($: EngineInterface, stoppedAt: number) {
  cancelFinish()
  const timer = $.clock.after(SETTLE_MS, () => {
    if (pendingFinish !== timer) return
    pendingFinish = undefined
    const startedAt = workStartedAt
    workStartedAt = undefined
    if (startedAt !== undefined && within(stoppedAt, startedAt, MIN_WORK_MS)) return
    play($, 'done').catch(() => {})
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

export const register: Register = (on, options) => {
  sound = typeof options.sound === 'string' ? options.sound.trim() : ''

  // Claude finished its reply. Not a finish: a Stop hook sent Claude back to work
  // (the settings hooks beneath answer `block`), or Claude only waits for work
  // that wakes it. Either way the work, and its count, goes on.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    cancelFinish()
    // Caught here: the hooks beneath already ran, and a failure is only a missed sound.
    try {
      if (result.block === undefined && !(await isWaiting($, e))) finish($, await $.clock.now())
    } catch {}
    return result
  }).catch(($, e, next) => next(e))

  // The turn died on an error (a usage limit, the API down): Claude waits for you.
  on('classic.StopFailure', async ($, e, next) => {
    if (e.agent_id === undefined) finish($, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  // A new main turn: Claude is working again, so a finish waiting to play is not
  // one. With no work under way (a wake-up, a schedule), the count starts here.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      cancelFinish()
      workStartedAt ??= await $.clock.now()
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Your message: you are at the screen, so the count starts again from here.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    workStartedAt = await $.clock.now()
    return next(e)
  }).catch(($, e, next) => next(e))

  // A dialog has waited 6s for you, here or in a window this one speaks for.
  // The 60s idle nudge is not one: the finish already played, or was too short to.
  on('classic.Notification', async ($, e, next) => {
    const type = e.notification_type
    if (NEEDS_YOU.has(type)) await play($, RELAYED.has(type) ? 'relay' : 'ask')
    return next(e)
  }).catch(($, e, next) => next(e))
}
