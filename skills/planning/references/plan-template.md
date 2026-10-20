# Plan: <Feature name>
Spec: ../specs/YYYY-MM-DD-<topic>.md
Status: draft
Test command: <command that runs the whole test suite>

## Context
<What a builder needs to know: relevant modules, conventions, gotchas found while planning.>

## Task 1: <Small, verifiable step>
Covers: R1
Risk: normal
Files: src/<file>, test/<file>
Done when: <observable result>
Verify: <focused test command>

- Interface: `<function or endpoint signature and data shape>`
- Edge cases beyond the acceptance checks: <empty input, limits, errors>
- Notes: <decisions and constraints, not code>

## Task 2: <Next step>
Covers: R2
Risk: low
Depends: 1
Files: <...>
Done when: <...>
Verify: <...>
