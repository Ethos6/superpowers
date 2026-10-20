---
name: using-superpowers
description: Use at the start of any software task to pick the right working path and skill. It is the index of the superpowers skills and explains the sp ledger.
---

# Using superpowers

These skills are a working method, not a ritual. Match the effort to the job, and keep evidence for every claim you make about the code.

## 1. Size the request first

| Size | Signs | Path |
|---|---|---|
| Trivial | A question, a typo, a one-line fix, a config tweak | Just do it. Still run the relevant check before saying it works (**verifying**). |
| Small | The behaviour is clear and the design is obvious, even if it has a few related parts | `sp quick "<summary>" --test-cmd "<test command>"`, then **test-first** (red, then green), `sp done 1`, `sp finish`. |
| Feature | Open questions about what to build, real design choices, risky areas, or work that will take several sittings | **shaping** → **planning** → **building** → **shipping**. |

The test is not size in lines but whether the user would want a say before you build. When unsure, ask one short question; if nobody can answer, take the smaller path and write the acceptance examples as tests first.

## 2. The skills

- **shaping**: turn an idea into an approved spec with numbered requirements.
- **planning**: turn the spec into small, verifiable tasks.
- **building**: work through the plan task by task with recorded evidence.
- **test-first**: write the failing test before the code.
- **debugging**: find the root cause before changing anything.
- **verifying**: no "done", "fixed" or "passing" without fresh evidence.
- **reviewing**: get and give code review; answer review feedback.
- **delegating**: hand work to sub-agents with self-contained briefs.
- **shipping**: final check, summary, and how to integrate.
- **writing-skills**: add or change a skill in this collection.

## 3. The sp ledger

`sp` records task state, test runs and reviews in `.superpowers/`. Use it for any small or feature-sized work; it is what lets you resume correctly after the conversation is compacted. Run `sp init` once per project. `sp status` always tells you where things stand; trust it over your memory of the conversation.

`sp` refuses to close a task that lacks its evidence. Provide the evidence; do not work around a refusal. `.superpowers/` is changed only through `sp`. If the honest fix is a plan change (a task that cannot be test-first, a different risk), agree it with the user, edit the plan or spec, and run `sp sync --reason "<what the user agreed>"`; the change and the reason are recorded in the final report.

## 4. Ground rules

- The user's explicit instructions override these skills.
- Ask one question at a time, and only when the answer changes what you do.
- Report honestly: say what you did not check, and what failed.
