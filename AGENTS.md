# superpowers for other coding agents

This repository's skills work in any agent that can read Markdown and run shell commands (Codex, Gemini CLI, Cursor, OpenCode and others). Claude Code users should install it as a plugin instead; see the README.

To use it in another agent, add this to the project's `AGENTS.md` (or the agent's equivalent instructions file), replacing `<path>` with where you cloned this repository:

```text
Follow the working method in <path>/skills. Start by reading
<path>/skills/using-superpowers/SKILL.md, and read a skill's SKILL.md when its
description matches the situation. Run the ledger as:
  node <path>/scripts/sp.cjs <command>
Where the skills say `sp`, use that command.
```

Agents without hooks do not get the automatic session-start reminder or the optional edit and stop gates. Everything `sp` enforces (test-first evidence, review rules, resumable state) still applies, because it is checked by the command itself.
