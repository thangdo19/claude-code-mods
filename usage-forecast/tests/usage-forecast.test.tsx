import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import {
  addSpend,
  fmtLeft,
  fmtLimitDelta,
  fmtModel,
  fmtReset,
  fmtTokens,
  learnRate,
  limitDeltas,
  pushHistory,
  reviveLimits,
  sameModel,
  sparkline,
  spendSince,
  turnDelta,
  usageCells,
  weatherFor,
} from '../hooks/weather'

const NOW = Date.parse('2026-10-10T10:00:00Z')
const props = (isWorking: boolean) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 20,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})
const band = { plugin: 'usage-forecast', surface: 'terminal', component: 'AbovePrompt' } as const
const limit = (kind: string, percentUsed: number, resetsAt = '2026-10-10T21:50:00Z') => ({ kind, percentUsed, resetsAt })

describe('helpers', () => {
  test('weather thresholds', () => {
    const word = (p: number) => weatherFor(p).word
    expect([0, 24, 25, 49, 50, 74, 75, 89, 90, 100].map(word)).toEqual([
      'Clear', 'Clear', 'Cloudy', 'Cloudy', 'Showers', 'Showers', 'Storm', 'Storm', 'Compact soon', 'Compact soon',
    ])
    expect(weatherFor(10).color).toBe('yellow')
    expect(weatherFor(95).icon).toBe('↯')
  })

  test('token counts', () => {
    expect(fmtTokens(134400)).toBe('134.4k')
    expect(fmtTokens(200000)).toBe('200k')
    expect(fmtTokens(1000000)).toBe('1M')
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(-112300)).toBe('-112.3k')
  })

  test('sparkline scales to the window and keeps 12', () => {
    expect(sparkline([0, 100000, 199999, 200000], 200000).map(b => b.ch).join('')).toBe('▁▅██')
    expect(sparkline([0, 100000], 200000).map(b => b.color)).toEqual(['yellow', 'blue'])
    const many = Array.from({ length: 15 }, (_, i) => i)
    expect(pushHistory(many, 99)).toHaveLength(12)
    expect(pushHistory(many, 99).at(-1)).toBe(99)
    expect(sparkline(many, 200000)).toHaveLength(12)
  })

  test('usage bar is always its width, filled in eighths', () => {
    for (const p of [0, 4, 50, 99.9, 100, 140, -3]) expect(usageCells(p, 30)).toHaveLength(30)
    expect(usageCells(0, 10)).toBe(' '.repeat(10))
    expect(usageCells(100, 10)).toBe('█'.repeat(10))
    expect(usageCells(4, 30).trimEnd()).toBe('█▏') // 1.2 cells
    expect(usageCells(50, 10).trimEnd()).toBe('█████')
  })

  test('reset times read like /usage', () => {
    const at = (h: number, m: number, day = 16) => new Date(2026, 9, day, h, m).toISOString()
    expect(fmtReset(at(4, 50), false)).toBe('4:50am')
    expect(fmtReset(at(4, 0), true)).toBe('Oct 16 at 4am')
    expect(fmtReset(at(0, 5), false)).toBe('12:05am')
    expect(fmtReset(at(12, 0), false)).toBe('12pm')
    expect(fmtReset('nonsense', false)).toBe('')
  })

  test('time left reads in two units at most', () => {
    const min = 60_000
    expect(fmtLeft(30_000)).toBe('<1m')
    expect(fmtLeft(-5 * min)).toBe('<1m')
    expect(fmtLeft(10 * min)).toBe('10m')
    expect(fmtLeft(120 * min)).toBe('2h')
    expect(fmtLeft(130 * min)).toBe('2h 10m')
    expect(fmtLeft((5 * 24 + 3) * 60 * min + 59 * min)).toBe('5d 3h')
    expect(fmtLeft(2 * 24 * 60 * min)).toBe('2d')
  })

  test('saved limits past their reset come back fresh', () => {
    const [kept, fresh] = reviveLimits([limit('five_hour', 40, '2026-10-10T12:00:00Z'), limit('seven_day', 70, '2026-10-01T00:00:00Z')], NOW)
    expect(kept).toEqual(limit('five_hour', 40, '2026-10-10T12:00:00Z'))
    expect(fresh).toEqual({ kind: 'seven_day', percentUsed: 0, resetsAt: undefined })
  })

  test('limit deltas', () => {
    expect(limitDeltas([limit('five_hour', 5.5), limit('seven_day', 1)], { five_hour: 4 })).toEqual({ five_hour: 1.5 })
  })

  test('limit change wording', () => {
    expect(fmtLimitDelta(1.5, 'last')).toBe('▲ +1.5% last turn')
    expect(fmtLimitDelta(0, 'last')).toBe('▲ <1% last turn')
    expect(fmtLimitDelta(-93, 'last')).toBe('↺ reset last turn')
    expect(fmtLimitDelta(0.5, 'this')).toBe('+0.5% this turn')
    expect(fmtLimitDelta(0, 'this')).toBe('')
    expect(fmtLimitDelta(-1, 'this')).toBe('↺ reset this turn')
  })

  test('model names', () => {
    expect(fmtModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(fmtModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(fmtModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(fmtModel('claude-opus-4-20250514')).toBe('Opus 4')
    expect(fmtModel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(fmtModel('us.anthropic.claude-haiku-5-5-v1:0')).toBe('Haiku 5.5')
    expect(fmtModel('claude-fable-5-1@20260901')).toBe('Fable 5.1')
    expect(fmtModel('opus')).toBe('Opus')
    expect(fmtModel('sonnet[1m]')).toBe('Sonnet')
    // A family this mod has never heard of reads the same way.
    expect(fmtModel('claude-lyric-6-1')).toBe('Lyric 6.1')
    expect(fmtModel('claude-4-lyric-20270101')).toBe('Lyric 4')
    expect([fmtModel(''), fmtModel('default'), fmtModel('<synthetic>')]).toEqual([null, null, null])
    expect(fmtModel('gateway/my-model')).toBe('my-model')
    expect(fmtModel('a-very-long-custom-model-name-v2')).toBe('a-very-long-custom-mode…')
    expect(sameModel('Opus', 'Opus 5.5')).toBe(true)
    expect(sameModel('Opus 5.5', 'Opus')).toBe(true)
    expect(sameModel('Opus 5.5', 'Opus 4')).toBe(false)
    expect(sameModel('Opus', 'Sonnet 5.5')).toBe(false)
  })

  test('own spend only grows, even when the session total starts over', () => {
    expect(addSpend({ usd: null, spent: 0 }, 4)).toEqual({ usd: 4, spent: 0 })
    expect(addSpend({ usd: 4, spent: 0 }, 5.5)).toEqual({ usd: 5.5, spent: 1.5 })
    expect(addSpend({ usd: 5.5, spent: 1.5 }, 0.25)).toEqual({ usd: 0.25, spent: 1.75 })
  })

  test('spend since a snapshot counts every session, new ones in full', () => {
    expect(spendSince({ a: 1, gone: 9 }, { a: 3, b: 0.5 })).toBe(2.5)
  })

  test('a rate is learned over the window, and kept into the next', () => {
    const reset = '2026-10-10T15:00:00Z'
    const first = learnRate(undefined, limit('five_hour', 10, reset), { a: 0 })
    expect(first).toEqual({ rate: null, pct: 10, resetsAt: reset, snap: { a: 0 } })
    // Too little moved to measure yet.
    expect(learnRate(first, limit('five_hour', 11, reset), { a: 2 })).toBe(first)
    const learned = learnRate(first, limit('five_hour', 14, reset), { a: 1.5, b: 0.5 })
    expect(learned.rate).toBe(2)
    expect(learned.snap).toEqual({ a: 0 })
    // A reset time a few minutes off is the same window.
    expect(learnRate(learned, limit('five_hour', 14, '2026-10-10T15:05:00Z'), { a: 2 }).pct).toBe(10)
    const next = learnRate(learned, limit('five_hour', 1, '2026-10-10T20:00:00Z'), { a: 2, b: 1 })
    expect(next).toEqual({ rate: 2, pct: 1, resetsAt: '2026-10-10T20:00:00Z', snap: { a: 2, b: 1 } })
  })

  test("a turn's change: own share with a rate, the account's without, a reset either way", () => {
    expect(turnDelta(14, 10, 0.5, 2)).toBe(1)
    expect(turnDelta(14, undefined, 0.5, 2)).toBe(1)
    expect(turnDelta(10, 10, 0.01, 2)).toBe(0.1)
    expect(turnDelta(10, 10, 0, 2)).toBe(0)
    expect(turnDelta(14, 10, 0.5, undefined)).toBe(4)
    expect(turnDelta(14, undefined, 0.5, undefined)).toBeUndefined()
    expect(turnDelta(2, 95, 0.5, 2)).toBe(-93)
  })
})

describe('band', () => {
  test('fresh session: estimate and last-known limits before the first reply', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    mock.store(on, {
      lastLimits: { at: NOW - 12 * 60_000, limits: [limit('five_hour', 4), limit('seven_day', 30, '2026-10-01T00:00:00Z')] },
    })
    on('session.usage', () => ({ value: ({ startedAt: NOW, context: { window: 200000, breakdown: { totalTokens: 18200 } }, rateLimits: [] }) }) as never)
    on('session.start', () => ({ cwd: '/' }) as never)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /☀ Clear/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\b9%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /18\.2k \/ 200k/ })).toBeDefined()
    // The start figure is counted, not measured, but reads without "~" or "est.".
    expect(await ui.find({ type: 'Text', text: /~|est\./ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /waiting for first reply/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 4%$/ })).toBeDefined()
    // The weekly window reset since it was saved: fresh.
    expect(await ui.find({ type: 'Text', text: /window reset/ })).toBeDefined()
  })

  test('start count uses the /context count, and the local estimate if that fails', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    mock.store(on)
    const asked: (string | undefined)[] = []
    on('session.usage', ($, e) => {
      asked.push(e.breakdown)
      if (e.breakdown === 'full') throw new Error('token count unavailable')
      return { value: { startedAt: NOW, context: { window: 200000, breakdown: { totalTokens: 30000 } }, rateLimits: [] } } as never
    })
    on('session.start', () => ({ cwd: '/' }) as never)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

    expect(asked).toEqual(['full', 'summary'])
    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /\b15%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /30k \/ 200k/ })).toBeDefined()
  })

  test('live through a turn: this turn while working, last turn kept into the next', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    mock.store(on)
    let usage = { startedAt: NOW, context: { window: 200000, tokens: 36100 }, rateLimits: [limit('five_hour', 4), limit('seven_day', 0)] }
    on('session.usage', () => ({ value: usage }) as never)
    on('session.start', () => ({ cwd: '/' }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* () {
      return { turnId: 't1', index: 0, answer: '', toolUses: [] } as never
    })
    on('turn.complete', () => ({ text: '' }))
    const step = async () => {
      for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 } as never)) void _
    }

    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.start({ text: 'hi', turnId: 't1' })

    usage = { ...usage, context: { window: 200000, tokens: 80000 }, rateLimits: [limit('five_hour', 5), limit('seven_day', 0)] }
    await step()
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /40%/ })).toBeDefined()
    expect(await working.find({ type: 'Text', text: /\+1% this turn/ })).toBeDefined()

    usage = { ...usage, context: { window: 200000, tokens: 134400 }, rateLimits: [limit('five_hour', 5.5), limit('seven_day', 0)] }
    await step()
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const idle = await $.ui.mount({ ...band, props: props(false) })
    expect(await idle.find({ type: 'Text', text: /☂ Showers/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /134\.4k \/ 200k/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /▲ \+98\.3k last turn/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /^ 5\.5%$/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /▲ \+1\.5% last turn/ })).toBeDefined()
    // Week did not move: the slot reads <1% instead of going blank.
    expect(await idle.find({ type: 'Text', text: /▲ <1% last turn/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /this turn/ })).toBeUndefined()
    // 10:00 to 21:50 UTC: the countdown, then the local clock time.
    expect(await idle.find({ type: 'Text', text: /^ · resets in 11h 50m \(.+\)$/ })).toBeDefined()

    // A 100-column terminal shrinks the bar to 11 cells so both deltas and the reset still fit.
    const narrow = await $.ui.mount({ ...band, props: { ...props(false), bodyColumns: 100 } })
    expect(await narrow.find({ type: 'Text', text: /^▌ {10}$/ })).toBeDefined()

    // The next answer starts: the previous one's cost stays on screen.
    await $.turn.start({ text: 'next', turnId: 't2' })
    const next = await $.ui.mount({ ...band, props: props(true) })
    expect(await next.find({ type: 'Text', text: /▲ \+1\.5% last turn/ })).toBeDefined()
    expect(await next.find({ type: 'Text', text: /this turn/ })).toBeUndefined()

    usage = { ...usage, rateLimits: [limit('five_hour', 6), limit('seven_day', 0)] }
    await step()
    const both = await $.ui.mount({ ...band, props: props(true) })
    expect(await both.find({ type: 'Text', text: /\+0\.5% this turn/ })).toBeDefined()
    expect(await both.find({ type: 'Text', text: /▲ \+1\.5% last turn/ })).toBeDefined()

  })

  test('a subagent turn does not count as one of yours', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    mock.store(on)
    on('session.usage', () => ({ value: ({ startedAt: NOW, context: { window: 200000, tokens: 50000 }, rateLimits: [] }) }) as never)
    on('session.start', () => ({ cwd: '/' }) as never)
    on('turn.complete', () => ({ text: '' }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'x', reason: 'answer', agentId: 'a1' })

    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /▁/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /·{12}/ })).toBeDefined()
  })

  test('after a compaction it measures again instead of showing a stale fill', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    mock.store(on)
    on('session.usage', () => ({ value: ({ startedAt: NOW, context: { window: 200000, tokens: 150000 }, rateLimits: [] }) }) as never)
    on('session.start', () => ({ cwd: '/' }) as never)
    on('session.compact', ($, e) => ({ messages: e.messages }) as never)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)

    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /measuring…/ })).toBeDefined()
  })

  test('/clear drops the old turns but keeps the limits', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    mock.store(on)
    let usage = { startedAt: NOW, context: { window: 200000, tokens: 90000 }, rateLimits: [limit('five_hour', 20)] }
    on('session.usage', () => ({ value: usage }) as never)
    on('session.start', () => ({ cwd: '/' }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', () => ({ sessionId: 's' }) as never)
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    usage = { ...usage, rateLimits: [limit('five_hour', 22)] }
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as never)

    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /measuring…/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /·{12}/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /compacted/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ 22%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▲ \+2% last turn/ })).toBeDefined()
  })

  test('limits pushed by session.measure show live and are saved for next time', async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    mock.store(on)
    on('session.usage', () => ({ value: ({ startedAt: NOW, context: { window: 200000 }, rateLimits: [] }) }) as never)
    on('session.start', () => ({ cwd: '/' }) as never)
    on('session.measure', ($, e) => ({ changed: e.changed }))
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
    await $.session.measure({ context: { window: 200000, tokens: 20000 }, rateLimits: [limit('five_hour', 12)], changed: ['context', 'rateLimits'] })

    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /^ 12%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Session/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Week/ })).toBeUndefined()
  })
})

