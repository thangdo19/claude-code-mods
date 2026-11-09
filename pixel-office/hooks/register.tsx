// The mod's entry (hooks/hooks.json): the pane, and what happens in the session as changes to the office.

import type { Register } from 'claude-code'

import { events } from './events'
import { pane } from './pane'

export const register: Register = on => {
  pane(on)
  events(on)
}
