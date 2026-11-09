// The Manager's moods, by what they mean for the office: one named check each, instead of the same list typed out
// in every file.

import type { ShownMood } from './office'

/** Claude's own stream sets these (thinking, writing the reply, calling tools); a dialog's moods outrank them. */
export const isStream = (m: ShownMood): boolean => m === 'think' || m === 'write' || m === 'work'

/** The turn is on: thinking, writing, working, waiting for your OK, asking, planning (breaks are over). */
export const isWork = (m: ShownMood): boolean => isStream(m) || m === 'permission' || m === 'ask' || m === 'plan'

/** The Manager needs you or just finished: Your OK?, Question?, Done!, Stopped, On hold (shown at once). */
export const isUrgent = (m: ShownMood): boolean => m === 'permission' || m === 'ask' || m === 'done' || m === 'stopped' || m === 'hold'

/** In plan mode the meeting at the board goes on through these: planning and its own dialogs. */
export const isMeeting = (m: ShownMood): boolean => m === 'plan' || m === 'permission' || m === 'ask'
