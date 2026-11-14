import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import {
  addSpend,
  agentEntries,
  barCells,
  bookModel,
  fableShare,
  fableTurn,
  familyOf,
  paceAt,
  runs,
  serverLimits,
  tidy,
  toAllowance,
  fitItems,
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
import { limitRows } from '../hooks/rows'

const NOW = Date.parse('2026-10-10T10:00:00Z')
const props = (isWorking: boolean) => ({
  hasSurvey: false,
  isCollapsed: false,
  isWorking,
  maxRows: 20,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})
const band = { plugin: 'usage-forecast', surface: 'terminal', component: 'AbovePrompt' } as const
const limit = (kind: string, percentUsed: number, resetsAt = '2026-10-10T21:50:00Z') => ({ kind, percentUsed, resetsAt })
// The bottom of the band's chain: an empty Box (the engine refuses null).
const blankBand = (on: Parameters<TestBody>[1]) =>
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

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
    expect(fresh).toEqual({ kind: 'seven_day', percentUsed: 0, resetsAt: undefined, isReset: true })
  })

  test('limit deltas', () => {
    expect(limitDeltas([limit('five_hour', 5.5), limit('seven_day', 1)], { five_hour: 4 })).toEqual({ five_hour: 1.5 })
  })

  test('limit change wording', () => {
    expect(fmtLimitDelta(1.5, 'last')).toBe('▲ +1.5% last')
    expect(fmtLimitDelta(0, 'last')).toBe('▲ <1% last')
    expect(fmtLimitDelta(-93, 'last')).toBe('↺ reset last')
    expect(fmtLimitDelta(0.5, 'this')).toBe('+0.5% now')
    expect(fmtLimitDelta(0, 'this')).toBe('')
    expect(fmtLimitDelta(-1, 'this')).toBe('↺ reset now')
    // No "you" or "turn" in a limit row any more.
    for (const d of [-1, 0, 0.5]) for (const span of ['this', 'last'] as const) expect(fmtLimitDelta(d, span)).not.toMatch(/you|turn/)
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

  test('own spend only grows: a new ledger counts afresh, a stale reading adds nothing', () => {
    const at = NOW
    expect(addSpend({ usd: null, spent: 0, costFrom: null }, 4, at)).toEqual({ usd: 4, spent: 0, costFrom: at })
    expect(addSpend({ usd: 4, spent: 0, costFrom: at }, 5.5, at)).toEqual({ usd: 5.5, spent: 1.5, costFrom: at })
    // An older reading landing late: not a restart, so nothing is added twice.
    expect(addSpend({ usd: 5.5, spent: 1.5, costFrom: at }, 5.2, at)).toEqual({ usd: 5.5, spent: 1.5, costFrom: at })
    expect(addSpend({ usd: 5.5, spent: 1.5, costFrom: at }, 5.2)).toEqual({ usd: 5.5, spent: 1.5, costFrom: at })
    // A /clear starts a new ledger: its total counts from here.
    expect(addSpend({ usd: 5.5, spent: 1.5, costFrom: at }, 0.25, at + 1)).toEqual({ usd: 0.25, spent: 1.5, costFrom: at + 1 })
    // State from an older version has no ledger start yet.
    expect(addSpend({ usd: 4, spent: 1, costFrom: null }, 5, at)).toEqual({ usd: 5, spent: 2, costFrom: at })
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
    // The next window keeps the rate, and how many points it was measured over.
    const later = '2026-10-10T20:00:00Z'
    expect(next).toEqual({ rate: 2, pct: 1, resetsAt: later, snap: { a: 2, b: 1 }, span: 4 })
    // Its first 2 points for $1.25 could be 1 to 3: the longer-measured rate fits, and stands.
    expect(learnRate(next, limit('five_hour', 3, later), { a: 3, b: 1.25 })).toBe(next)
    // 2 points for $4 is 0.75 a dollar at most: the old rate can't be right any more.
    expect(learnRate(next, limit('five_hour', 3, later), { a: 6, b: 1 })).toMatchObject({ rate: 0.5, span: 2 })
    // Measured over as many points, the new window takes over.
    expect(learnRate(next, limit('five_hour', 5, later), { a: 4.5, b: 1 })).toMatchObject({ rate: 1.6, span: 4 })
  })

  test("a turn's change: own share with a rate, the account's without, a reset either way", () => {
    expect(turnDelta(14, 10, 0.5, 2)).toBe(1)
    expect(turnDelta(14, undefined, 0.5, 2)).toBe(1)
    expect(turnDelta(10, 10, 0.01, 2)).toBe(0.1)
    expect(turnDelta(10, 10, 0, 2)).toBe(0)
    expect(turnDelta(14, 10, 0.5, undefined)).toBe(4)
    expect(turnDelta(14, undefined, 0.5, undefined)).toBeUndefined()
    expect(turnDelta(2, 95, 0.5, 2)).toBe(-93)
    // A rate too high (spend it never saw) can't top the account's move, nor the window.
    expect(turnDelta(26, 20, 11, 12.9)).toBe(7)
    expect(turnDelta(26, undefined, 11, 12.9)).toBe(26)
    expect(turnDelta(20, 20, 0.5, 2)).toBe(1)
    expect(turnDelta(0, undefined, 0.5, 2)).toBe(0)
  })
})

