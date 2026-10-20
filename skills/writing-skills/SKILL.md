---
name: writing-skills
description: Use when creating a new skill for this collection, or changing an existing one, so it triggers at the right time, stays short, and is tested.
---

# Writing skills

A skill is read by a model under time pressure. It must be found at the right moment, be short enough to read in full, and change behaviour in a way you have actually observed.

## Structure

```
skills/<name>/SKILL.md          required; name is lowercase-with-hyphens and matches the folder
skills/<name>/references/*.md   optional detail, linked from SKILL.md and read only when needed
```

Frontmatter has `name` and `description` only.

## The description decides when it is used

- Start with "Use when" (or "Use at" / "Use before" for a moment in the work) and describe the situation and symptoms, not the procedure. If the description summarises the steps, the model may follow the summary and skip the body.
- Mention the words a user or the situation would contain ("failing test", "pull request", "flaky").
- Keep it under 300 characters.

## The body

- Lead with the goal in one or two sentences, then numbered steps.
- Prefer plain, calm instructions with the reason attached. Capitals and threats do not make a model more careful; clear reasons do.
- Put anything a script can enforce into `sp` or a hook instead of prose, and make the prose point at it.
- Budget: the test suite fails if a SKILL.md body exceeds 600 words. Move detail to `references/`.

## Test it before trusting it

1. Write down two or three situations where the skill should change behaviour, and one where it should not trigger.
2. Run each with a fresh agent without the skill and note what goes wrong.
3. Add the skill and run them again. Keep only text that changed an outcome; delete the rest.
4. Run `npm test`: it checks every skill's frontmatter, description, word budget, and that its links resolve.
