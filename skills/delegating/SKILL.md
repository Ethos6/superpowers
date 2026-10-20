---
name: delegating
description: Use when handing work to sub-agents - implementing plan tasks, investigating several independent problems at once, or getting an independent review - so each one gets a self-contained brief and its result is checked.
---

# Delegating

Sub-agents are useful for two reasons: a fresh context that is not cluttered with your conversation, and parallel work. Both only pay off if the brief is complete and the result is checked.

## When to delegate

- Implementing a plan task: use [../building/references/implementer-brief.md](../building/references/implementer-brief.md).
- Reviewing: always someone other than the author; see **reviewing**.
- Several independent problems (different failing subsystems, unrelated research questions): one agent per problem, in parallel.

Do it yourself instead when the task is a few minutes of work, when it needs the user's back-and-forth, or when the pieces share files or state.

## Parallel work

Run tasks in parallel only if `sp ready` lists them together and they touch different files. Two agents editing the same file will overwrite each other. When in doubt, run them one after another.

## Writing the brief

- State the goal, the scope boundary, and what "done" means.
- Give paths, commands and decisions, not your conversation history. A long brief made of pasted history is expensive and confusing; a short brief of facts is better.
- Say what the agent must not do (edit other areas, change the plan, close tasks in `sp`).
- Ask for a short, structured report: what changed, commands run with results, open questions.
- Choose the model deliberately when the platform allows: a fast model for mechanical tasks, the strongest for design, debugging and review.

## Checking the result

Treat the report as a claim, not evidence. Look at the actual diff, re-run the task's check yourself (`sp test <n> --expect pass`), and only then record reviews and close the task. If two parallel agents' changes conflict, resolve it yourself and re-run the full suite.

Sub-agents do their one job and report back. They may record their own task's runs with `sp test <n>` (the ledger is locked, so parallel runs are safe), but reviews, rulings, plan syncs and closing tasks belong to the coordinator. Use `sp show <n>` to fill each brief.