describe('band', () => {
  test('fresh session: estimate and last-known limits before the first reply', async ($, on) => {
    mock.clock(on, { now: NOW })
    blankBand(on)
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
    blankBand(on)
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
    // Halfway through its 5 hours: the pace mark sits mid-bar, clear of the fill.
    const limit5 = (pct: number) => limit('five_hour', pct, '2026-10-10T12:30:00Z')
    blankBand(on)
    mock.store(on)
    let usage = { startedAt: NOW, context: { window: 200000, tokens: 36100 }, rateLimits: [limit5(4), limit('seven_day', 0)] }
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

    usage = { ...usage, context: { window: 200000, tokens: 80000 }, rateLimits: [limit5(5), limit('seven_day', 0)] }
    await step()
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /40%/ })).toBeDefined()
    expect(await working.find({ type: 'Text', text: /\+1% now/ })).toBeDefined()

    usage = { ...usage, context: { window: 200000, tokens: 134400 }, rateLimits: [limit5(5.5), limit('seven_day', 0)] }
    await step()
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const idle = await $.ui.mount({ ...band, props: props(false) })
    expect(await idle.find({ type: 'Text', text: /☂ Showers/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /134\.4k \/ 200k/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /▲ \+98\.3k last turn/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /^ 5\.5%$/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /▲ \+1\.5% last/ })).toBeDefined()
    // Week did not move: the slot reads <1% instead of going blank.
    expect(await idle.find({ type: 'Text', text: /▲ +<1% last$/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /% now/ })).toBeUndefined()
    // 10:00 to 21:50 UTC: the countdown, then the local clock time.
    expect(await idle.find({ type: 'Text', text: /^ · 11h 50m → .+$/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /resets in|you/ })).toBeUndefined()

    // A 100-column terminal shrinks the bar to 11 cells so both deltas and the reset still fit.
    const narrow = await $.ui.mount({ ...band, props: { ...props(false), bodyColumns: 100 } })
    // One orange bar, empty cells included: 5.5% of 11 cells is half a cell;
    // halfway through the window, the pace mark in the 6th cell.
    const bar = await narrow.find({ type: 'Text', text: /^▌ {4}$/ })
    expect(bar?.props.color).toBe('claude')
    expect(bar?.props.backgroundColor).toBe('#4a2e25')
    const mark = await narrow.find({ type: 'Text', text: /^│ {5}$/ })
    expect(mark?.props.color).toBeUndefined()
    expect(mark?.props.backgroundColor).toBe('#4a2e25')

    // The next answer starts: the previous one's cost stays on screen.
    await $.turn.start({ text: 'next', turnId: 't2' })
    const next = await $.ui.mount({ ...band, props: props(true) })
    expect(await next.find({ type: 'Text', text: /▲ \+1\.5% last/ })).toBeDefined()
    expect(await next.find({ type: 'Text', text: /% now/ })).toBeUndefined()

    usage = { ...usage, rateLimits: [limit5(6), limit('seven_day', 0)] }
    await step()
    const both = await $.ui.mount({ ...band, props: props(true) })
    expect(await both.find({ type: 'Text', text: /\+0\.5% now/ })).toBeDefined()
    expect(await both.find({ type: 'Text', text: /▲ \+1\.5% last/ })).toBeDefined()

  })

  test('a subagent turn does not count as one of yours', async ($, on) => {
    mock.clock(on, { now: NOW })
    blankBand(on)
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
    blankBand(on)
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
    blankBand(on)
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
    expect(await ui.find({ type: 'Text', text: /▲ \+2% last/ })).toBeDefined()
  })

  test('limits pushed by session.measure show live and are saved for next time', async ($, on) => {
    mock.clock(on, { now: NOW })
    blankBand(on)
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
    blankBand(on)
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
    expect(await ui.find({ type: 'Text', text: /▲ \+3% last/ })).toBeDefined()
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
    expect(await next.find({ type: 'Text', text: /▲ \+2% last/ })).toBeDefined()
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
    expect(await working.find({ type: 'Text', text: /↺ reset now/ })).toBeDefined()

    await complete($, 't1')
    const idle = await $.ui.mount({ ...band, props: props(false) })
    expect(await idle.find({ type: 'Text', text: /↺ reset last$/ })).toBeDefined()
    expect(await idle.find({ type: 'Text', text: /% now/ })).toBeUndefined()
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
    expect(await ui.find({ type: 'Text', text: /▲ \+2% last/ })).toBeDefined()

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
    expect(await done.find({ type: 'Text', text: /▲ \+2% last/ })).toBeDefined()

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
      'rates.v2': { five_hour: { rate: 2, pct: 10, resetsAt: RESET, snap: {} } },
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
    expect(await working.find({ type: 'Text', text: /^ \+1% now$/ })).toBeDefined()
    expect(await working.find({ type: 'Text', text: /~|est\./ })).toBeUndefined()
    // Its spend is saved under a key of its own, for the other session to count.
    const own = Object.keys(saved).find(k => k.startsWith('spend.') && k !== 'spend.other')
    expect(saved[own!]).toEqual({ usd: 0.5, at: NOW })

    await complete($, 't1')
    const idle = await $.ui.mount({ ...band, props: props(false) })
    // Both sessions' $3.5 moved 4 points: the rate is relearned from them,
    // and this session's $0.5 comes to 0.6 of the 4.
    expect((saved['rates.v2'] as Record<string, { rate: number }>).five_hour?.rate).toBe(4 / 3.5)
    expect(await idle.find({ type: 'Text', text: /▲ \+0\.6% last/ })).toBeDefined()
  })

  test('a session with no live reading of its own still shows its share', async ($, on) => {
    mock.clock(on, { now: NOW })
    sharedStore(on, {
      lastLimits: { at: NOW - 10 * 60_000, limits: [limit('five_hour', 30)] },
      'rates.v2': { five_hour: { rate: 1.5, pct: 20, resetsAt: RESET, snap: {} } },
    })
    const s = harness(on, { tokens: 40000 })
    s.usage = { ...s.usage, cost: { usd: 2 } } as typeof s.usage
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, cost: { usd: 2.4 } } as typeof s.usage
    await step($, 't1')
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /^ \+0\.6% now$/ })).toBeDefined()
    await complete($, 't1')
    const idle = await $.ui.mount({ ...band, props: props(false) })
    expect(await idle.find({ type: 'Text', text: /▲ \+0\.6% last/ })).toBeDefined()
  })

  test('after a /clear, spend is saved again and no rate shows more than the account moved', async ($, on) => {
    mock.clock(on, { now: NOW })
    // Rates from before: the old key goes; the new one is far too high, as
    // when a session's spend went uncounted.
    const saved = sharedStore(on, {
      rates: { five_hour: { rate: 12.9, pct: 0, resetsAt: RESET, snap: {} } },
      'rates.v2': { five_hour: { rate: 12.9, pct: 0, resetsAt: RESET, snap: {} } },
    })
    const s = harness(on, { tokens: 40000, limits: [limit('five_hour', 20)] })
    s.usage = { ...s.usage, cost: { usd: 0 } } as typeof s.usage
    // No session.start: a /clear raises none, and its state may start empty.
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 26)], cost: { usd: 11 } } as typeof s.usage
    await step($, 't1')
    await complete($, 't1')

    const own = Object.keys(saved).find(k => k.startsWith('spend.'))
    expect(saved[own!]).toEqual({ usd: 11, at: NOW })
    expect(saved.rates).toBeUndefined()
    const idle = await $.ui.mount({ ...band, props: props(false) })
    expect(await idle.find({ type: 'Text', text: /▲ \+7% last/ })).toBeDefined()
  })

  test("before any rate, another session's reading from just now is the baseline", async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const saved = sharedStore(on, { lastLimits: { at: NOW - 10 * 60_000, limits: [limit('five_hour', 30)] } })
    const s = harness(on, { tokens: 40000 })
    await start($)
    await clock.advance(10_000)
    saved.lastLimits = { at: NOW + 5_000, limits: [limit('five_hour', 31)] }
    await $.turn.start({ text: 'hi', turnId: 't1' })
    // The bar reads that reading too: against the older 30 the turn looked like a reset.
    const waiting = await $.ui.mount({ ...band, props: props(true) })
    expect(await waiting.find({ type: 'Text', text: /^ 31%$/ })).toBeDefined()
    expect(await waiting.find({ type: 'Text', text: /reset/ })).toBeUndefined()
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 33)] }
    await step($, 't1')
    const working = await $.ui.mount({ ...band, props: props(true) })
    expect(await working.find({ type: 'Text', text: /^ \+2% now$/ })).toBeDefined()
  })

  test("an idle session's bars follow another session's newer reading, never a lower one", async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const saved = sharedStore(on)
    const s = harness(on, { tokens: 40000, limits: [limit('five_hour', 30), limit('seven_day', 8)] })
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    await step($, 't1')
    await complete($, 't1')
    expect(saved.lastLimits).toEqual({ at: NOW, limits: [limit('five_hour', 30), limit('seven_day', 8)] })

    // Another session works on: within a minute this one shows what it read.
    saved.lastLimits = { at: NOW + 30_000, limits: [limit('five_hour', 55), limit('seven_day', 9)] }
    await clock.advance(60_000)
    let ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /^ 55%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 9%$/ })).toBeDefined()

    // A window only fills: a reading that says less of it is not taken.
    saved.lastLimits = { at: NOW + 90_000, limits: [limit('five_hour', 40), limit('seven_day', 9)] }
    await clock.advance(60_000)
    ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /^ 55%$/ })).toBeDefined()

    // The engine still repeats this session's old 30: the next turn counts from 55 all the same.
    await $.turn.start({ text: 'more', turnId: 't2' })
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 56), limit('seven_day', 9)] }
    await step($, 't2')
    ui = await $.ui.mount({ ...band, props: props(true) })
    expect(await ui.find({ type: 'Text', text: /^ \+1% now$/ })).toBeDefined()
  })

  test('a turn cancelled before any reply shares no reading and teaches no rate', async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const saved = sharedStore(on, {
      'rates.v2': { five_hour: { rate: 2, pct: 10, resetsAt: RESET, snap: {} } },
      'spend.other': { usd: 9, at: NOW },
    })
    harness(on, { tokens: 40000, limits: [limit('five_hour', 32)] })
    await start($)
    // Idle while another session worked: its reading is the newest there is.
    await clock.advance(10 * 60_000)
    const theirs = { at: NOW + 9 * 60_000, limits: [limit('five_hour', 50)] }
    saved.lastLimits = theirs
    const rates = JSON.stringify(saved['rates.v2'])

    await $.turn.start({ text: 'oops', turnId: 't1' })
    await complete($, 't1', { reason: 'aborted', isAborted: true })
    // This session's old 32 is not passed off as new, nor measured against the other's spend.
    expect(saved.lastLimits).toEqual(theirs)
    expect(JSON.stringify(saved['rates.v2'])).toBe(rates)
    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect(await ui.find({ type: 'Text', text: /^ 50%$/ })).toBeDefined()
  })

  test('a session that spent nothing leaves no entry, and empty ones go', async ($, on) => {
    mock.clock(on, { now: NOW })
    const saved = sharedStore(on, { 'spend.empty': { usd: 0, at: NOW }, 'spend.other': { usd: 3, at: NOW } })
    const s = harness(on, { tokens: 40000, limits: [limit('five_hour', 10)] })
    s.usage = { ...s.usage, cost: { usd: 0 } } as typeof s.usage
    await start($)
    await $.turn.start({ text: 'hi', turnId: 't1' })
    s.usage = { ...s.usage, rateLimits: [limit('five_hour', 11)] }
    await step($, 't1')
    await complete($, 't1')
    // A missing entry counts as 0: the fewer there are, the less every session reads.
    expect(Object.keys(saved).filter(k => k.startsWith('spend.'))).toEqual(['spend.other'])
  })

  test('saved limits draw the same orange bar, with no age note', async ($, on) => {
    mock.clock(on, { now: NOW })
    // Halfway through its window: the pace mark in cell 15.
    mock.store(on, { lastLimits: { at: NOW - 5 * 60_000, limits: [limit('five_hour', 4, '2026-10-10T12:30:00Z')] } })
    harness(on, { estimate: 10000 })
    await start($)
    const ui = await $.ui.mount({ ...band, props: props(false) })
    // One orange bar, saved or live: 4% of 30 cells is 1.2 cells.
    expect(await ui.find({ type: 'Text', text: /^│ {14}$/ })).toBeDefined()
    const bar = await ui.find({ type: 'Text', text: /^█▏ {13}$/ })
    expect(bar?.props.color).toBe('claude')
    expect(bar?.props.dimColor).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^Session/ }))?.props.dimColor).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /as of/ })).toBeUndefined()
  })

  test('a limit at 90% or more draws red, from 75% amber; with no model name the band still draws', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    // 25 minutes left: both pace marks fall in the empty cells.
    harness(on, { tokens: 40000, limits: [limit('five_hour', 90, '2026-10-10T10:25:00Z'), limit('seven_day', 89.9), limit('spend_limit', 75)] })
    await start($)
    const ui = await $.ui.mount({ ...band, props: props(false) })
    expect((await ui.find({ type: 'Text', text: /^ 90%$/ }))?.props.color).toBe('red')
    expect((await ui.find({ type: 'Text', text: /^ 89\.9%$/ }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: /^ 75%$/ }))?.props.color).toBe('warning')
    // The whole bar turns with its figure: 27 of 30 cells red, 26⅞ amber.
    expect((await ui.find({ type: 'Text', text: /^█{27}$/ }))?.props.color).toBe('red')
    expect((await ui.find({ type: 'Text', text: /^█{26}▉$/ }))?.props.color).toBe('warning')
    expect(await ui.find({ type: 'Text', text: /^│ {2}$/ })).toBeDefined()
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

  describe('agents', () => {
    const RATE = { 'rates.v2': { five_hour: { rate: 2, pct: 10, resetsAt: RESET, snap: {} } } }
    const setup = (on: Parameters<TestBody>[1], entries: Record<string, unknown> = RATE, tokens = 40000) => {
      mock.clock(on, { now: NOW })
      sharedStore(on, entries)
      const s = harness(on, { tokens, limits: [limit('five_hour', 10)] })
      s.usage = { ...s.usage, cost: { usd: 0 } } as typeof s.usage
      on('agent.list', () => ({ value: [] }) as never)
      on('agent.spawn', ($, e) => ({ model: 'claude-haiku-5-5', agentId: e.description === 'scan' ? 'a1' : 'a2' }) as never)
      return s
    }
    type S = ReturnType<typeof setup>
    const read = (s: S, usd: number, extra: Record<string, unknown> = {}) =>
      (s.usage = { ...s.usage, cost: { usd }, ...extra } as typeof s.usage)
    const agentStep = async ($: Engine, agentId: string) => {
      for await (const _ of $.turn.step({ turnId: 'x' + agentId, index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId } as never)) void _
    }
    const agentDone = ($: Engine, agentId: string, reason = 'answer') =>
      $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'x' + agentId, reason, agentId } as never)
    const spawn = ($: Engine, description: string) => $.agent.spawn({ prompt: 'go', description, subagentType: 'Explore' } as never)
    const mount = ($: Engine, isWorking: boolean, extra: Record<string, unknown> = {}) =>
      $.ui.mount({ ...band, props: { ...props(isWorking), ...extra } })

    test("an agent's start mid-turn leaves your turn's count alone", async ($, on) => {
      const s = setup(on, {})
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      s.usage = { ...s.usage, rateLimits: [limit('five_hour', 12)] }
      await step($, 't1')
      await spawn($, 'scan')
      await $.turn.start({ text: 'go', turnId: 'xa1', agentId: 'a1' })
      s.usage = { ...s.usage, rateLimits: [limit('five_hour', 14)] }
      await agentStep($, 'a1')
      expect(await (await mount($, true)).find({ type: 'Text', text: /^ \+4% now$/ })).toBeDefined()
    })

    test('each answer costs the loop that asked: the turn counts both, the agent is listed with its model', async ($, on) => {
      const s = setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      read(s, 0.5, { rateLimits: [limit('five_hour', 11)] })
      await step($, 't1')
      await spawn($, 'scan')
      read(s, 0.75, { rateLimits: [limit('five_hour', 12)] })
      await agentStep($, 'a1')

      const ui = await mount($, true)
      // The turn's whole change, agents included, with no split.
      expect(await ui.find({ type: 'Text', text: /^ \+1\.5% now$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^⑂ 1 agent$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Explore·Haiku 5\.5$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^ \+0\.5%$/ })).toBeDefined()
      // The bar is one orange stretch: no tint for the agents' part. (The pace
      // mark is at the start: 11h 50m left reads as a window just begun.)
      expect((await ui.find({ type: 'Text', text: /^│$/ }))?.props.backgroundColor).toBe('claude')
      expect((await ui.find({ type: 'Text', text: /^██▌ {26}$/ }))?.props.color).toBe('claude')

      // Your turn ends; the agent keeps spending in the background: the turn's figure grows with it.
      await complete($, 't1')
      expect(await (await mount($, false)).find({ type: 'Text', text: /^ ▲ \+1\.5% last$/ })).toBeDefined()
      read(s, 1)
      await agentStep($, 'a1')
      let idle = await mount($, false)
      expect(await idle.find({ type: 'Text', text: /^ ▲ \+2% last$/ })).toBeDefined()
      expect(await idle.find({ type: 'Text', text: /background|you/ })).toBeUndefined()

      // Finished: marked done, and gone once your next turn starts.
      await agentDone($, 'a1')
      idle = await mount($, false)
      expect(await idle.find({ type: 'Text', text: /^✓ $/ })).toBeDefined()
      await $.turn.start({ text: 'next', turnId: 't2' })
      expect(await (await mount($, true)).find({ type: 'Text', text: /^⑂ \d+ agent/ })).toBeUndefined()
    })

    test("viewing an agent lists one row each; with no room, a chip on line 1", async ($, on) => {
      setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      await spawn($, 'scan')
      await spawn($, 'tests')
      const rows = await mount($, true, { view: { agentId: 'a1' } })
      expect(await rows.find({ type: 'Text', text: /^⑂ Agents$/ })).toBeDefined()
      expect(await rows.find({ type: 'Text', text: /^ ▸ $/ })).toBeDefined()
      expect(await rows.find({ type: 'Text', text: /"scan"/ })).toBeDefined()

      const tight = await mount($, true, { maxRows: 2 })
      expect(await tight.find({ type: 'Text', text: /^ *⑂ 2$/ })).toBeDefined()
      expect(await tight.find({ type: 'Text', text: /^⑂ 2 agents/ })).toBeUndefined()
    })

    test('a loop no agent list names (a compaction fork) counts as yours', async ($, on) => {
      const s = setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      read(s, 0.5, { rateLimits: [limit('five_hour', 12)] })
      await agentStep($, 'fork1')
      const ui = await mount($, true)
      expect(await ui.find({ type: 'Text', text: /^ \+1% now$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /agent/ })).toBeUndefined()
    })

    test("an agent's compaction leaves your reading; yours shows what it cost", async ($, on) => {
      const s = setup(on, RATE, 150000)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      await spawn($, 'scan')
      await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never)
      let ui = await mount($, true)
      expect(await ui.find({ type: 'Text', text: /measuring…/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^ ⟲$/ })).toBeDefined()

      // Your own compaction: its cost is what your spend grew by while it ran.
      read(s, 0.2)
      await compact($, 'auto')
      s.usage = { ...s.usage, context: { window: 200000, tokens: 30000 } }
      await complete($, 't1')
      ui = await mount($, false)
      expect(await ui.find({ type: 'Text', text: /^▼ −120k compacted · \+0\.4%$/ })).toBeDefined()
    })

    test('/clear keeps a running agent, drops a finished one, and counts the new ledger from 0', async ($, on) => {
      const s = setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      await spawn($, 'scan')
      await spawn($, 'tests')
      await agentDone($, 'a2')
      await complete($, 't1')
      await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as never)

      // The new conversation's ledger: its first reading is the agent's reply.
      s.usage = { ...s.usage, startedAt: NOW + 1000, cost: { usd: 0.25 } } as typeof s.usage
      await agentStep($, 'a1')
      const ui = await mount($, false)
      expect(await ui.find({ type: 'Text', text: /^⑂ 1 agent$/ })).toBeDefined()
      // Its spend counts: its share of Session is listed beside it.
      expect(await ui.find({ type: 'Text', text: /^ \+0\.5%$/ })).toBeDefined()
    })

    test('a gateway spend limit draws its own row, and says when it is over', async ($, on) => {
      mock.clock(on, { now: NOW })
      mock.store(on)
      harness(on, { tokens: 40000, limits: [limit('spend_limit', 104)] })
      await start($)
      const ui = await mount($, false)
      expect(await ui.find({ type: 'Text', text: /^Spend/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^ over by 4%$/ })).toBeDefined()
    })
  })
  describe('the Fable row', () => {
    const WEEK = '2026-10-15T10:00:00Z' // 5 of 7 days left
    const FIVE = '2026-10-10T12:30:00Z' // half of 5 hours left
    const FABLE_ID = 'claude-fable-5-2'
    // Anchored at 42%: $25 moving the Week 3 points relearns the same 0.12.
    const RATES = { 'rates.v2': { seven_day: { rate: 0.12, pct: 42, resetsAt: WEEK, snap: {} } } }
    const week = (pct: number, resetsAt = WEEK) => limit('seven_day', pct, resetsAt)
    const setup = (on: Parameters<TestBody>[1], entries: Record<string, unknown> = RATES, limits = [limit('five_hour', 30, FIVE), week(42)]) => {
      const clock = mock.clock(on, { now: NOW })
      const saved = sharedStore(on, entries)
      const s = harness(on, { tokens: 40000, limits })
      s.usage = { ...s.usage, cost: { usd: 0 } } as typeof s.usage
      on('agent.list', () => ({ value: [] }) as never)
      on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
      return { s, saved, clock }
    }
    // The account's usage answer, as /usage gets it: Fable at `pct` of its allowance (none when null).
    const answer = (pct: number | null, session = 30, all = 42) =>
      JSON.stringify({
        five_hour: { utilization: session },
        limits: [
          { kind: 'session', percent: session, resets_at: '2026-10-10T12:30:00+00:00', scope: null },
          { kind: 'weekly_all', percent: all, resets_at: '2026-10-15T10:00:00+00:00', scope: null },
          ...(pct === null
            ? []
            : [{ kind: 'weekly_scoped', percent: pct, resets_at: '2026-10-15T09:59:59.580142+00:00', scope: { model: { id: null, display_name: 'Fable' } } }]),
        ],
        weekly_scoped_shares: pct === null ? [] : [{ limit_index: 2, used_percent_of_weekly: pct / 2, allowance_percent_of_weekly: 50 }],
      })
    // The session's login and the network, as the mod reaches them through Claude Code.
    const serve = (on: Parameters<TestBody>[1], text: string) => {
      const server = { text, kind: 'bearer' as 'bearer' | null, urls: [] as string[], auth: [] as unknown[] }
      on('session.authorize', () => ({ value: server.kind ? { handle: 'h', kind: server.kind } : null }) as never)
      on('http.fetch', ($, e) => {
        server.urls.push(e.url)
        server.auth.push(e.init?.auth)
        return { value: { status: 200, ok: true, headers: {}, text: server.text } } as never
      })
      return server
    }
    type S = ReturnType<typeof setup>['s']
    // The account reads `limits` after a reply that brought this session's total to $usd.
    const reading = (s: S, usd: number, limits?: ReturnType<typeof limit>[]) =>
      (s.usage = { ...s.usage, cost: { usd }, ...(limits ? { rateLimits: limits } : {}) } as typeof s.usage)
    const stepOn = async ($: Engine, turnId: string, model: string, extra: Record<string, unknown> = {}) => {
      for await (const _ of $.turn.step({ turnId, index: 0, model, messageCount: 1, ...extra } as never)) void _
    }
    const mount = ($: Engine, isWorking = false, extra: Record<string, unknown> = {}) =>
      $.ui.mount({ ...band, props: { ...props(isWorking), ...extra } })
    // The limit rows as shown, top to bottom.
    const rowsOf = async (ui: Awaited<ReturnType<typeof mount>>) =>
      (await ui.findAll({ type: 'Text', text: /^(Session|Week|Spend|└ Fable) / }))
        .filter(x => x.children.some(c => typeof c !== 'string'))
        .map(x => x.text)
    const fableRow = async (ui: Awaited<ReturnType<typeof mount>>) => (await rowsOf(ui)).find(r => r.startsWith('└ Fable'))

    test("a Fable turn draws └ Fable under Week, in points of the week; a switch to Opus holds it still", async ($, on) => {
      const { s } = setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [limit('five_hour', 31, FIVE), week(45)])
      await stepOn($, 't1', FABLE_ID)
      let ui = await mount($, true)
      const rows = await rowsOf(ui)
      expect(rows.map(r => r.split(' ')[0])).toEqual(['Session', 'Week', '└'])
      // $25 at 0.12 points per $: 3 of the Week's 45.
      expect(rows[2]).toMatch(/^└ Fable  .{30} +3% +\+3% now +· since Sat$/)
      expect((await ui.find({ type: 'Text', text: /^ 3%$/ }))?.props.color).toBe('permission')
      expect((await ui.find({ type: 'Text', text: /^└ Fable  $/ }))?.props.color).toBe('permission')
      // Inside Week: Fable's 0.9 cell over the other models' shadow.
      const tip = await ui.find({ type: 'Text', text: /^▉$/ })
      expect([tip?.props.color, tip?.props.backgroundColor]).toEqual(['permission', '#8f5540'])
      expect((await ui.find({ type: 'Text', text: /^█{12}▌ {16}$/ }))?.props.backgroundColor).toBe('#4a2e25')

      await complete($, 't1')
      expect(await fableRow(await mount($))).toMatch(/ 3% +▲ +\+3% last · since Sat$/)

      // On Opus: Week moves, the Fable row holds still and says nothing of the turn.
      await $.turn.start({ text: 'more', turnId: 't2' })
      reading(s, 40, [limit('five_hour', 33, FIVE), week(47)])
      await stepOn($, 't2', 'claude-opus-5-5')
      ui = await mount($, true)
      // The last turn's figure stays while the next runs, as on the other rows.
      expect(await fableRow(ui)).toMatch(/ 3% +▲ +\+3% last · since Sat$/)
      expect(await ui.find({ type: 'Text', text: /^ \+1\.8% now$/ })).toBeDefined()
      await complete($, 't2')
      // No Fable this turn: no "last". ($40 moved the Week 5 points: the rate is now 0.125.)
      expect(await fableRow(await mount($))).toMatch(/ 3\.1% +· since Sat$/)
    })

    test("a Haiku agent's replies move Week's change, not Fable's", async ($, on) => {
      const { s } = setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [limit('five_hour', 31, FIVE), week(45)])
      await stepOn($, 't1', FABLE_ID)
      await $.agent.spawn({ prompt: 'go', description: 'scan', subagentType: 'Explore' } as never)
      reading(s, 35, [limit('five_hour', 32, FIVE), week(46)])
      await stepOn($, 'xa1', 'claude-haiku-5-5', { agentId: 'a1' })
      const ui = await mount($, true)
      const rows = await rowsOf(ui)
      expect(rows[1]).toMatch(/ 46% +\+4\.2% now /)
      expect(rows[2]).toMatch(/ 3% +\+3% now /)
    })

    test('a week with no Fable reads a dim 0%, and says so', async ($, on) => {
      const { s } = setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 10, [limit('five_hour', 31, FIVE), week(43)])
      await stepOn($, 't1', 'claude-opus-5-5')
      await complete($, 't1')
      const ui = await mount($)
      expect(await fableRow(ui)).toMatch(/^└ Fable  █{12}▉ {19}0% +· not used this week$/)
      expect((await ui.find({ type: 'Text', text: /^ 0%$/ }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: /^└ Fable  $/ }))?.props.dimColor).toBe(true)
    })

    test('"since" shows until the week resets; then the count starts over', async ($, on) => {
      const clock = mock.clock(on, { now: NOW })
      const soon = '2026-10-10T12:00:00Z'
      sharedStore(on, { 'rates.v2': { seven_day: { rate: 0.12, pct: 42, resetsAt: soon, snap: {} } } })
      const s = harness(on, { tokens: 40000, limits: [week(42, soon)] })
      s.usage = { ...s.usage, cost: { usd: 0 } } as typeof s.usage
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [week(45, soon)])
      await stepOn($, 't1', FABLE_ID)
      await complete($, 't1')
      expect(await fableRow(await mount($))).toMatch(/ 3% +▲ +\+3% last · since Sat$/)

      await clock.advance(121 * 60_000)
      expect(await fableRow(await mount($))).toMatch(/ 0% +· not used this week$/)

      // The new week: counted from its start, so no "since".
      await $.turn.start({ text: 'again', turnId: 't2' })
      reading(s, 50, [week(4, '2026-10-17T12:00:00Z')])
      await stepOn($, 't2', FABLE_ID)
      await complete($, 't2')
      const row = await fableRow(await mount($))
      expect(row).toMatch(/ 3% +▲ +\+3% last$/)
    })

    test("every session's count adds up, shown at once; old and stale ones are left out", async ($, on) => {
      const { s, saved } = setup(on, {
        ...RATES,
        'models.other': { usd: { Fable: 100, Opus: 5 }, resetsAt: WEEK, at: NOW - 60_000 },
        'models.lastweek': { usd: { Fable: 300 }, resetsAt: '2026-10-08T10:00:00Z', at: NOW - 3 * 86_400_000 },
        'models.gone': { usd: { Fable: 300 }, resetsAt: WEEK, at: NOW - 9 * 86_400_000 },
      })
      await start($)
      // No reply yet: the other session's $100 is 12 points.
      expect(await fableRow(await mount($))).toMatch(/ 12%/)
      expect(saved['models.gone']).toBeUndefined()

      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [limit('five_hour', 31, FIVE), week(45)])
      await stepOn($, 't1', FABLE_ID)
      expect(await fableRow(await mount($, true))).toMatch(/ 15% +\+3% now/)
      const own = Object.keys(saved).find(k => k.startsWith('models.') && !['models.other', 'models.lastweek', 'models.since'].includes(k))
      // Saved under its own key, for the other sessions to add up.
      expect(saved[own!]).toEqual({ usd: { Fable: 25 }, resetsAt: WEEK, at: NOW })
    })

    test('with no Week rate yet, the Week is split by what each model cost', async ($, on) => {
      setup(on, { 'models.other': { usd: { Fable: 0.8, Haiku: 0.1 }, resetsAt: WEEK, at: NOW } }, [week(6)])
      await start($)
      expect(await fableRow(await mount($))).toMatch(/ 5\.3%/)
    })

    test('a gateway account: the row hangs under Spend', async ($, on) => {
      const MONTH = '2026-11-01T00:00:00Z'
      setup(
        on,
        {
          'rates.v2': { spend_limit: { rate: 0.05, pct: 40, resetsAt: MONTH, snap: {} } },
          'models.other': { usd: { Fable: 780, Opus: 100, Haiku: 40 }, resetsAt: MONTH, at: NOW },
        },
        [limit('spend_limit', 46, MONTH)],
      )
      await start($)
      const rows = await rowsOf(await mount($))
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatch(/^Spend {4}[^│]{30} 46% +· /)
      expect(rows[1]).toMatch(/^└ Fable  .{30} 39% +· since Sat$/)
    })

    test('limits that leave, or a logout, take the row and every saved count with them', async ($, on) => {
      const { s, saved } = setup(on)
      const models = () => Object.keys(saved).filter(k => k.startsWith('models.'))
      const fableTurnNow = async (turnId: string, usd: number) => {
        await $.turn.start({ text: 'hi', turnId })
        reading(s, usd, [limit('five_hour', 31, FIVE), week(45)])
        await stepOn($, turnId, FABLE_ID)
        await complete($, turnId)
      }
      await start($)
      await fableTurnNow('t1', 25)
      expect(models().length).toBe(2)
      await $.session.measure({ context: { window: 200000, tokens: 20000 }, rateLimits: [], changed: ['rateLimits'] })
      expect(await fableRow(await mount($))).toBeUndefined()
      expect(models()).toEqual([])

      await fableTurnNow('t2', 50)
      expect(models().length).toBe(2)
      await $.session.end({ reason: 'logout', sessionId: 's', resume: {} } as never)
      expect(await fableRow(await mount($))).toBeUndefined()
      expect(models()).toEqual([])
    })

    test("a real Fable limit is shown instead of the count, with its own reset", async ($, on) => {
      const { s } = setup(on, RATES, [limit('five_hour', 30, FIVE), week(42), limit('seven_day_fable', 55, '2026-10-12T10:00:00Z')])
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25)
      await stepOn($, 't1', FABLE_ID)
      const ui = await mount($, true)
      const rows = (await rowsOf(ui)).filter(r => r.startsWith('└ Fable'))
      expect(rows).toHaveLength(1)
      // 2 of 7 days left: the pace mark past the fill.
      expect(rows[0]).toMatch(/^└ Fable  █{16}▌ {4}│ {8} 55% +· 2d → Oct 12 at /)
      expect((await ui.find({ type: 'Text', text: /^ 55%$/ }))?.props.color).toBe('permission')
    })

    test("the account's own Fable figure replaces the count, asked at most once a minute", async ($, on) => {
      const { s, clock } = setup(on)
      const server = serve(on, answer(17))
      await start($)
      // As /usage and claude.ai show it: 17% of Fable's allowance, its own reset and pace mark.
      expect(await fableRow(await mount($))).toMatch(/^└ Fable  █{5}  {2}│ {21} 17% +· 5d → Oct 15 at \S+$/)
      expect(server.urls).toEqual(['https://api.anthropic.com/api/oauth/usage?skip_spend=1'])
      expect(server.auth).toEqual(['h'])

      // A Fable turn: $25 is 3 Week points, 6% of a 50% allowance.
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [limit('five_hour', 31, FIVE), week(45)])
      await stepOn($, 't1', FABLE_ID)
      expect(await fableRow(await mount($, true))).toMatch(/ 17% +\+6% now +· /)
      await complete($, 't1')
      expect(await fableRow(await mount($))).toMatch(/ 17% +▲ +\+6% last · /)
      // Asked once: the turn ended within the minute.
      expect(server.urls).toHaveLength(1)
      expect((await rowsOf(await mount($))).filter(r => r.startsWith('└ Fable'))).toHaveLength(1)

      server.text = answer(19)
      await clock.advance(61_000)
      // The turn that ended inside the minute is caught up by the minute timer.
      expect(server.urls).toHaveLength(2)
      expect(await fableRow(await mount($))).toMatch(/ 19% +▲ +\+6% last · /)
      await $.turn.start({ text: 'more', turnId: 't2' })
      reading(s, 30, [limit('five_hour', 32, FIVE), week(46)])
      await stepOn($, 't2', 'claude-opus-5-5')
      await complete($, 't2')
      expect(server.urls).toHaveLength(2)
      expect(await fableRow(await mount($))).toMatch(/ 19% +· 4d 23h → /)
    })

    test("the account's answer brings Session and Week up to date after a turn, and after an agent's run", async ($, on) => {
      const { s, clock } = setup(on)
      const server = serve(on, answer(17))
      await start($)
      await clock.advance(61_000)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      // A reply's reading is taken before the reply is billed: after it, the bars still say 30 and 42.
      reading(s, 25, [limit('five_hour', 30, FIVE), week(42)])
      await stepOn($, 't1', 'claude-opus-5-5')
      server.text = answer(17, 33, 45)
      await complete($, 't1')
      let rows = await rowsOf(await mount($))
      // The account says where they stand now, and the turn's own figures follow.
      expect(rows[0]).toMatch(/ 33% ▲ +\+3% last · /)
      expect(rows[1]).toMatch(/ 45% ▲ +\+3% last · /)

      // An agent's run ends later: asked again. A figure lower than the one held is not taken.
      await $.agent.spawn({ prompt: 'go', description: 'scan', subagentType: 'Explore' } as never)
      await clock.advance(61_000)
      server.text = answer(17, 36, 44)
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'xa1', reason: 'answer', agentId: 'a1' } as never)
      rows = await rowsOf(await mount($))
      expect(rows[0]).toMatch(/ 36% /)
      expect(rows[1]).toMatch(/ 45% /)
      expect(server.urls).toHaveLength(3)
    })

    test("another session's answer from within the minute is taken, with no request of its own", async ($, on) => {
      const theirs = { at: NOW - 20_000, limits: [limit('five_hour', 34, FIVE), week(44), limit('weekly_fable', 21, WEEK)], allowance: 50 }
      setup(on, { ...RATES, server: theirs })
      const server = serve(on, answer(17))
      await start($)
      const rows = await rowsOf(await mount($))
      expect(rows.map(r => /(\d+)% /.exec(r)?.[1])).toEqual(['34', '44', '21'])
      expect(server.urls).toEqual([])
    })

    test("a background agent's Fable replies after the turn ended grow the Fable row's last", async ($, on) => {
      const { s } = setup(on)
      serve(on, answer(17))
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [limit('five_hour', 31, FIVE), week(45)])
      await stepOn($, 't1', FABLE_ID)
      await $.agent.spawn({ prompt: 'go', description: 'scan', subagentType: 'Explore' } as never)
      await complete($, 't1')
      expect(await fableRow(await mount($))).toMatch(/ 17% ▲ +\+6% last · /)
      // $25 more on Fable, after your turn: 6 Week points in all, 12% of Fable's allowance.
      reading(s, 50, [limit('five_hour', 32, FIVE), week(48)])
      await stepOn($, 'xa1', FABLE_ID, { agentId: 'a1' })
      expect(await fableRow(await mount($))).toMatch(/ 17% ▲ +\+12% last · /)
    })

    test('with no login, or an answer with no Fable limit, the count stands in', async ($, on) => {
      const { s, clock } = setup(on)
      const server = serve(on, answer(17))
      server.kind = null
      await start($)
      expect(await fableRow(await mount($))).toMatch(/ 0% +· not used this week$/)
      expect(server.urls).toEqual([])

      const turn = async (turnId: string, usd: number) => {
        await clock.advance(61_000)
        await $.turn.start({ text: 'hi', turnId })
        reading(s, usd, [limit('five_hour', 31, FIVE), week(42)])
        await stepOn($, turnId, 'claude-opus-5-5')
        await complete($, turnId)
      }
      server.kind = 'bearer'
      await turn('t1', 5)
      expect(await fableRow(await mount($))).toMatch(/ 17% +· /)
      // The answer stops listing Fable: back to the count.
      server.text = answer(null)
      await turn('t2', 10)
      expect(await fableRow(await mount($))).toMatch(/ 0% +· not used this week$/)
    })

    test('a Fable limit with no known share of the week shows no turn figures', async ($, on) => {
      const { s } = setup(on)
      // The answer names the limit, not its share of the week.
      serve(on, JSON.stringify({ ...JSON.parse(answer(17)), weekly_scoped_shares: [] }))
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [limit('five_hour', 31, FIVE), week(45)])
      await stepOn($, 't1', 'claude-opus-5-5')
      expect(await fableRow(await mount($, true))).toMatch(/ 17% +· /)
      await complete($, 't1')
      // Its % is read between turns: its change within one is always 0, and says nothing.
      expect(await fableRow(await mount($))).toMatch(/ 17% +· /)
    })

    test('Fable keeps its color until Fable alone passes 75', async ($, on) => {
      setup(on, { ...RATES, 'models.other': { usd: { Fable: 700 }, resetsAt: WEEK, at: NOW } }, [week(90)])
      await start($)
      const ui = await mount($)
      expect((await ui.find({ type: 'Text', text: /^ 90%$/ }))?.props.color).toBe('red')
      expect((await ui.find({ type: 'Text', text: /^ 84%$/ }))?.props.color).toBe('warning')
    })

    test('a narrow band drops whole pieces instead of cutting a row', async ($, on) => {
      const { s } = setup(on)
      await start($)
      await $.turn.start({ text: 'hi', turnId: 't1' })
      reading(s, 25, [limit('five_hour', 80, FIVE), week(45)])
      await stepOn($, 't1', FABLE_ID)
      await complete($, 't1')
      await $.turn.start({ text: 'more', turnId: 't2' })
      reading(s, 30, [limit('five_hour', 82, FIVE), week(46)])
      await stepOn($, 't2', FABLE_ID)
      for (const cols of [140, 64, 44]) {
        const rows = await rowsOf(await mount($, true, { bodyColumns: cols }))
        expect(rows).toHaveLength(3)
        for (const row of rows) expect(row.length).toBeLessThanOrEqual(cols)
        for (const row of rows) expect(row).toMatch(/ \d+(\.\d)?% +\+[\d.]+% now/)
      }
      // 64 columns: Week's reset shortens to the time left.
      const [session, weekRow, fable] = await rowsOf(await mount($, true, { bodyColumns: 64 }))
      expect(session).toMatch(/ 82% +\+2% now ▲ +\+50% last · 2h 30m/)
      expect(weekRow).toMatch(/ 46% +\+0\.6% now ▲ +\+3% last · 5d$/)
      expect(fable).toMatch(/ 3\.6% +\+0\.6% now ▲ +\+3% last · since Sat$/)
      // 44: "last" leaves every row together; the time left still fits, "since" does not.
      const narrow = await rowsOf(await mount($, true, { bodyColumns: 44 }))
      expect(narrow[0]).toMatch(/ 82% +\+2% now · 2h 30m$/)
      expect(narrow[1]).toMatch(/ 46% +\+0\.6% now · 5d$/)
      expect(narrow[2]).toMatch(/ 3\.6% +\+0\.6% now$/)
    })
  })
})

