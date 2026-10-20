---
name: shipping
description: Use when all tasks of a plan or quick task are closed, or when the user asks to wrap up, merge, or open a pull request for finished work.
---

# Shipping

## 1. Final check

Run `sp finish`. It refuses while tasks are open, runs the plan's full `Test command`, and only then marks the work finished and writes a report to `.superpowers/reports/`. If the suite fails, the work is not finished: go back to **debugging**.

Then check the requirements, not just the tests: for each acceptance check in the spec, confirm it holds (most will be covered by tests; run any that are manual).

## 2. Summarise for the user

Short and factual:
- What was built, mapped to the requirements (R1 ... Rn).
- Evidence: the final test command and its result, plus anything checked by hand.
- Deferred tasks and accepted review findings, with the reasons recorded in `sp`.
- Anything you did not verify, and any follow-ups.

## 3. Integrate - the user decides

Offer the options that fit the repository and wait for the choice:

1. **Commit and merge** into the base branch locally.
2. **Push and open a pull request**, with the summary above as its description.
3. **Leave it as is** on the current branch for the user to handle.

Never push, merge, force-push, delete branches or discard work without the user's explicit go-ahead in this conversation. If you created a worktree or branch for this work, offer to remove it only after the work is merged or the user says to discard it.

## 4. Commit hygiene

Commit messages say what changed and why, in the project's existing style. Do not commit `.superpowers/` (it ignores itself). Whether specs and plans are committed is the user's choice.
