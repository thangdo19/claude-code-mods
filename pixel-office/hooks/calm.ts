// Calm: what the Manager SHOWS, so a fast session does not flash a bubble for 0.1 s.
// The usual fix for flashing loading signs: wait a moment before showing, then keep
// it up a minimum time. Thinking / writing / tools: the one done most in the last
// 1.5 s, changed at most once every 1.5 s. Waking and moods that need you: at once.

import type { ShownMood } from './office'
import { isStream } from './moods'

/** The look-back for "what the Manager did most". */
export const CALM_WINDOW = 1500
/** The least time a busy mood stays shown. */
export const CALM_HOLD = 1500
/** Not stepped for this long (the pane was closed): start over from the real mood. */
const STALE = 1000

/** Thinking, writing, tools: the moods that are calmed (the rest show at once). */
export const isBusy = isStream

export class Calm {
  shown: ShownMood | null = null
  shownAt = 0
  private seen: { mood: ShownMood; at: number }[] = []
  private last = -Infinity

  /** One look at the real mood (8 a second); returns what to show. */
  step(real: ShownMood, now: number): ShownMood {
    if (now - this.last > STALE || this.shown === null) this.reset(real, now)
    this.last = now
    this.seen.push({ mood: real, at: now })
    while (this.seen.length && now - this.seen[0]!.at > CALM_WINDOW) this.seen.shift()
    const shown = this.shown!
    // Waking up, a dialog, done, stopped: show it now.
    if (!isBusy(real) || !isBusy(shown)) {
      if (real !== shown) this.set(real, now)
      return this.shown!
    }
    if (now - this.shownAt < CALM_HOLD) return shown
    const count = new Map<ShownMood, number>()
    for (const s of this.seen) if (isBusy(s.mood)) count.set(s.mood, (count.get(s.mood) ?? 0) + 1)
    let best = shown
    for (const [m, n] of count) if (n > (count.get(best) ?? 0)) best = m
    if (best !== shown) this.set(best, now)
    return this.shown!
  }

  /** What to show without stepping (a repaint between ticks); the real mood when not stepped lately. */
  peek(real: ShownMood, now: number): ShownMood {
    if (this.shown === null || now - this.last > STALE) return real
    return isBusy(real) && isBusy(this.shown) ? this.shown : real
  }

  private set(m: ShownMood, now: number): void {
    this.shown = m
    this.shownAt = now
  }

  private reset(real: ShownMood, now: number): void {
    this.seen = []
    this.set(real, now)
  }
}
