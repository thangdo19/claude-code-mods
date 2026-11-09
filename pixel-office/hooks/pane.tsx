// The pane: when it opens and closes, which layout fits its size (`shapeFor`), and how it draws the picture and the
// list beside or under it (ui.render).

import type { On } from 'claude-code'

import { DOT_W, fitRows, lines, view, WHO_W, type Line, type Tone } from './office'
import { BIG_COLS, BIG_ROWS } from './layout'
import { CAM_COLS, CAM_ROWS } from './camera'
import { change, load, onTick, rt, type Shape } from './loop'

/** The pane's id (the same as `PANE` in loop.ts; the mod's scan wants it written in the file that uses it). */
const PANE = 'office'
const TITLE = 'Office'
/** The person closed the pane by hand: it stays closed until /office. */
const CLOSED_KEY = 'closedByHand'
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

/**
 * What the pane shows: the office as designed (64 × 31) wherever it fits, with the
 * list under it; else a camera on the same office, at the same pixel size, with the
 * list beside it or under it; else only the list.
 */
export function shapeFor(surface: string, cols: number, rows: number): Shape | null {
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

const TONE_COLOR: Record<Tone, string | undefined> = { '': undefined, idle: 'subtle', warn: 'warning', bad: 'error', good: 'success' }
const pad = (s: string, n: number) => (Array.from(s).length >= n ? Array.from(s).slice(0, n).join('') : s.padEnd(n, ' '))

export function pane(on: On): void {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      rt.cwd = e.cwd
      await load($)
      if (rt.latest.lastActivity === 0) {
        await change($, (o, now) => ({ ...o, lastActivity: now, moodAt: now }))
        // A new session (approved round 7): the office opens, everyone walks in from the door.
        rt.sim.opening = true
      }
      await $.command.register({ name: 'office', description: 'Show the pixel office in the side panel' })
      // No screen (claude -p): nothing to draw, so no timer and no pane.
      if (e.isInteractive === false) return result
      if (!rt.timerStarted) {
        rt.timerStarted = true
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
      rt.mounted = null
      if (e.origin.kind === 'person') await $.store.set(CLOSED_KEY, true).catch(() => {})
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const o = await load($)
    const now = await $.clock.now()
    const v = view(o, now, real => rt.calm.peek(real, now))
    const cols = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    const shape = shapeFor(e.surface, cols, rows)
    const viewing = e.props.view.agentId
    if (shape) rt.sim.sync(v)
    // A new pane: the camera starts where it should be looking.
    if (shape?.kind === 'cam') rt.camera.step(v, shape.cols, shape.rows * 2, rt.sim)
    // Everyone has their own line (approved round 4); with no picture, the staff with no job say where they are.
    const all = lines(v, shape ? rt.sim.seated() : undefined, shape ? r => rt.sim.doing(v, r) : undefined, shape ? id => rt.sim.lookOf(id) : undefined)
    rt.lastList = all
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
      const c = rt.draw(v, shape, viewing)
      rt.mounted = { shape, inline: e.props.placement === 'inline', viewing }
      rt.lastCells = c.cells
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
    rt.mounted = null
    return <Box flexDirection="column">{shown.map(l => row(l, false))}</Box>
  })
}
