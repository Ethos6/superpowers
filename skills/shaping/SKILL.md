---
name: shaping
description: Use when a request is feature-sized or vague - several parts, unclear requirements, or design choices - to agree with the user on what to build before any planning or code.
---

# Shaping

Goal: a short spec the user has approved, with numbered requirements that each have a way to be checked. No code is written while shaping.

## Steps

1. **Read before asking.** Look at the relevant code, docs and recent commits so your questions are specific.
2. **Ask about intent, one question per message.** Prefer multiple choice when the options are known. Stop asking once you could explain the feature to a new teammate. Typical gaps: who uses it, what "done" looks like, limits and edge cases, what is out of scope.
3. **Offer two or three approaches** when there is a real design choice. Give the trade-off of each in a line and say which you recommend and why.
4. **Write the spec** at `docs/specs/YYYY-MM-DD-<topic>.md` using [references/spec-template.md](references/spec-template.md):
   - `## Goal`: one paragraph.
   - `## Requirements`: `- R1: ...`, one testable behaviour each. Requirements describe *what*, not *how*.
   - `## Acceptance`: `- A1 (R1): ...`, an observable check for every requirement (an input and its expected result, a command and its output).
   - `## Out of scope`: what you will deliberately not do.
   - `Status: draft` near the top.
5. **Check it:** `sp spec check <file>`. Fix every problem it lists.
6. **Show it to the user** in short sections they can actually read, and ask for corrections. Edit until they approve.
7. **Record approval** by changing the line to `Status: approved`, then move to **planning**.

## Keep it small

- A spec longer than a page usually hides several features. Split it, and shape the first one.
- If the user already gave a complete, precise description, write the spec from it directly and confirm, rather than re-asking.
- Do not invent requirements the user did not ask for. Put tempting extras under "Out of scope" or ask.

Whether to commit specs is the user's choice. Ask once per project if it is not obvious from the repository.
