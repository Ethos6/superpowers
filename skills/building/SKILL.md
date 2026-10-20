---
name: building
description: Use when an approved plan exists and it is time to implement it, or when resuming implementation after a break or context compaction.
---

# Building

Goal: every task closed with recorded evidence, without redoing finished work or getting stuck in review loops.

## Start or resume

- New plan: `sp start <plan>`. It refuses unapproved or invalid plans and refuses to mix two plans.
- Resuming, or unsure where you are: `sp status`. The ledger is the truth; never redo a task it shows as done.
- If the plan changed (with the user's agreement): `sp sync`. Changes that weaken recorded work, such as lowering a task's risk, need `--reason`, and `sp` refuses to close tasks until the ledger and plan agree.

Optional isolation: if the user wants the work kept apart from their current checkout, use a branch or `git worktree add` before starting. Ask first; do not assume.

## The loop, per task

1. `sp next` prints the task brief (the plan text plus the requirements and acceptance checks it covers) and marks it active; `sp show <n>` prints any task's brief and evidence without changing anything. Read the files it names before changing anything.
2. Implement with **test-first**: write the test, `sp test <n> --expect fail`, make it pass with the smallest change, `sp test <n> --expect pass`.
3. Review by risk, using **reviewing**:
   - `low`: no review needed; the green run is the evidence.
   - `normal`: one review, by a sub-agent if available, otherwise a careful self-review against the reviewer checklist.
   - `high`: the approval must come from a sub-agent (`--by agent`) or the user (`--by user`). Without sub-agents, show the user the diff and the checklist and ask them to review it.
   Record it: `sp review <n> --verdict approve --by agent`, or `--verdict changes --findings f.json`. Self-reviews are recorded as `--by self` (the default).
4. Fix requested changes, re-run the check, record the next review round. After the configured number of rounds (3 by default) `sp` tells you to stop looping: accept the remaining findings with `sp rule <n> --accept "<reason>"`, or set the task aside with `--defer "<reason>"`, and tell the user which you chose. A high-risk task can only be accepted over findings by the user (`--by user`, after they agree).
5. `sp done <n>`. If it refuses, it lists exactly what is missing. Provide it; do not argue with it.

Run independent tasks in parallel only when `sp ready` lists several and they touch different files; see **delegating**.

## When to stop and ask the user

- The plan is wrong or impossible (a requirement conflicts with the code, a dependency is missing).
- A decision would change what the user approved.
- The same failure survives three honest attempts: switch to **debugging**, then ask.

Otherwise keep going and make reasonable choices, noting them in the task summary. Do not stop to ask permission for things the plan already settled.

## Finish

When `sp status` says all tasks are closed, use **shipping**.
