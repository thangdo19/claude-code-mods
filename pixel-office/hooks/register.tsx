import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mood, Office } from '../types'
import { describe, oneLine, questionOf } from './labels'
import {
  addSec, addTask, DOT_W, EMPTY, endJob, endStatus, endTurn, fitRows, lines, patchSec, patchTask, setMood, startJob, startTurn, tasksFrom, todosFrom, view, WHO_W,
  type Line, type Tone, type View,
} from './office'
import { bigCells } from './big-cells'
import { BIG_COLS, BIG_ROWS, renderBig } from './big-scene'
import { BigSim } from './big-walk'
import { Calm } from './calm'
import { Camera, CAM_COLS, CAM_ROWS } from './camera'

const PANE = 'office'
const TITLE = 'Office'
/** The person closed the pane by hand: it stays closed until /office. */
const CLOSED_KEY = 'closedByHand'
/** "Needs you" alerts that are not a tool's permission dialog (that one has its own event). */
const NEEDS_YOU = new Set(['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input', 'worker_permission_prompt'])
/** What Claude Code tells the model when the person says no at a permission dialog. */
const REJECTED = /user (?:doesn't want to proceed|rejected|denied)|was rejected|permission denied/i
/** The Manager's moods that the model's own stream sets; a dialog's moods outrank them. */
const STREAM_MOODS = new Set<Mood>(['think', 'write', 'work'])
/** The width the pane asks for beside a fullscreen transcript; with less, the camera shows part of the office. */
const PANE_COLS = 64
/** The rows the pane asks for above the prompt (classic renderer): the camera, the list beside it. */
const INLINE_ROWS = CAM_ROWS
/** Lines kept for the list under the office. */
const LIST_MIN = 2
/** The list beside the camera keeps at least this many columns, gap included, or 45% of the pane. */
const LIST_BESIDE = 36
/** The camera's smallest window: narrower or shorter, the list goes under it, or shows alone. */
const CAM_MIN_COLS = 32
const CAM_MIN_ROWS = 8

// Change the tag when Office's fields change: it declines what an older version stored.
const office = atom({ plugin: 'pixel-office', key: 'office' } as const, EMPTY, { shape: 'office-1' })

/* ===== module state: a reload starts these over and rebuilds from $.state ===== */
let latest: Office = EMPTY
let cwd: string | undefined
/** What the pane last drew: the timer repaints the same Raster. */
let mounted: { shape: Shape; inline: boolean; viewing?: string } | null = null
const bigSim = new BigSim()
const camera = new Camera()
/** What the Manager shows: a fast think/tool loop does not flash bubbles. */
const calm = new Calm()
let lastCells = ''
let lastList = ''
let tick = 0
/** Someone walked (or the camera glided) last tick: the frame where they stop is drawn too. */
let wasMoving = false
let ticking = false
let timerStarted = false
const deniedCalls = new Set<string>()

async function change($: EngineInterface, fn: (o: Office, now: number) => Office): Promise<void> {
  const now = await $.clock.now()
  latest = await update($, office, o => fn({ ...EMPTY, ...o }, now))
}

/**
 * What the pane shows: the office as designed (64 × 31) wherever it fits, with the
 * list under it; else a camera on the same office, at the same pixel size, with the
 * list beside it or under it; else only the list.
 */
type Shape = { kind: 'big'; rows: number; skip: number } | { kind: 'cam'; cols: number; rows: number; beside: boolean }
function shapeFor(surface: string, cols: number, rows: number): Shape | null {
  if (surface !== 'terminal') return null
  if (cols >= BIG_COLS && rows >= BIG_ROWS + LIST_MIN) return { kind: 'big', rows: BIG_ROWS, skip: 0 }
  // A few rows short: leave off the empty wall row at the top, then the bottom edge of the front desks.
  if (cols >= BIG_COLS && rows - 1 >= BIG_ROWS - 4) {
    const shown = Math.min(BIG_ROWS, rows - 1)
    return { kind: 'big', rows: shown, skip: shown < BIG_ROWS ? 1 : 0 }
  }
  const besideCols = Math.min(CAM_COLS, cols - Math.max(LIST_BESIDE, Math.floor(cols * 0.45)))
  if (besideCols >= CAM_MIN_COLS && rows >= CAM_MIN_ROWS) return { kind: 'cam', cols: besideCols, rows: Math.min(CAM_ROWS, rows), beside: true }
  if (cols >= CAM_MIN_COLS && rows >= CAM_ROWS + LIST_MIN) return { kind: 'cam', cols: Math.min(CAM_COLS, cols), rows: CAM_ROWS, beside: false }
  return null
}

const listKey = (ls: Line[]) => ls.map(l => l.who + '|' + l.what + '|' + l.tone).join('\n')

function draw(v: View, shape: Shape, viewing?: string) {
  const full = renderBig(v, bigSim, tick >> 1, tick, viewing)
  return shape.kind === 'big' ? bigCells(full, shape.skip, shape.rows) : bigCells(camera.view(full, shape.cols, shape.rows * 2))
}

/** 8 times a second: people take a step, the picture repaints when it changed. */
async function onTick($: EngineInterface): Promise<void> {
  if (ticking || !mounted) return
  ticking = true
  try {
    tick++
    const now = await $.clock.now()
    const v = view(latest, now, real => calm.step(real, now))
    bigSim.sync(v)
    bigSim.step(v)
    const cam = mounted.shape.kind === 'cam' ? mounted.shape : null
    if (cam) camera.step(v, cam.cols, cam.rows * 2, bigSim)
    // The list changes with time as well (a break changes, "Done!" fades): redraw the pane then.
    const key = listKey(lines(v, bigSim.seated(), bigSim.breakLine(v), id => bigSim.lookOf(id)))
    if (key !== lastList) {
      lastList = key
      $.ui.invalidate('ui.render')
    }
    const moving = bigSim.walking() || (cam !== null && camera.moving(v, cam.cols, cam.rows * 2, bigSim))
    // Above the prompt (classic renderer) the picture moves only while someone walks, at most
    // 4 frames a second, so the terminal has little to redraw; beside the transcript it is alive.
    // The frame where everyone stops (a bubble appears) is always drawn.
    const stopped = wasMoving && !moving
    wasMoving = moving
    if (!stopped) {
      if (mounted.inline && (!moving || tick % 2)) return
      if (!moving && tick % 2) return
      if (v.night && !moving && tick % 8) return
    }
    const c = draw(v, mounted.shape, mounted.viewing)
    if (c.cells === lastCells) return
    lastCells = c.cells
    const r = await $.ui.blit({ requestId: PANE, key: 'office', cells: c.cells })
    if (r.deny) mounted = null
  } catch {
    // A missed frame; the next tick tries again.
  } finally {
    ticking = false
  }
}

const TONE_COLOR: Record<Tone, string | undefined> = { '': undefined, idle: 'subtle', warn: 'warning', bad: 'error', good: 'success' }
const pad = (s: string, n: number) => (Array.from(s).length >= n ? Array.from(s).slice(0, n).join('') : s.padEnd(n, ' '))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      cwd = e.cwd
      latest = { ...EMPTY, ...(await read($, office)) }
      if (latest.lastActivity === 0) await change($, (o, now) => ({ ...o, lastActivity: now, moodAt: now }))
      await $.command.register({ name: 'office', description: 'Show the pixel office in the side panel' })
      // No screen (claude -p): nothing to draw, so no timer and no pane.
      if (e.isInteractive === false) return result
      if (!timerStarted) {
        timerStarted = true
        $.clock.every(125, () => void onTick($))
      }
      if ((await $.store.get(CLOSED_KEY)) !== true) void $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLS, rows: INLINE_ROWS }).catch(() => {})
    } catch {
      // No pane this time; /office opens it.
    }
    return result
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.store.set(CLOSED_KEY, false)
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLS, rows: INLINE_ROWS })
    return { text: opened.isPlaced ? 'Office opened.' : 'Office opens when there is room (' + opened.reason + ').' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      mounted = null
      if (e.origin.kind === 'person') await $.store.set(CLOSED_KEY, true).catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A turn starts: the Manager wakes; an agent's run starts (a teammate wakes).
  on('turn.start', async ($, e, next) => {
    try {
      const id = e.agentId
      if (id === undefined) await change($, (o, now) => startTurn(o, now))
      else await change($, o => patchSec(o, id, { status: 'run', endedAt: null }))
    } catch {
      // The office shows the last state.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The model's stream: thinking, writing the reply, or calling tools.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let seen: Mood | null = null
    for (;;) {
      const r = await stream.next()
      if (r.done) return r.value
      const c = r.value
      if (e.agentId === undefined) {
        const mood: Mood | null = c.kind === 'thinking' ? 'think' : c.kind === 'text' ? 'write' : c.kind === 'tool' ? 'work' : null
        if (mood && mood !== seen) {
          seen = mood
          if (STREAM_MOODS.has(latest.mood) && latest.mood !== mood) {
            await change($, (o, now) => (o.turnActive && STREAM_MOODS.has(o.mood) ? { ...o, mood, moodText: null, moodAt: now, lastActivity: now } : o)).catch(() => {})
          }
        }
      }
      yield c
    }
  })

  // Every tool call: the right worker walks in; a subagent's call changes its desk's line.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const id = e.tool_use_id
    const agent = e.agentId
    const label = describe(tool, input, cwd)
    try {
      if (agent !== undefined) {
        if (label.who !== 'manager') await change($, o => patchSec(o, agent, { short: label.short, full: label.full }))
      } else if (tool === 'AskUserQuestion') await change($, (o, now) => setMood(o, 'ask', now, questionOf(input)))
      else if (tool === 'EnterPlanMode') await change($, o => ({ ...o, plan: true }))
      else if (label.who !== 'manager') {
        const role = label.who
        // The Planner writes the to-do list; the board shows it.
        const todos = tool === 'TodoWrite' ? todosFrom(input) : undefined
        await change($, (o, now) => startJob(todos === undefined ? o : { ...o, todos }, { id, role, short: label.short, full: label.full, startedAt: now, ...(label.brief ? { brief: true } : {}) }))
      }
    } catch {
      // The office misses this call; the tool runs anyway.
    }
    const result = await next(e)
    try {
      if (agent === undefined) {
        const failed = result.isError === true || (result.deny !== undefined && result.deny !== '')
        const denied = deniedCalls.delete(id) || (failed && REJECTED.test(result.text ?? result.deny ?? ''))
        if (tool === 'AskUserQuestion') await change($, (o, now) => (o.mood === 'ask' ? setMood(o, 'think', now) : o))
        else if (tool === 'ExitPlanMode') await change($, (o, now) => ({ ...setMood(o, 'think', now), plan: failed ? o.plan : false }))
        else if (label.who !== 'manager') {
          const role = label.who
          const bg = (tool === 'Bash' || tool === 'PowerShell') && input.run_in_background === true && !failed
          // The task tools write the board too (TaskCreate gives the new task's id; TaskList the whole list).
          const out = failed ? undefined : (result.result as Record<string, unknown> | undefined)
          const task = out?.task as { id?: unknown; subject?: unknown } | undefined
          const tasks = (o: Office): Office => {
            if (failed) return o
            const subject = typeof task?.subject === 'string' && task.subject ? task.subject : typeof input.subject === 'string' ? input.subject : ''
            if (tool === 'TaskCreate' && typeof task?.id === 'string' && subject) return { ...o, todos: addTask(o.todos, task.id, subject) }
            if (tool === 'TaskUpdate' && typeof input.taskId === 'string') return { ...o, todos: patchTask(o.todos, input.taskId, input) }
            if (tool === 'TaskList') return { ...o, todos: tasksFrom(out) ?? o.todos }
            return o
          }
          await change($, (o, now) => {
            const ended = endJob(tasks(o), id, role, { short: label.short, full: label.full, err: failed && !denied, denied, endedAt: now })
            const calm = ended.mood === 'permission' ? setMood(ended, 'work', now) : ended
            return bg ? { ...calm, bg: [...calm.bg, label.full.replace(/^\$ /, '').replace(/ \(in background\)$/, '')].slice(-8) } : calm
          })
        }
      }
    } catch {
      // The worker stays until the turn ends.
    }
    return result
  }).catch(($, e, next) => next(e))

  // A permission dialog: the Manager turns to you.
  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      const l = describe(e.tool_name, (e.tool_input ?? {}) as Record<string, unknown>, cwd)
      const sec = e.agent_id === undefined ? undefined : latest.secs.find(s => s.id === e.agent_id)
      const text = e.tool_name === 'ExitPlanMode' ? 'Plan ready: your OK?' : 'Needs your OK: ' + (sec ? sec.name + ' wants ' : '') + l.full.replace(/^\$ /, '')
      await change($, (o, now) => setMood(o, 'permission', now, text))
    } catch {
      // The dialog shows anyway.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', async ($, e, next) => {
    deniedCalls.add(e.tool_use_id)
    try {
      await change($, (o, now) => (o.mood === 'permission' ? setMood(o, 'think', now) : o))
    } catch {
      // The Manager stays as it was.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Other "needs you" moments: an MCP server asking for input, a teammate waiting on you.
  on('classic.Notification', async ($, e, next) => {
    try {
      if (NEEDS_YOU.has(e.notification_type) && latest.mood !== 'permission') await change($, (o, now) => setMood(o, 'ask', now, 'Needs your input: ' + oneLine(e.message)))
    } catch {
      // The alert shows anyway.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The turn died on an error (usage limit, API down).
  on('classic.StopFailure', async ($, e, next) => {
    try {
      if (e.agent_id === undefined) await change($, (o, now) => setMood(o, 'hold', now, 'On hold · ' + oneLine(String(e.error).replace(/_/g, ' '))))
    } catch {
      // The Manager stays as it was.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The end of each main turn lists what still runs in the background.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agent_id === undefined) {
        const bg = (e.background_tasks ?? []).filter(t => t.status === 'running' && t.command !== undefined).map(t => oneLine(t.command ?? t.description))
        await change($, o => (o.bg.join('\n') === bg.join('\n') ? o : { ...o, bg }))
      }
    } catch {
      // The rack keeps its lights as they were.
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    try {
      const mode = e.permission_mode
      if (typeof mode === 'string' && latest.plan !== (mode === 'plan')) await change($, o => ({ ...o, plan: mode === 'plan' }))
    } catch {
      // Plan mode shows from the next tool call instead.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A subagent, teammate or workflow agent starts: a secretary walks in.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    try {
      const id = result.agentId
      if (id !== undefined) {
        const teammate = e.isTeammate === true
        const name = e.workflow ? 'workflow' : teammate ? (result.teammateId?.split('@')[0] ?? 'teammate') : e.subagentType
        const task = oneLine(e.description) || name
        await change($, (o, now) => addSec(o, { id, name, task, short: task, full: task, status: 'run', startedAt: now, endedAt: null, teammate }))
      }
    } catch {
      // The agent runs without a desk.
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      const id = e.agentId
      if (id === undefined) await change($, (o, now) => endTurn(o, e.reason, e.isAborted, e.durationMs, now))
      else
        await change($, (o, now) => {
          const s = o.secs.find(x => x.id === id)
          return s ? patchSec(o, id, { status: e.isAborted ? 'fail' : endStatus(e.reason, s.teammate), endedAt: now }) : o
        })
    } catch {
      // The office shows the last state.
    }
    return result
  }).catch(($, e, next) => next(e))

  // Compacting the main conversation: the janitor comes in.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // (It counts as activity: a /compact at night wakes the office before the Janitor comes.)
    await change($, (o, now) => ({ ...o, compacting: true, lastActivity: now })).catch(() => {})
    try {
      return await next(e)
    } finally {
      await change($, o => ({ ...o, compacting: false })).catch(() => {})
    }
  }).catch(($, e, next) => next(e))

  // /clear and /resume: a fresh office; agents still running keep their desks.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume')
      await change($, (o, now) => ({ ...EMPTY, secs: o.secs.filter(s => s.status === 'run' || s.status === 'idle'), bg: o.bg, order: o.order, moodAt: now, lastActivity: now })).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const o: Office = { ...EMPTY, ...(await read($, office)) }
    latest = o
    const now = await $.clock.now()
    const v = view(o, now, real => calm.peek(real, now))
    const cols = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    const shape = shapeFor(e.surface, cols, rows)
    const viewing = e.props.view.agentId
    if (shape) bigSim.sync(v)
    // A new pane: the camera starts where it should be looking.
    if (shape?.kind === 'cam') camera.step(v, shape.cols, shape.rows * 2, bigSim)
    const all = lines(v, shape ? bigSim.seated() : undefined, shape ? bigSim.breakLine(v) : null, shape ? id => bigSim.lookOf(id) : undefined)
    lastList = listKey(all)
    const beside = shape?.kind === 'cam' && shape.beside
    // The list's own width (beside the camera: what the camera and the gap leave); long lines wrap within it.
    const listCols = beside ? cols - shape.cols - 1 : cols
    const shown = fitRows(all, listCols, Math.max(1, beside ? rows : rows - (shape?.rows ?? 0)))

    const { Box, Text } = $.ui.resolve(e)
    /** One list row: the dot and name columns keep their width (a long line never squeezes them), the words fill the rest. */
    const row = (l: Line, dimIdle: boolean) => (
      <Box flexDirection="row">
        <Box width={DOT_W} flexShrink={0}>
          <Text color={l.dot || undefined}>{l.dot ? '●' : ' '}</Text>
        </Box>
        <Box width={WHO_W} flexShrink={0}>
          <Text bold dimColor={dimIdle && l.tone === 'idle'}>
            {pad(l.who, WHO_W)}
          </Text>
        </Box>
        <Text color={TONE_COLOR[l.tone]} wrap="truncate-end">
          {l.what}
        </Text>
      </Box>
    )

    if (e.surface === 'terminal' && shape) {
      const { Raster } = $.ui.resolve(e)
      const c = draw(v, shape, viewing)
      mounted = { shape, inline: e.props.placement === 'inline', viewing }
      lastCells = c.cells
      const list = shown.map(l => row(l, true))
      const picture = <Raster key="office" columns={c.columns} rows={c.rows} cells={c.cells} />
      return beside ? (
        <Box flexDirection="row">
          {picture}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} marginLeft={1}>
            {list}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {picture}
          {list}
        </Box>
      )
    }
    mounted = null
    return <Box flexDirection="column">{shown.map(l => row(l, false))}</Box>
  })
}
