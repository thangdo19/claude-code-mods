# claude-code-mods

Small mods (plugins) that change how Claude Code looks and sounds.

| Mod | What it does |
|---|---|
| [producer-tag](producer-tag/README.md) | An anime voice says 「マスター！確認してください」 ("Master! Please check this.") when Claude finishes or needs you. |
| [usage-forecast](usage-forecast/README.md) | A "weather report" above the prompt: how full the context is, plus your session and weekly limits. |

## Requirements

| | producer-tag | usage-forecast |
|---|---|---|
| **Claude Code** | In a terminal. Tested on 2.1.296; older versions may not load these mods. | same |
| **Computer** | macOS, because it plays sound with `afplay`. Silent on Linux and Windows. | any |
| **Login** | any | Signed in with a Claude subscription (not an API key) for the Session and Week bars. With an API key, only the context line shows. |
| **Other** | Sound turned on | none |

- Check your version with `claude --version`, and update with `claude update`.
- These mods don't run on claude.ai in the browser or in cloud sessions, because those don't load plugins installed on your computer.

## Install

Run in your terminal, one line per mod you want (needs Claude Code 2.1.292 or newer):

```sh
claude plugin install producer-tag --marketplace thangdo19/claude-code-mods
claude plugin install usage-forecast --marketplace thangdo19/claude-code-mods
```

Already inside Claude Code? Type the same line with `/plugin` instead of `claude plugin` (needs 2.1.275 or newer).

<details>
<summary>Older Claude Code (before 2.1.292)</summary>

```sh
claude plugin marketplace add thangdo19/claude-code-mods
claude plugin install usage-forecast@claude-code-mods
```

</details>

## Manage

```sh
claude plugin marketplace update claude-code-mods   # get the newest version
claude plugin disable usage-forecast                # turn a mod off
claude plugin enable usage-forecast                 # turn it back on
```

Or type `/plugin` inside Claude Code to browse and manage them.

## Develop

Run a mod from your own copy instead of the installed one:

```sh
git clone https://github.com/thangdo19/claude-code-mods
claude --plugin-dir <YOUR-PATH>/claude-code-mods/usage-forecast
```

> [!IMPORTANT]
> Replace `<YOUR-PATH>` with the folder where you ran `git clone`, e.g. `/Users/you/projects`.
> Not sure? Run `pwd` in that same folder.

Then, inside a mod's folder:

```sh
claude plugin validate .   # checks the plugin files
claude plugin test .       # runs the tests
```
