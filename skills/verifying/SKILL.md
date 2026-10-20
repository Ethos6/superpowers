---
name: verifying
description: Use before saying work is done, fixed, passing, working or ready - including in final summaries, commit messages and pull request descriptions - to back the claim with fresh evidence.
---

# Verifying

A claim about code is only as good as the check behind it, and the check must be from now, after your last change.

## Before any success claim

1. Name the claim ("the tests pass", "the bug is fixed", "the build works").
2. Name the command that proves it.
3. Run it now, in full. For tracked work use `sp test <n> --expect pass` so the result is recorded.
4. Read the output: exit code, counts, warnings. Not just the last line.
5. Say what the output shows, with numbers. If it shows a failure, report the failure.

## What counts as evidence

| Claim | Needs | Not enough |
|---|---|---|
| Tests pass | Full suite run now, 0 failures | An earlier run, a subset, "should pass" |
| Bug fixed | The original reproduction now behaves correctly | The code looks right |
| Builds | Build command exits 0 | Lint or type check alone |
| Requirement met | Its acceptance check passes | The tests are green |
| Sub-agent finished | You checked its diff and re-ran the check | Its report says so |

## Wording

Say exactly what you checked and what you did not: "All 142 tests pass; I did not test on Windows." Avoid "should work", "probably fixed" and "looks good" in place of evidence. If you could not run a check, say so and why, and give the user the command to run.
