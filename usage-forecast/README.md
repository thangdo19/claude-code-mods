# usage-forecast

A live "weather report" above the prompt: how full Claude's memory is, and how much of your usage limits you've used.

![The usage-forecast band above the Claude Code prompt](images/band.png)

## How to read it

**Line 1: the context window** (how much of Claude's memory this conversation fills)

| Part | Meaning |
|---|---|
| `◆ Opus 5.5 high` | The model answering you, and its effort (how hard it thinks). Effort shows after Claude's first reply. |
| `☀ Clear` | The weather for how full it is (see below). |
| `8%`  `81.8k / 1M` | Tokens used out of the total. A token is a small piece of text, about ¾ of a word. |
| `▁▁▂▂▃▆······` | A chart of the last 12 turns. Dots are turns not taken yet. |
| `▲ +1.8k last turn` | What your last turn added. `▼ −N compacted · +0.4%` means a compaction shrank it; the % is what the compaction itself cost of your Session limit. |
| `⑂ 2` | Only when there's no room for the agents line: how many agents you have. |

| Weather | Full |
|---|---|
| ☀ Clear | under 25% |
| ☁ Cloudy | under 50% |
| ☂ Showers | under 75% |
| ☇ Storm | under 90% |
| ↯ Compact soon | 90% and up |

**Line 2: your agents** (only while there are any)

| Part | Meaning |
|---|---|
| `⑂ 2 agents (1 running)` | Subagents, teammates and workflow agents of this session. `in background` when all of them run in the background. |
| `● Explore·Haiku 5.5 low +0.3%` | One agent: its state, type, the model it actually ran on, its effort, and what it used of your Session (5-hour) limit. |
| `+3 more` | The agents that didn't fit. |

States: `●` running, `✓` done, `✗` failed (red) or stopped (grey), `⏸` a teammate waiting for a message, `⟲` it compacted its own chat. A workflow's agents show as one `workflow ×N`. Finished agents stay until your next turn starts.

While you view an agent's transcript (← for agents), the line becomes one row per agent, with `▸` on the one you're viewing.

**Then your usage limits** (the same bars as `/usage`)

| Part | Meaning |
|---|---|
| `Session` / `Week` / `Spend` | Your 5-hour limit, your weekly limit, and a company gateway's spend limit if you have one. |
| The bar | Orange: how much of the limit is used (all sessions, claude.ai too). The whole bar turns red at 90% and up. |
| `95%` | How much of that limit you've used. `over by 4%` past 100%. |
| `▲ +0.2% last` | What your last turn used, agents included. |
| `+1.2% now` | What the running turn has used so far, agents included (only while Claude works). |
| `37m → 6:30pm` | Time left until the limit resets, then the clock time. |

## Install

```sh
claude plugin install usage-forecast --marketplace thangdo19/claude-code-mods
```

More ways (inside Claude Code, older versions): see the [main README](../README.md#install).

## Develop

```sh
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .   # type check
```

- `hooks/weather.ts`: formatting helpers (no Claude Code calls, easy to test).
- `hooks/register.tsx`: the hooks and the band above the prompt.
- `types/index.d.ts`: the shape of the saved state.

## Limits

- The limit bars need a Claude subscription login. With an API key they stay hidden.
- Limits come in whole points, so a small turn often reads `<1%`.
- It only counts Claude Code on this computer. Using claude.ai or another computer at the same time makes the per-turn figures read a little high, but never more than the whole account moved (plus 1 point, since readings are whole points).

## Details

- **Updates:** after every reply from Claude, even mid-turn. The countdown ticks once a minute while idle. The chart and "last turn" figures move once per finished turn of yours. Turns cancelled before any reply don't count.
- **Agents' share:** each reply's cost goes to the agent (or you) that asked for it. Two replies landing at the same moment can swap owners; the totals stay exact. Claude Code's own background work (compaction, memory) counts as yours.
- **Several sessions at once:** the % figures show *this session's* share, not the whole account's. The mod learns how many % each $1 of usage costs, then multiplies by what this session spent. Until it has learned that (each limit needs $1 spent and 2 points moved), it shows the account's change instead.
- **Messages you may see:**
  - `waiting for first reply`: a new session, before Claude has answered.
  - `measuring…`: right after a compaction, `/clear` or `/resume`, until the next reply.
  - `↺ reset now` / `↺ reset last`: the limit reset during that turn.
  - `window reset`: the limit's reset time has passed, until a new reading arrives.
  - `↻ switched from Opus 5.5`: the model changed (`/model`, or an automatic fallback). Stays until one whole turn has run on the new model. Helper agents' models never count.
- **New session:** the bars show the last readings saved by an earlier session until Claude replies.
- **`/clear` and `/resume`:** agents still running stay listed until they finish; finished ones go.
- **`/logout`**, or switching to an API key, hides the bars and deletes the saved readings.
