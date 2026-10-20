---
name: reviewing
description: Use when a task needs code review, when asked to review changes, or when responding to review feedback from a person or another agent.
---

# Reviewing

## Getting a review

1. Prepare the change: the diff for this task only, the task brief from `sp show <n>`, and the test command. If each task is committed when it closes, the task's diff is `git diff <previous task's commit>`. If nothing is committed yet, run `git add -N <new files>` so new files show up, then `git diff -- <files this task touched>`, and tell the reviewer that earlier tasks' changes may also appear.
2. Give it to a reviewer that did not write the code: a sub-agent with [references/reviewer-prompt.md](references/reviewer-prompt.md) and those inputs, nothing else from your conversation. Without sub-agents, do the review yourself with the same checklist, deliberately reading the diff as a stranger, except for high-risk tasks: those go to the user for review.
3. The reviewer returns JSON findings. Save them and record the round:
   `sp review <n> --findings findings.json --by agent` (the verdict is read from the file), or `sp review <n> --verdict approve --by self` for a self-review. High-risk tasks need `--by agent` or `--by user`.
4. Fix blockers and majors, then re-run the check and request the next round. Minors can be fixed or noted.
5. Do not argue the reviewer out of a finding, and do not ask it to soften its verdict. If you think a finding is wrong, give your evidence to the reviewer in the next round. If the round limit is reached with findings still open, `sp rule <n> --accept "<why>"` records the decision; before the limit, accepting over findings needs the user's agreement (`--by user`).

The round limit exists because reviewers can always find something new. When `sp` says the limit is reached, decide instead of looping.

## Giving a review

Read the task's requirements first, then the diff. Check, in order: does it do what the task says; are the tests real and would they catch a regression; edge cases and error paths; security and data handling; readability. Report each issue with severity (`blocker`, `major`, `minor`), file, line, and a concrete fix. Say what you did not check.

## Responding to feedback

- Read all the feedback before changing anything.
- Verify each point against the code. Reviewers are often right and sometimes wrong.
- If a point is wrong or would break something, say so with the evidence, politely and briefly.
- If it is unclear, ask before implementing.
- Fix one item at a time and re-run the tests after each.
- Reply with what changed, not with praise or apology.
