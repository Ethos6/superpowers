# Implementer brief

Use this when a sub-agent implements one task. Fill it from `sp show <n>` (the task text, requirements and acceptance checks) and keep it self-contained: the sub-agent has none of your conversation. Do not paste earlier tasks' history; give it the facts it needs instead.

```text
You are implementing one task in an existing codebase at <repo path>.

Task <n>: <title>
<the task text from the plan>

Requirements this task must satisfy:
<requirement lines from sp next>
Acceptance checks:
<acceptance lines>

Context you need:
- <relevant files and what they do>
- <conventions: test framework, style, how to run tests>
- <decisions already made that you must not revisit>

How to work:
1. Read the files named above before editing.
2. Test first: write the failing test, run `<sp command> test <n> --expect fail`,
   implement the smallest change, run `<sp command> test <n> --expect pass`,
   then run the full suite: <test command>.
3. Change only what this task needs. If the task is wrong or blocked, stop and
   report why instead of improvising a different design.
4. Record your own runs with `sp test <n>` for this task only. Do not run
   sp review, rule, sync or done, and do not edit .superpowers/; the
   coordinator reviews and closes tasks.

Report back, briefly:
- What you changed (files) and why.
- The exact test commands you ran and their results.
- Anything you were unsure about or did not do.
```

The coordinator then checks the diff, re-runs the check, gets a review if the task's risk needs one, and closes the task with `sp done`.
