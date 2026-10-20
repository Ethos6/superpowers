---
name: planning
description: Use when an approved spec exists and the work must be broken into tasks before coding, or when the user asks for an implementation plan.
---

# Planning

Goal: a plan the user approved, where every task is small, independently verifiable, and traced to the spec's requirements. `sp plan check` enforces the structure.

## Write the plan

Create `docs/plans/YYYY-MM-DD-<topic>.md` from [references/plan-template.md](references/plan-template.md). The header needs `Spec:`, `Status: draft` and `Test command:` (the command that runs the whole suite).

Each `## Task N: <title>` needs:

- `Covers:` the requirement ids it delivers (`R1, R3`), or `none - <reason>` for pure setup.
- `Risk:` decides the review rule.
  - `low`: mechanical or well covered by existing tests (renames, config, docs, small pure functions). No review needed.
  - `normal`: ordinary feature work. One review.
  - `high`: a mistake would be costly or hard to undo: authentication and permissions, handling untrusted input, data migrations or deletion, money, concurrency, or an interface other systems already depend on. The approving review must come from a sub-agent or the user, not the author.
- `Files:` the files you expect to touch.
- `Depends:` earlier task numbers it needs, if any. Tasks without dependencies between them can run in parallel.
- `Done when:` the observable result.
- `Verify:` one command that proves it, usually a focused test run.
- `Test-first: no - <reason>` only when a failing test first is genuinely impossible (pure config, docs, generated code).

## What belongs in a task

Write decisions, not code: function signatures, data shapes, edge cases beyond the acceptance checks, and anything surprising about the codebase. Do not copy the acceptance checks into tasks; `sp next` already puts the covered requirements and their checks in each task's brief. A builder should not need to rediscover what you learned while planning. Leave the implementation to the builder; more than a dozen lines of code in a task is a sign the plan is doing the building, and `sp plan check` will warn.

Order tasks so each one leaves the project working and tested. Two to five hours of human work is too big for one task; aim for something a focused agent finishes in one sitting.

## Check and approve

1. Run each task's `Verify:` command once to be sure it runs (it should fail or find no tests yet, not error out), then `sp plan check <plan>` until it reports OK. It verifies every requirement is covered by some task, every task has `Verify:` and `Done when:`, and the spec itself is valid and approved.
2. Show the user the task list (titles, risk, what each proves). Adjust until they approve.
3. Set `Status: approved`, then use **building**.

If the plan changes during building, edit the file and run `sp sync`; progress on existing tasks is kept.
