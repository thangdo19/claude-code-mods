// Turns a tool call into who handles it and the words shown for it.
// Pure: no Claude Code calls, easy to test.

import type { Role } from '../types'

/** Who walks in for a tool: an office worker, or the Manager (Claude) itself. */
export type Who = Role | 'manager'

const ARCHIVE = new Set(['Read', 'Grep', 'Glob', 'LSP', 'NotebookRead'])
const TYPE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const IT = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash', 'Monitor', 'TaskOutput', 'TaskStop'])
// Planning, asking, delegating and bookkeeping: the Manager does these at the desk.
const MANAGER = new Set([
  'Agent', 'Task', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'AskUserQuestion',
  'EnterPlanMode', 'ExitPlanMode', 'Skill', 'ToolSearch', 'SendMessage', 'ListAgents', 'ReadNotifications',
  'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'EnterWorktree', 'ExitWorktree', 'Sleep',
])

/** Everything else (web, MCP, a tool it doesn't know) goes outside: the Courier. */
export const whoFor = (tool: string): Who =>
  ARCHIVE.has(tool) ? 'archivist' : TYPE.has(tool) ? 'typist' : IT.has(tool) ? 'it' : MANAGER.has(tool) ? 'manager' : 'courier'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Text cut to `n` characters, an ellipsis at the end when cut. */
export const fit = (s: string, n: number): string => {
  const a = Array.from(s)
  return a.length <= n ? s : a.slice(0, Math.max(0, n - 1)).join('') + '…'
}

export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export const basename = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

/** A path relative to the project, or with the home folder as ~. */
export const shortPath = (p: string, cwd?: string): string => {
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  return p.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

/** Hides what looks like a password, token or key in a command or URL. */
export const mask = (s: string): string =>
  s
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1…@')
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 …')
    .replace(/(--?[\w-]*(?:token|secret|password|passwd|apikey|api-key|api_key)[\w-]*[= ])("[^"]*"|'[^']*'|\S+)/gi, '$1…')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, '$1=…')
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[abprs]|AKIA)[-_A-Za-z0-9]{12,}/g, '…')
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '…')

const host = (url: string): string => {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return (m?.[1] ?? url).replace(/^[^@]*@/, '').replace(/^www\./, '')
}

/** An MCP server's short name: "claude-in-chrome" → "chrome", "claude_ai_Claude_Docs" → "Claude_Docs". */
const serverName = (server: string): string => server.replace(/^(?:claude[-_]in[-_]|claude[-_]ai[-_]|plugin[-_][^_]+[-_]+)/i, '') || server

export type Label = { who: Who; short: string; full: string }

/** Who handles a tool call, a few characters for the bubble, and the whole action for the list. */
export function describe(tool: string, input: Record<string, unknown>, cwd?: string): Label {
  const who = whoFor(tool)
  const path = str(input.file_path) || str(input.notebook_path) || str(input.filePath) || str(input.path)
  switch (tool) {
    case 'Read':
      return { who, short: basename(path), full: 'Read ' + shortPath(path, cwd) }
    case 'Edit':
    case 'MultiEdit':
      return { who, short: basename(path), full: 'Edit ' + shortPath(path, cwd) }
    case 'Write':
      return { who, short: basename(path), full: 'Write ' + shortPath(path, cwd) }
    case 'NotebookEdit':
      return { who, short: basename(path), full: 'Edit notebook ' + shortPath(path, cwd) }
    case 'Grep': {
      const p = oneLine(str(input.pattern))
      return { who, short: p, full: 'Search "' + p + '"' + (str(input.path) ? ' in ' + shortPath(str(input.path), cwd) : '') }
    }
    case 'Glob': {
      const p = oneLine(str(input.pattern))
      return { who, short: p, full: 'Find files ' + p }
    }
    case 'LSP': {
      const op = str(input.operation) || 'lookup'
      return { who, short: path ? basename(path) : op, full: 'Code lookup (' + op + ')' + (path ? ' in ' + shortPath(path, cwd) : '') }
    }
    case 'Bash':
    case 'PowerShell': {
      const c = oneLine(mask(str(input.command)))
      const bg = input.run_in_background === true
      return { who, short: c.split(' ').slice(0, 2).join(' '), full: '$ ' + c + (bg ? ' (in background)' : '') }
    }
    case 'BashOutput':
    case 'TaskOutput':
      return { who, short: 'output', full: 'Checking a background command' }
    case 'KillShell':
    case 'KillBash':
    case 'TaskStop':
      return { who, short: 'stop', full: 'Stopping a background command' }
    case 'Monitor':
      return { who, short: 'watching', full: 'Watching ' + (oneLine(str(input.description)) || 'a process') }
    case 'WebSearch': {
      const q = oneLine(str(input.query))
      return { who, short: q, full: 'Web search: ' + q }
    }
    case 'WebFetch': {
      const url = mask(str(input.url))
      return { who, short: host(url), full: 'Fetch ' + url }
    }
  }
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')
    const s = serverName(server)
    return { who, short: s, full: s + ': ' + name.replace(/_/g, ' ') }
  }
  return { who, short: tool, full: tool }
}

/** The question an AskUserQuestion call asks, for the Manager's line. */
export function questionOf(input: Record<string, unknown>): string {
  const qs = Array.isArray(input.questions) ? input.questions : []
  const first = qs[0] as { question?: unknown } | undefined
  const q = oneLine(str(first?.question))
  return q ? 'Asks you: ' + q : 'Has a question for you'
}

/** A duration as "2m 14s" or "8s". */
export const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'
}
