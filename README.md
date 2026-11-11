# skills

My agent tooling. Claude Code plugins live in [`claude-plugins/`](claude-plugins); the repo root is a Claude Code **plugin marketplace** (`.claude-plugin/marketplace.json`) that lists them, so each one installs with one line.

## Terminology

- **Plugin** — the unit you install. One plugin can hold any mix of the parts below.
- **Command** — `commands/<name>.md`, a prompt run by typing `/<name>`. `$ARGUMENTS` is whatever follows the command.
- **Skill** — `skills/<name>/SKILL.md`, instructions the model loads on its own when the description matches the task (or by `/<name>`).
- **Agent** — `agents/<name>.md`, a subagent with its own system prompt and tool list.
- **Hook** — `hooks/hooks.json`, shell commands (or, in newer builds, a TypeScript "mod" module) run on events such as `PreToolUse`, `Stop` or `UserPromptSubmit`.
- **Marketplace** — a repo that lists plugins, so they install with one line.

## Plugins

| Plugin | What it does |
| --- | --- |
| [`wat`](claude-plugins/wat) | `/wat` restates the last reply in plain ASD-STE100 Simplified Technical English. `/wat <text or part>` restates a specific thing. |
| [`agent-env`](claude-plugins/agent-env) | Hooks. On session start: the agent's Bash gets the project's `mise` toolchain, and github.com git goes over HTTPS with `gh` credentials (skip with `AGENT_ENV_GIT_VIA_GH=0`). A Mix project without `deps/` gets a "run setup first" note. After each Elixir edit: `mix format` on just that file. |

## Install

At the Claude Code prompt:

```
/plugin marketplace add petermueller/skills
/plugin install wat@peter-plugins
```

From a shell:

```bash
claude plugin marketplace add petermueller/skills
claude plugin install wat@peter-plugins
```

To pick up new versions: `/plugin marketplace update peter-plugins`.

To try a plugin from a clone without installing it:

```bash
claude --plugin-dir claude-plugins/wat
```

## Adding a plugin

1. Create `claude-plugins/<name>/.claude-plugin/plugin.json` with `name`, `version` and `description`.
2. Add the parts it needs: `commands/`, `skills/`, `agents/`, `hooks/`.
3. Add an entry to `.claude-plugin/marketplace.json`: `{ "name": "<name>", "source": "./claude-plugins/<name>", "description": "..." }`.
4. Add a row to the table above.
5. Run `claude plugin validate .` and `claude plugin validate claude-plugins/<name>`.
