---
name: test-first
description: Use when writing or changing code that has behaviour to test - new features, bug fixes, refactors - so that a failing test exists before the implementation.
---

# Test first

A test you have never seen fail proves nothing: it might not run, might test the wrong thing, or might pass by accident. So the order is fixed: failing test, minimal code, passing test, tidy up.

## The cycle

1. **Write one test** for the next small behaviour. Use the exact examples from the spec's acceptance checks when they exist. Name it after the behaviour, not the function.
2. **Watch it fail** for the right reason: `sp test <n> --expect fail --match "<name of the new test>"`. Without `-- <command>` it runs the task's `Verify:` command; add one to run something more focused. `--match` makes the run count only if its output mentions your test, which rules out failures elsewhere in the suite. It cannot tell why your test failed, so read the message: a missing import or typo is not the red you want.
3. **Make it pass** with the smallest change that does so. No extra features, options or "while I'm here" edits.
4. **Run it green:** `sp test <n> --expect pass`. Then run the wider suite, since a change can break neighbours. Long output can be shortened with `--tail 40`.
5. **Tidy** names and duplication with the tests green. Re-run after tidying.

`sp done` checks that a failing run was recorded before the first passing one. That is the evidence that the test came first.

## Bug fixes

Reproduce the bug as a failing test first. That test is the proof the fix works and the guard against it coming back.

## Good tests

- Test behaviour through the public interface, not private details.
- One reason to fail per test. Clear failure messages.
- Real code over mocks; mock only slow, external or non-deterministic edges (network, clock, randomness).
- No sleeps to wait for async work; wait for the condition itself, with a timeout.

## When test-first does not fit

Pure configuration, documentation, generated code, or exploratory spikes you will throw away. Mark the plan task `Test-first: no - <reason>` and still record a passing check before closing it. If you wrote code before its test anyway, say so plainly; the honest fix is to delete that code and redo it test-first.
