import { expect, test } from 'claude-code/testing'

import { describe as label, mask } from '../hooks/labels'

test('each tool goes to the right worker, with short and full words', async () => {
  expect(label('Read', { file_path: '/proj/src/auth.ts' }, '/proj')).toEqual({ who: 'archivist', short: 'auth.ts', full: 'Read src/auth.ts' })
  expect(label('Edit', { file_path: '/Users/me/x/a.ts' }).full).toBe('Edit ~/x/a.ts')
  expect(label('Bash', { command: 'npm   test --watch' })).toEqual({ who: 'it', short: 'npm test', full: '$ npm test --watch' })
  expect(label('WebSearch', { query: 'oauth expiry' }).who).toBe('researcher')
  expect(label('mcp__claude-in-chrome__navigate', {})).toEqual({ who: 'courier', short: 'chrome', full: 'chrome: navigate' })
  expect(label('SomeNewTool', {}).who).toBe('courier')
  expect(label('TodoWrite', {})).toEqual({ who: 'planner', short: 'to-dos', full: 'Update the to-do list' })
  expect(label('ToolSearch', { query: 'select:Read' })).toEqual({ who: 'librarian', short: 'tools', full: 'Look up tools: Read' })
  expect(label('AskUserQuestion', {}).who).toBe('manager')
  // Work that used to be the Manager's alone.
  expect(label('SendMessage', { to: 'tester' })).toEqual({ who: 'courier', short: 'to tester', full: 'Note to tester' })
  expect(label('ListAgents', {}).who).toBe('courier')
  expect(label('EnterWorktree', { name: 'fix' })).toEqual({ who: 'it', short: 'worktree', full: 'Set up a worktree: fix' })
  expect(label('Agent', { description: 'find login' })).toEqual({ who: 'planner', short: 'new agent', full: 'Brief a new agent: find login', brief: true })
})

test('secrets in a command are hidden', async () => {
  expect(mask('API_KEY=abc123 curl -H "Authorization: Bearer abcdefghijkl" https://u:p@x.io')).toBe('API_KEY=… curl -H "Authorization: Bearer …" https://…@x.io')
  expect(mask('gh auth login --with-token ghp_abcdefghijklmnop1234')).not.toContain('ghp_')
})
