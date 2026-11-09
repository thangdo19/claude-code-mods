import { expect, test } from 'claude-code/testing'

import { bashWho, describe as label, mask } from '../hooks/labels'

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

test('shell commands are shared out: looking at files to the Archivist, git to the Courier, the rest to IT', async () => {
  expect(['cat a.ts', 'ls -la', 'rg login src', 'cd /p && wc -l a.ts', 'cd a; cd b && rtk grep x', 'which node'].map(bashWho)).toEqual(Array(6).fill('archivist'))
  expect(['git push', 'rtk git status', 'cd /p && gh pr view 3'].map(bashWho)).toEqual(['courier', 'courier', 'courier'])
  expect(['npm test', 'sleep 8 && echo hi', 'rm -rf dist', 'cd /p && make', ''].map(bashWho)).toEqual(Array(5).fill('it'))
  expect(label('Bash', { command: 'git push' }).who).toBe('courier')
  // A background command stays with IT, on the server rack.
  expect(label('Bash', { command: 'ls -R', run_in_background: true }).who).toBe('it')
})

test('secrets in a command are hidden', async () => {
  expect(mask('API_KEY=abc123 curl -H "Authorization: Bearer abcdefghijkl" https://u:p@x.io')).toBe('API_KEY=… curl -H "Authorization: Bearer …" https://…@x.io')
  expect(mask('gh auth login --with-token ghp_abcdefghijklmnop1234')).not.toContain('ghp_')
})
