// What happens in the session, as changes to the office: turns, the model's stream, tool calls, dialogs, agents,
// compacting, /clear. Each hook lets the event through whatever the office does with it.

import type { On } from 'claude-code'

import type { Mood, Office } from '../types'
import { describe, oneLine, questionOf } from './labels'
import { addSec, addTask, EMPTY, endJob, endStatus, endTurn, patchSec, patchTask, setMood, startJob, startTurn, tasksFrom, todosFrom } from './office'
import { isStream } from './moods'
import { change, rt } from './loop'

/** "Needs you" alerts that are not a tool's permission dialog (that one has its own event). */
const NEEDS_YOU = new Set(['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input', 'worker_permission_prompt'])
/** What Claude Code tells the model when the person says no at a permission dialog. */
const REJECTED = /user (?:doesn't want to proceed|rejected|denied)|was rejected|permission denied/i

export function events(on: On): void {
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
          if (isStream(rt.latest.mood) && rt.latest.mood !== mood) {
            await change($, (o, now) => (o.turnActive && isStream(o.mood) ? { ...o, mood, moodText: null, moodAt: now, lastActivity: now } : o)).catch(() => {})
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
    const label = describe(tool, input, rt.cwd)
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
        const denied = rt.deniedCalls.delete(id) || (failed && REJECTED.test(result.text ?? result.deny ?? ''))
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
      const l = describe(e.tool_name, (e.tool_input ?? {}) as Record<string, unknown>, rt.cwd)
      const sec = e.agent_id === undefined ? undefined : rt.latest.secs.find(s => s.id === e.agent_id)
      const text = e.tool_name === 'ExitPlanMode' ? 'Plan ready: your OK?' : 'Needs your OK: ' + (sec ? sec.name + ' wants ' : '') + l.full.replace(/^\$ /, '')
      await change($, (o, now) => setMood(o, 'permission', now, text))
    } catch {
      // The dialog shows anyway.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', async ($, e, next) => {
    rt.deniedCalls.add(e.tool_use_id)
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
      if (NEEDS_YOU.has(e.notification_type) && rt.latest.mood !== 'permission') await change($, (o, now) => setMood(o, 'ask', now, 'Needs your input: ' + oneLine(e.message)))
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
      if (typeof mode === 'string' && rt.latest.plan !== (mode === 'plan')) await change($, o => ({ ...o, plan: mode === 'plan' }))
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
}