describe('agent helpers', () => {
  test('agents list in spawn order, a child under its parent, a workflow run as one', () => {
    const a = (order: number, more: Record<string, unknown> = {}) => ({
      type: 'Explore', description: '', model: null, effort: null, status: 'running' as const, spent: 1, background: false,
      compacted: false, startedAt: 0, endedAt: null, order, workflow: null, parentId: null, ...more,
    })
    const entries = agentEntries({
      p: a(1, { type: 'Plan' }),
      w1: a(2, { workflow: 'wf', status: 'done' }),
      w2: a(3, { workflow: 'wf' }),
      c: a(4, { parentId: 'p' }),
    })
    expect(entries.map(x => [x.type, x.isChild, x.status, x.spent])).toEqual([
      ['Plan', false, 'running', 1], ['Explore', true, 'running', 1], ['workflow ×2', false, 'running', 2],
    ])
  })

  test('the agents line keeps room for "+N more"', () => {
    expect(fitItems(10, [10, 10, 10], 35)).toBe(1)
    expect(fitItems(10, [10, 10], 30)).toBe(2)
  })

  test("a /clear's new ledger counts in full; a resumed one is a baseline", () => {
    expect(addSpend({ usd: 5.5, spent: 1.5, costFrom: NOW }, 0.25, NOW + 1000, NOW).spent).toBe(1.75)
    expect(addSpend({ usd: 5.5, spent: 1.5, costFrom: NOW }, 9, NOW - 86_400_000, null).spent).toBe(1.5)
  })
})

