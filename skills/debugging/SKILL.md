---
name: debugging
description: Use when something fails or behaves unexpectedly - a failing test, a crash, wrong output, a flaky check, or a fix that did not work - before changing any code to fix it.
---

# Debugging

Fixing a symptom you do not understand usually moves the bug or adds a new one. Find the cause first; the fix is then usually small and obvious.

## 1. Reproduce

Get a reliable, minimal reproduction: the exact command, input and output. If it is intermittent, find what makes it likelier (load, ordering, timing) and run it in a loop to measure how often it fails. Without a reproduction you cannot know a fix worked.

## 2. Read the evidence

Read the whole error and stack trace. Check what changed recently (`git log`, `git diff`, dependency updates). Compare with a similar case that works and list every difference.

## 3. Trace to the source

Follow the bad value backwards through the call chain until you find where it first became wrong. The place where an error is thrown is rarely where it was caused. Add temporary logging at boundaries between components when the path is unclear, and remove it afterwards.

For test pollution, run the suite in halves to find which earlier test leaves bad state behind.

## 4. One hypothesis at a time

State it ("the cache key ignores the tenant id"), predict what you should observe if it is true, and run the smallest experiment that tells you. Change one thing per experiment. If it is wrong, undo the change before trying the next idea.

## 5. Fix at the root

Write a failing test that reproduces the bug (**test-first**), fix the cause, and verify the original reproduction now passes. Consider adding a check where the bad value entered, so the same class of bug fails loudly next time.

## Three strikes

If three fixes have failed, stop. The problem is likely in your model of the system, not in the details. Summarise what you know, what you tried, and what each attempt showed, then ask the user or re-examine the design with them. Do not try a fourth guess.