describe('edge cases', () => {
  // A session with live usage from a mutable reading, and helpers to drive a main turn.
  type Reading = { tokens?: number; estimate?: number; limits?: ReturnType<typeof limit>[]; isFailing?: boolean }
  const harness = (on: Parameters<TestBody>[1], first: Reading) => {
    const state = {
      usage: {
        startedAt: NOW,
        context: { window: 200000, tokens: first.tokens, breakdown: first.estimate === undefined ? undefined : { totalTokens: first.estimate } },
        rateLimits: first.limits ?? [],
      } as { startedAt: number; context: { window: number; tokens?: number; breakdown?: { totalTokens: number } }; rateLimits: ReturnType<typeof limit>[] },
    }
    on('ui.render', { component: 'AbovePrompt' }, () => null as never)
    on('session.usage', () => {
      if (first.isFailing) throw new Error('usage unavailable')
      return { value: state.usage } as never
    })
    on('session.start', () => ({ cwd: '/' }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
    })
    on('turn.complete', () => ({ text: '' }))
    on('session.compact', ($, e) => ({ messages: e.messages }) as never)
    on('session.end', () => ({ sessionId: 's' }) as never)
    on('session.measure', ($, e) => ({ changed: e.changed }))
    return state
  }
  const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  const step = async ($: Engine, turnId: string) => {
    for await (const _ of $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1 } as never)) void _
  }
  const complete = ($: Engine, turnId: string, extra: Record<string, unknown> = { reason: 'answer' }) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, ...extra } as never)
  const compact = ($: Engine, trigger: string) =>
    $.session.compact({ trigger, messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)

  test('/resume into another conversation drops the old turns but keeps the limits', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    const s = harness(on, { tokens: 90000, limits: [limit('five_hour', 20)] })
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, context: { window: 200000, tokens: 120000 }, rateLimits: [limit('five_hour', 23)] }
    await complete($, 't1')
    await $.session.end({ reason: 'resume', sessionId: 's', resume: {} } as never)

    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /measuring…/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /·{12}/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+30k last turn/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^ 23%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▲ \+3% last turn/ })).toBeDefined()
  })

  test('a background precompute leaves the reading alone; a real compaction blanks it', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    harness(on, { tokens: 150000 })
    await start($)
    await compact($, 'precompute')
    const before = await $.ui.mount({ ...band, props: props(false) })
    expect(await before.find({ type: 'Text', text: /75%/ })).toBeDefined()
    expect(await before.find({ type: 'Text', text: /measuring…/ })).toBeUndefined()

    await compact($, 'auto')
    const after = await $.ui.mount({ ...band, props: props(false) })
    expect(await after.find({ type: 'Text', text: /measuring…/ })).toBeDefined()
  })

  test('a live window whose reset passes while idle reads fresh, and the next turn counts from 0', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const s = harness(on, { tokens: 40000, limits: [limit('five_hour', 94, '2026-10-10T10:30:00Z')] })
    await start($)
    const busy = await $.ui.mount({ ...band, props: props(false) })
    expect(await busy.find({ type: 'Text', text: /^ 94%$/ })).toBeDefined()

    await clock.advance(31 * 60_000)
    const fresh = await $.ui.mount({ ...band, props: props(false) })
    expect(await fresh.find({ type: 'Text', text: /^ 0%$/ })).toBeDefined()
    expect(await fresh.find({ type: 'Text', text: /window reset/ })).toBeDefined()
    expect(await fresh.find({ type: 'Text', text: /resets/ })).toBeUndefined()

    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 2, '2026-10-10T15:30:00Z')] }
    await complete($, 't1')
    const next = await $.ui.mount({ ...band, props: props(false) })
    expect(await next.find({ type: 'Text', text: /▲ \+2% last turn/ })).toBeDefined()
  })

  test('a window that resets during a turn says so instead of going blank', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    const s = harness(on, { tokens: 40000, limits: [limit('five_hour', 95)] })
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 2, '2026-10-10T15:00:00Z')] }
    await step($, 't1')
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /↺ reset this turn/ })).toBeDefined()

    await complete($, 't1')
    const idle = await $.ui.mount({ ...band, props: props(false) })
    expect(await idle.find({ type: 'Text', text: /↺ reset last turn/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /this turn/ })).toBeUndefined()
  })

  test('a shrink against the start estimate is not called a compaction; a real one is', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    const s = harness(on, { estimate: 18200 })
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, context: { window: 200000, tokens: 16100 } }
    await complete($, 't1')
    const first = await $.ui.mount({ ...band, props: props(false) })
    expect(await first.find({ type: 'Text', text: /▼ −2\.1k last turn/ })).toBeDefined()
    expect(await first.find({ type: 'Text', text: /~/ })).toBeUndefined()
    expect(await first.find({ type: 'Text', text: /compacted/ })).toBeUndefined()

    await compact($, 'manual')
    await $.turn.start({ text: 'go on', turnId: 't2' })
    s.usage = { ...s.usage, context: { window: 200000, tokens: 9000 } }
    await complete($, 't2')
    const second = await $.ui.mount({ ...band, props: props(false) })
    expect(await second.find({ type: 'Text', text: /▼ −7\.1k compacted/ })).toBeDefined()

    // The flag is spent: a later shrink with no compaction reads as a turn again.
    await $.turn.start({ text: 'more', turnId: 't3' })
    s.usage = { ...s.usage, context: { window: 200000, tokens: 8000 } }
    await complete($, 't3')
    const third = await $.ui.mount({ ...band, props: props(false) })
    expect(await third.find({ type: 'Text', text: /▼ −1k last turn/ })).toBeDefined()
    expect(await third.find({ type: 'Text', text: /compacted/ })).toBeUndefined()
  })

  test('a turn cancelled before any reply is not counted', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    const s = harness(on, { tokens: 36100, limits: [limit('five_hour', 4)] })
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, context: { window: 200000, tokens: 80000 }, rateLimits: [limit('five_hour', 6)] }
    await complete($, 't1')

    await $.turn.start({ text: 'oops', turnId: 't2' })
    await complete($, 't2', { reason: 'aborted', isAborted: true })
    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /·{11}/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▲ \+43\.9k last turn/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▲ \+2% last turn/ })).toBeDefined()

    // One that was interrupted after a reply still counts.
    await $.turn.start({ text: 'again', turnId: 't3' })
    s.usage = { ...s.usage, context: { window: 200000, tokens: 90000 } }
    await complete($, 't3', { reason: 'aborted', isAborted: true, usage: { inputTokens: 1, outputTokens: 1 } })
    const later = await $.ui.mount({ ...band, props: props(false) })
    expect(await later.find({ type: 'Text', text: /·{10}/ })).toBeDefined()
    expect(await later.find({ type: 'Text', text: /▲ \+10k last turn/ })).toBeDefined()
  })

  test('failed usage reads: the timer still runs and the turn still closes', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    harness(on, { isFailing: true })
    await start($)
    await $.session.measure({ context: { window: 200000, tokens: 20000 }, rateLimits: [limit('five_hour', 4, '2026-10-10T10:30:00Z')], changed: ['context', 'rateLimits'] })
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.session.measure({ context: { window: 200000, tokens: 30000 }, rateLimits: [limit('five_hour', 6, '2026-10-10T10:30:00Z')], changed: ['context', 'rateLimits'] })
    await complete($, 't1')
    const done = await $.ui.mount({ ...band, props: props(false) })
    expect(await done.find({ type: 'Text', text: /▲ \+2% last turn/ })).toBeDefined()

    await clock.advance(31 * 60_000)
    const later = await $.ui.mount({ ...band, props: props(false) })
    expect(await later.find({ type: 'Text', text: /window reset/ })).toBeDefined()
  })

  test('limits that leave, or a logout, clear the bars and the saved copy', async ($, on) => {
    mock.clock(on, { now: NOW })
    const saved: Record<string, unknown> = {}
    on('store.get', ($, e) => ({ value: saved[e.key] }) as never)
    on('store.set', ($, e) => {
      saved[e.key] = e.value
      return { value: undefined } as never
    })
    on('store.delete', ($, e) => {
      delete saved[e.key]
      return { value: undefined } as never
    })
    harness(on, { tokens: 20000 })
    await start($)
    const push = (rateLimits: ReturnType<typeof limit>[]) =>
      $.session.measure({ context: { window: 200000, tokens: 20000 }, rateLimits, changed: ['rateLimits'] })

    await push([limit('five_hour', 12)])
    expect(saved.lastLimits).toBeDefined()
    await push([])
    const gone = await $.ui.mount({ ...band, props: props(false) })
    expect(await gone.find({ type: 'Text', text: /Session/ })).toBeUndefined()
    expect(saved.lastLimits).toBeUndefined()

    await push([limit('five_hour', 15)])
    await $.session.end({ reason: 'logout', sessionId: 's', resume: {} } as never)
    const out = await $.ui.mount({ ...band, props: props(false) })
    expect(await out.find({ type: 'Text', text: /Session/ })).toBeUndefined()
    expect(await out.find({ type: 'Text', text: /Clear/ })).toBeDefined()
    expect(saved.lastLimits).toBeUndefined()
  })

  // A store shared with other sessions, as the one JSON file on disk is.
  const sharedStore = (on: Parameters<TestBody>[1], entries: Record<string, unknown> = {}) => {
    const saved: Record<string, unknown> = { ...entries }
    on('store.get', ($, e) => ({ value: saved[e.key] }) as never)
    on('store.set', ($, e) => {
      saved[e.key] = e.value
      return { value: undefined } as never
    })
    on('store.delete', ($, e) => {
      delete saved[e.key]
      return { value: undefined } as never
    })
    on('store.keys', () => ({ value: Object.keys(saved) }) as never)
    return saved
  }
  const RESET = '2026-10-10T21:50:00Z'

  test("in parallel, each session shows its own share, not the other session's", async ($, on) => {
    mock.clock(on, { now: NOW })
    // Another session learned 2% per dollar and is spending too.
    const saved = sharedStore(on, {
      rates: { five_hour: { rate: 2, pct: 10, resetsAt: RESET, snap: {} } },
      'spend.other': { usd: 3, at: NOW },
    })
    const s = harness(on, { tokens: 40000, limits: [limit('five_hour', 10)] })
    const cost = (usd: number) => (s.usage = { ...s.usage, cost: { usd } } as typeof s.usage)
    cost(0)
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })

    // The account moved 4 points, mostly the other session; this one spent $0.5.
    cost(0.5)
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 14)] }
    await step($, 't1')
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /^ \+1% this turn$/ })).toBeDefined()
    expect(await working.find({ type: 'Text', text: /~|est\./ })).toBeUndefined()
    // Its spend is saved under a key of its own, for the other session to count.
    const own = Object.keys(saved).find(k => k.startsWith('spend.') && k !== 'spend.other')
    expect(saved[own!]).toEqual({ usd: 0.5, at: NOW })

    await complete($, 't1')
    const idle = await $.ui.mount({ ...band, props: props(false) })
    // Both sessions' $3.5 moved 4 points: the rate is relearned from them,
    // and this session's $0.5 comes to 0.6 of the 4.
    expect((saved.rates as Record<string, { rate: number }>).five_hour?.rate).toBe(4 / 3.5)
    expect(await idle.find({ type: 'Text', text: /▲ \+0\.6% last turn/ })).toBeDefined()
  })

  test('a session with no live reading of its own still shows its share', async ($, on) => {
    mock.clock(on, { now: NOW })
    sharedStore(on, {
      lastLimits: { at: NOW - 10 * 60_000, limits: [limit('five_hour', 30)] },
      rates: { five_hour: { rate: 1.5, pct: 20, resetsAt: RESET, snap: {} } },
    })
    const s = harness(on, { tokens: 40000 })
    s.usage = { ...s.usage, cost: { usd: 2 } } as typeof s.usage
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, cost: { usd: 2.4 } } as typeof s.usage
    await step($, 't1')
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /^ \+0\.6% this turn$/ })).toBeDefined()
    await complete($, 't1')
    const idle = await $.ui.mount({ ...band, props: props(false) })
    expect(await idle.find({ type: 'Text', text: /▲ \+0\.6% last turn/ })).toBeDefined()
  })

  test("before any rate, another session's reading from just now is the baseline", async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const saved = sharedStore(on, { lastLimits: { at: NOW - 10 * 60_000, limits: [limit('five_hour', 30)] } })
    const s = harness(on, { tokens: 40000 })
    await start($)
    await clock.advance(10_000)
    saved.lastLimits = { at: NOW + 5_000, limits: [limit('five_hour', 31)] }
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 33)] }
    await step($, 't1')
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /^ \+2% this turn$/ })).toBeDefined()
  })

  test('saved limits show in full orange, with no age note', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on, { lastLimits: { at: NOW - 5 * 60_000, limits: [limit('five_hour', 4)] } })
    harness(on, { estimate: 10000 })
    await start($)
    const ui = await $.ui.mount({ ...band, props: props(false) })
    const bar = await ui.find({ type: 'Text', text: /^█▏ +$/ })
    expect(bar?.props.color).toBe('claude')
    expect(bar?.props.dimColor).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^Session/ }))?.props.dimColor).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /as of/ })).toBeUndefined()
  })

  test('a limit at 90% or more draws red; with no model name the band still draws', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    harness(on, { tokens: 40000, limits: [limit('five_hour', 90), limit('seven_day', 89.9)] })
    await start($)
    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect((await ui.find({ type: 'Text', text: /^ 90%$/ }))?.props.color).toBe('red')
    expect((await ui.find({ type: 'Text', text: /^ 89\.9%$/ }))?.props.color).toBe('claude')
    expect(await ui.find({ type: 'Text', text: /◆/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /☀ Clear/ })).toBeDefined()
  })

  describe('the model', () => {
    const switchTo = ($: Engine, from: string, to: string, extra: Record<string, unknown> = {}) =>
      $.classic.PostModelSwitch({
        from_model: from, to_model: to, requested_model: null, source: 'command', context_tokens: 0,
        prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0, pricing: 'catalog', ...extra,
      } as never)
    const stepOn = async ($: Engine, turnId: string, model: string, extra: Record<string, unknown> = {}) => {
      for await (const _ of $.turn.step({ turnId, index: 0, model, messageCount: 1, ...extra } as never)) void _
    }
    const turn = async ($: Engine, turnId: string, model: string) => {
      await $.turn.start({ text: 'hi', turnId })
      await stepOn($, turnId, model, { effort: 'high' })
      await complete($, turnId)
    }
    const mounted = ($: Engine) => $.ui.mount({ ...band, props: props(false) })
    const setup = (on: Parameters<TestBody>[1], model: string) => {
      mock.clock(on, { now: NOW })
      mock.store(on)
      on('session.model', () => ({ value: model }) as never)
      on('classic.PostModelSwitch', () => ({}) as never)
      return harness(on, { tokens: 40000 })
    }

    test('shows first, effort from the first main request; a subagent does not change it', async ($, on) => {
      setup(on, 'opus')
      await start($)
      let ui = await mounted($)
      expect(await ui.find({ type: 'Text', text: /^◆ Opus$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /high/ })).toBeUndefined()

      await $.turn.start({ text: 'hi', turnId: 't1' })
      await stepOn($, 't1', 'claude-opus-5-5', { effort: 'high' })
      await stepOn($, 't1', 'claude-haiku-5-5', { agentId: 'a1', effort: 'low' })
      ui = await mounted($)
      expect(await ui.find({ type: 'Text', text: /^◆ Opus 5\.5$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^ high$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Haiku|low|switched/ })).toBeUndefined()

      // A model that takes no effort drops it.
      await stepOn($, 't1', 'claude-opus-5-5')
      expect(await (await mounted($)).find({ type: 'Text', text: /high/ })).toBeUndefined()
    })

    test('a switch shows at once and stays through one whole turn', async ($, on) => {
      setup(on, 'claude-opus-5-5')
      await start($)
      await turn($, 't1', 'claude-opus-5-5')
      await switchTo($, 'claude-opus-5-5', 'claude-sonnet-5-5')

      let ui = await mounted($)
      expect(await ui.find({ type: 'Text', text: /^◆ Sonnet 5\.5$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^↻ switched from Opus 5\.5$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeUndefined()
      // The old effort may not apply to the new model.
      expect(await ui.find({ type: 'Text', text: /high/ })).toBeUndefined()

      // Cancelled before any reply: not a turn on the new model.
      await $.turn.start({ text: 'oops', turnId: 't2' })
      await complete($, 't2', { reason: 'aborted', isAborted: true })
      expect(await (await mounted($)).find({ type: 'Text', text: /switched from/ })).toBeDefined()

      await turn($, 't3', 'claude-sonnet-5-5')
      ui = await mounted($)
      expect(await ui.find({ type: 'Text', text: /switched from/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /last turn/ })).toBeDefined()
    })

    test('switching back, to the same model, or in a subagent leaves no note', async ($, on) => {
      setup(on, 'claude-opus-5-5')
      await start($)
      await switchTo($, 'claude-opus-5-5', 'claude-sonnet-5-5')
      await switchTo($, 'claude-sonnet-5-5', 'claude-opus-5-5')
      await switchTo($, 'claude-opus-5-5', 'claude-opus-5-5[1m]')
      await switchTo($, 'claude-opus-5-5', 'claude-haiku-5-5', { agent_id: 'a1' })
      const ui = await mounted($)
      expect(await ui.find({ type: 'Text', text: /^◆ Opus 5\.5$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /switched from/ })).toBeUndefined()
    })

    test('an alias that resolves to another family at the first request is no switch', async ($, on) => {
      setup(on, 'opusplan')
      await start($)
      expect(await (await mounted($)).find({ type: 'Text', text: /^◆ Opusplan$/ })).toBeDefined()
      await turn($, 't1', 'claude-sonnet-5-5')
      const ui = await mounted($)
      expect(await ui.find({ type: 'Text', text: /^◆ Sonnet 5\.5$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /switched from/ })).toBeUndefined()
    })

    test('a switch during a turn shows through the next whole turn', async ($, on) => {
      setup(on, 'claude-opus-5-5')
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      await stepOn($, 't1', 'claude-opus-5-5')
      await switchTo($, 'claude-opus-5-5', 'claude-sonnet-5-5', { source: 'auto' })
      await complete($, 't1')
      expect(await (await mounted($)).find({ type: 'Text', text: /^↻ switched from Opus 5\.5$/ })).toBeDefined()

      await turn($, 't2', 'claude-sonnet-5-5')
      expect(await (await mounted($)).find({ type: 'Text', text: /switched from/ })).toBeUndefined()
    })

    test('a new switch after a turn on the last one names the model just left', async ($, on) => {
      setup(on, 'claude-opus-5-5')
      await start($)
      await switchTo($, 'claude-opus-5-5', 'claude-sonnet-5-5')
      await $.turn.start({ text: 'hi', turnId: 't1' })
      await switchTo($, 'claude-sonnet-5-5', 'claude-haiku-5-5', { source: 'auto' })
      await complete($, 't1')
      expect(await (await mounted($)).find({ type: 'Text', text: /^↻ switched from Sonnet 5\.5$/ })).toBeDefined()
    })

    test('/clear keeps the model', async ($, on) => {
      setup(on, 'claude-opus-5-5')
      await start($)
      await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as never)
      expect(await (await mounted($)).find({ type: 'Text', text: /^◆ Opus 5\.5$/ })).toBeDefined()
    })
  })
})