describe('Fable helpers', () => {
  const W = '2026-10-15T10:00:00Z'

  test('families, and a count per window', () => {
    expect([familyOf('claude-fable-5-2'), familyOf('claude-haiku-5-5[1m]'), familyOf('opus'), familyOf(null)]).toEqual([
      'Fable', 'Haiku', 'Opus', 'Other',
    ])
    const a = bookModel({ usd: {} }, 'Fable', 2, W)
    expect(bookModel(a, 'Fable', 1, '2026-10-15T10:10:00Z')).toEqual({ usd: { Fable: 3 }, resetsAt: '2026-10-15T10:10:00Z' })
    expect(bookModel(a, 'Opus', 0, W)).toEqual(a)
    // Another window starts over.
    expect(bookModel(a, 'Opus', 1, '2026-10-22T10:00:00Z')).toEqual({ usd: { Opus: 1 }, resetsAt: '2026-10-22T10:00:00Z' })
  })

  test("Fable's points: by rate, by cost share, never above the parent, at least 0.1", () => {
    expect(fableShare({ Fable: 258.4, Opus: 41.7, Haiku: 16.7 }, 42, 0.12)).toBe(31)
    expect(fableShare({ Fable: 0.8, Haiku: 0.1 }, 6, undefined)).toBe(5.3)
    expect(fableShare({ Fable: 1000 }, 42, 0.12)).toBe(42)
    expect(fableShare({ Fable: 0.01 }, 10, 0.12)).toBe(0.1)
    // The families' 120 points scaled to the parent's 50.
    expect(fableShare({ Fable: 500, Opus: 500 }, 50, 0.12)).toBe(25)
    expect(fableShare({ Opus: 5 }, 50, 0.12)).toBe(0)
    expect(fableShare({ Fable: 5 }, 0, 0.12)).toBe(0)
    expect(fableTurn(25, 35, 4.2, 0.12)).toBe(3)
    expect(fableTurn(25, 35, 2, 0.12)).toBe(2)
    expect(fableTurn(1, 4, 2, undefined)).toBe(0.5)
    expect(fableTurn(0, 4, 2, 0.12)).toBe(0)
    expect(fableTurn(1, 4, -40, 0.12)).toBe(-40)
    expect(fableTurn(1, 4, undefined, 0.12)).toBeUndefined()
    // No Fable in the turn: 0, even when the Week's change can't be told.
    expect(fableTurn(0, 4, undefined, 0.12)).toBe(0)
  })

  test('bar cells: two parts in a cell, the sliver, the pace mark', () => {
    const T = 'track'
    expect(barCells([{ to: 5, color: 'f' }, { to: 10, color: 's' }], 10, T)[0]).toEqual({ glyph: '▌', fg: 'f', bg: 's' })
    // Any spend shows a sliver, over the shadow or the track.
    expect(barCells([{ to: 0.3, color: 'f' }, { to: 20, color: 's' }], 10, T, { sliver: true })[0]).toEqual({ glyph: '▏', fg: 'f', bg: 's' })
    expect(barCells([{ to: 0.3, color: 'f' }], 10, T, { sliver: true })[0]).toEqual({ glyph: '▏', fg: 'f', bg: T })
    expect(barCells([{ to: 0, color: 'f' }], 10, T, { sliver: true })[0]).toEqual({ glyph: ' ', bg: T })
    const half = (pace: number) => barCells([{ to: 50, color: 'f' }], 10, T, { pace })
    expect(half(0.2)[2]).toEqual({ glyph: '│', fg: T, bg: 'f' })
    expect(half(0.9)[9]).toEqual({ glyph: '│', bg: T })
    expect(half(1)[9]).toEqual({ glyph: '│', bg: T })
    expect(runs(half(0.9))).toEqual([{ text: '█████    ', fg: 'f', bg: T }, { text: '│', bg: T }])
  })

  test("the account's usage answer: Session, Week and Fable, reset times to the minute, Fable's allowance", () => {
    const text = JSON.stringify({
      limits: [
        { kind: 'session', percent: 44, resets_at: '2026-11-14T08:59:59.579988+00:00', scope: null },
        { kind: 'weekly_all', percent: 10, resets_at: '2026-11-19T20:59:59.580007+00:00', scope: null },
        { kind: 'weekly_scoped', percent: 17, resets_at: '2026-11-19T20:59:59.580142+00:00', scope: { model: { id: null, display_name: 'Fable' } } },
      ],
      weekly_scoped_shares: [{ limit_index: 2, used_percent_of_weekly: 9, allowance_percent_of_weekly: 50 }],
    })
    expect(serverLimits(text)).toEqual({
      limits: [
        { kind: 'five_hour', percentUsed: 44, resetsAt: '2026-11-14T09:00:00.000Z' },
        { kind: 'seven_day', percentUsed: 10, resetsAt: '2026-11-19T21:00:00.000Z' },
        { kind: 'weekly_fable', percentUsed: 17, resetsAt: '2026-11-19T21:00:00.000Z' },
      ],
      allowance: 50,
    })
    // Seconds since 1970 read the same. A Session with no reset time names no window: left out.
    const bare = { limits: [{ kind: 'session', percent: 5, resets_at: null }, { kind: 'weekly_scoped', percent: 3, resets_at: 1795640399, scope: { model: { display_name: 'Fable' } } }] }
    expect(serverLimits(JSON.stringify(bare))).toEqual({ limits: [{ kind: 'weekly_fable', percentUsed: 3, resetsAt: '2026-11-25T21:00:00.000Z' }] })
    // No Fable listed: none. Another shape, or not JSON: unknown (keep what we have).
    expect(serverLimits(JSON.stringify({ limits: [] }))).toEqual({ limits: [] })
    expect(serverLimits(JSON.stringify({ five_hour: {} }))).toBeUndefined()
    expect(serverLimits('<html>')).toBeUndefined()
    // Week points in Fable's own %: 3 of a 50% allowance is 6; never over 100; a reset stays.
    expect([toAllowance(3, 50), toAllowance(0.1, 50), toAllowance(80, 50), toAllowance(-40, 50)]).toEqual([6, 0.2, 100, -40])
  })

  test('pace: how far through its window a limit is', () => {
    const now = Date.parse('2026-10-10T10:00:00Z')
    const FIVE_H = 5 * 3_600_000
    expect(paceAt('2026-10-10T12:30:00Z', now, FIVE_H)).toBe(0.5)
    expect(paceAt('2026-10-11T12:30:00Z', now, FIVE_H)).toBe(0)
    expect(paceAt(undefined, now, FIVE_H)).toBeUndefined()
  })

  test('the figures line up in columns; "last" leaves every row together; only a passed reset says so', () => {
    const WEEK = '2026-10-15T10:00:00Z'
    const w = {
      now: NOW,
      limits: [limit('five_hour', 9, '2026-10-10T12:30:00Z'), limit('seven_day', 11, WEEK), limit('weekly_fable', 17, WEEK)],
      turnStartLimits: { five_hour: 8, seven_day: 11 },
      lastLimitDelta: { five_hour: 0.4, seven_day: 0 },
      spent: 10,
      turnStartSpent: 8.6,
      rates: { five_hour: 0.7, seven_day: 0.12 },
      modelSpent: { usd: { Opus: 5 }, resetsAt: WEEK },
      modelTotals: { usd: {} },
      turnStartFable: 0,
      lastFableDelta: 0.3,
      fableSince: null,
      fableAllowance: 50,
    }
    const text = (cols: number, state: object = w) => limitRows(state as never, cols, true).map(row => row.map(p => p.text).join(''))
    // After the label and a 30-cell bar: each %, each "now", each "last" under the one above.
    const [session, weekRow, fable] = text(140).map(row => row.slice(39))
    expect(session).toMatch(/^  9%   \+1% now ▲ \+0\.4% last · /)
    expect(weekRow).toMatch(/^ 11% \+0\.2% now ▲   <1% last · /)
    expect(fable).toMatch(/^ 17%           ▲ \+0\.6% last · /)

    // Narrower: every row keeps "last", or none does.
    const kept = new Set<number>()
    for (let cols = 40; cols <= 110; cols++) {
      const rows = text(cols)
      const withLast = rows.filter(row => row.includes('last')).length
      expect([0, rows.length]).toContain(withLast)
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(cols)
      kept.add(withLast)
    }
    expect([...kept].sort()).toEqual([0, 3])

    // A limit that names no reset time says nothing of one; a window whose reset passed does.
    const spend = { ...w, limits: [{ kind: 'spend_limit', percentUsed: 40 }, { kind: 'five_hour', percentUsed: 0, isReset: true }] }
    const [fresh, gateway] = text(140, spend)
    expect(fresh).toContain(' · window reset')
    expect(gateway).not.toContain('reset')
  })

  test('a row too wide drops its pieces in order', () => {
    const row = [
      { text: 'Week     ' }, { text: 'xxxxxxxxxx' }, { text: ' 42%' },
      { text: ' ▲ +0.1% last', upTo: 3 },
      { text: ' · full Nov 17 at 6am', upTo: 4 },
      { text: ' · 5d 1h → Nov 19 at 4pm', upTo: 1 }, { text: ' · 5d 1h', from: 1, upTo: 2 },
    ]
    const at = (cols: number) => tidy(row, cols).map(p => p.text).join('')
    expect(at(200)).toBe('Week     xxxxxxxxxx 42% ▲ +0.1% last · full Nov 17 at 6am · 5d 1h → Nov 19 at 4pm')
    expect(at(80)).toBe('Week     xxxxxxxxxx 42% ▲ +0.1% last · full Nov 17 at 6am · 5d 1h')
    expect(at(60)).toBe('Week     xxxxxxxxxx 42% ▲ +0.1% last · full Nov 17 at 6am')
    expect(at(50)).toBe('Week     xxxxxxxxxx 42% · full Nov 17 at 6am')
    expect(at(30)).toBe('Week     xxxxxxxxxx 42%')
    expect(at(10)).toBe('Week     xxxxxxxxxx 42%')
  })
})
