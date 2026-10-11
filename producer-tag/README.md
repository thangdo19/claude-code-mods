# producer-tag

When Claude finishes or needs you, an anime-style voice calls out:

> 「マスター！ …確認してください」 ("Master! …Please check this.")

You can look away while Claude works. The voice tells you when it's your turn.

## When it plays

- **Claude finished its reply** (the `Stop` hook).
- **Claude asks permission**: to run a tool, or to go ahead with a plan (`PermissionRequest`).
- **Claude needs you for something else**, like a question from an MCP server (`Notification`).

## Install

```sh
claude plugin install producer-tag --marketplace thangdo19/claude-code-mods
```

More ways (inside Claude Code, older versions): see the [main README](../README.md#install).

## Use your own sound

Set the `sound` option to your file. Pick one way:

```sh
# when installing
claude plugin install producer-tag --marketplace thangdo19/claude-code-mods --config 'sound=~/sounds/done.mp3'

# any time later (then restart Claude Code)
echo '{"sound": "~/sounds/done.mp3"}' | claude plugin configure producer-tag@claude-code-mods --values-stdin
```

Or inside Claude Code: `/plugin configure producer-tag@claude-code-mods`, or `/config` → **Sound file**.

- **Formats:** `.wav`, `.mp3`, `.m4a`, `.aiff`, up to 4 MB.
- **Path:** a full path (`/Users/you/sounds/done.mp3`) or one starting with `~/`.
- **Back to the default:** clear the option (leave it empty).
- **If your file is missing or won't play**, the default tag plays instead, so you never miss an alert.

## Change the gap between plays

`COOLDOWN_MS` in `hooks/register.ts` (4 seconds by default).

## Limits

- macOS only, because Claude Code plays sound with `afplay`. On Linux and Windows it stays silent.

## Details

- **No double plays:** one prompt can trigger two alerts at once, so the tag won't play again within 4 seconds.
- **Reminders:** after 6 seconds at a permission dialog, Claude Code sends a reminder. For a tool or plan dialog the tag already played, so the reminder stays quiet. Any other dialog plays on its reminder.
- **Stays quiet** when a helper agent (subagent) finishes, when a Stop hook sends Claude back to work, and for the 60-second "still idle" nudge.
- **Never in the way:** the sound plays in the background. It never slows Claude down, and if it can't play, nothing breaks.

## Credits

Voice: Amitaro's Voice Material Studio (https://amitaro.net/)
音声素材：あみたろの声素材工房（https://amitaro.net/）

`sounds/tag.wav` joins two of Amitaro's free clips, 「マスター！」 (`203_sentou/master_01.wav`) and 「確認してください」 (`205_system/kakuninshite_01.wav`). Silence was trimmed, the volume evened out, and a short pause added between them. Under [Amitaro's terms](https://amitaro.net/voice/voice_rule/), the clips may ship inside a mod with this credit, but must not be shared as standalone sound files.
