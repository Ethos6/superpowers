"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const docs = require("../lib/docs.cjs");
const { tmpdir, SPEC, plan } = require("./helpers.cjs");

test("a complete spec passes and is parsed", () => {
  const { spec, errors } = docs.checkSpec(SPEC);
  assert.deepEqual(errors, []);
  assert.equal(spec.title, "Slugify helper");
  assert.equal(spec.status, "approved");
  assert.deepEqual(spec.requirements.map((r) => r.id), ["R1", "R2"]);
  assert.deepEqual(spec.acceptance.map((a) => a.covers), [["R1"], ["R2"]]);
});

test("spec problems are each reported", () => {
  const bad = `# T
## Goal

## Requirements
- R1: one
- R1: duplicate
- R2: never checked

## Acceptance
- A1 (R1, R9): mentions a missing requirement
- A2 (): covers nothing
`;
  const errs = docs.checkSpec(bad).errors.join("\n");
  for (const re of [/non-empty `## Goal`/, /R1 is defined twice/, /A1 refers to R9/, /A2 does not say/, /R2 has no acceptance check/]) assert.match(errs, re);
  assert.match(docs.checkSpec("no title here").errors.join("\n"), /Title/);
  assert.match(docs.checkSpec("# T\n## Goal\nx\n## Requirements\n## Acceptance\n").errors.join("\n"), /no requirements found[\s\S]*no acceptance checks/);
});

test("spec parsing tolerates bold ids, dashes, CRLF and a BOM", () => {
  const text = "\uFEFF# T\r\n**Status:** approved\r\n## Goal\r\nx\r\n## Requirements\r\n* **R1** \u2014 first\r\n## Acceptance\r\n- **A1** (R1) \u2013 works\r\n";
  const { spec, errors } = docs.checkSpec(text);
  assert.deepEqual(errors, []);
  assert.equal(spec.status, "approved");
  assert.equal(spec.requirements[0].text, "first");
});

function writePlan(text, specText = SPEC) {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, "docs", "specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "specs", "slug.md"), specText);
  const p = path.join(root, "docs", "plans", "p.md");
  fs.writeFileSync(p, text);
  return { root, p };
}

test("a complete plan passes with full traceability", () => {
  const { root, p } = writePlan(plan());
  const res = docs.checkPlan(fs.readFileSync(p, "utf8"), { planPath: p, root });
  assert.deepEqual(res.errors, []);
  assert.equal(res.plan.tasks.length, 2);
  assert.deepEqual(res.plan.tasks[1].depends, [1]);
  assert.equal(res.plan.tasks[1].risk, "low");
  assert.equal(res.plan.testCommand, "node check.cjs");
});

test("plan problems are each reported", () => {
  const tasks = `## Task 1: Missing fields
Covers: R1, R7
Risk: extreme
Test-first: no

## Task 3: Out of order
Covers: R1
Depends: 3
Done when: x
Verify: y
`;
  const { root, p } = writePlan(plan({ tasks }));
  const errs = docs.checkPlan(fs.readFileSync(p, "utf8"), { planPath: p, root }).errors.join("\n");
  for (const re of [/Task 1 has no `Verify:`/, /Task 1 has no `Done when:`/, /Risk "extreme"/, /Test-first: no` without a reason/, /covers R7, which is not in the spec/, /Task 3 .* out of order/, /Task 3 depends on Task 3/, /R2 is not covered by any task/])
    assert.match(errs, re);
});

test("an approved plan needs an approved spec, and a spec that exists", () => {
  const { root, p } = writePlan(plan(), SPEC.replace("Status: approved", "Status: draft"));
  assert.match(docs.checkPlan(fs.readFileSync(p, "utf8"), { planPath: p, root }).errors.join(), /spec is not/);
  const r2 = writePlan(plan().replace("../specs/slug.md", "../specs/nope.md"));
  assert.match(docs.checkPlan(fs.readFileSync(r2.p, "utf8"), { planPath: r2.p, root: r2.root }).errors.join(), /not found/);
  const r3 = writePlan(plan().replace(/Spec: .*\n/, "Spec: none - internal refactor\n").replace(/Covers: R\d/g, "Covers: none - refactor"));
  assert.deepEqual(docs.checkPlan(fs.readFileSync(r3.p, "utf8"), { planPath: r3.p, root: r3.root }).errors, []);
});

test("plans that transcribe code are flagged; headings inside code fences are ignored", () => {
  const code = Array.from({ length: 45 }, (_, i) => `line ${i}`).join("\n");
  const tasks = `## Task 1: Big
Covers: R1, R2
Done when: x
Verify: y

\`\`\`js
## Task 2: not a task
${code}
\`\`\`
`;
  const { root, p } = writePlan(plan({ tasks }));
  const res = docs.checkPlan(fs.readFileSync(p, "utf8"), { planPath: p, root });
  assert.equal(res.plan.tasks.length, 1);
  assert.match(res.errors.join(), /46 lines of code/);
  const small = tasks.replace(code, Array.from({ length: 14 }, (_, i) => `l${i}`).join("\n"));
  const { root: r2, p: p2 } = writePlan(plan({ tasks: small }));
  const res2 = docs.checkPlan(fs.readFileSync(p2, "utf8"), { planPath: p2, root: r2 });
  assert.deepEqual(res2.errors, []);
  assert.match(res2.warnings.join(), /15 lines of code/);
});

test("test-first opt-out keeps its reason; field markup variants are read", () => {
  const tasks = `### Task 1 - Config only
- **Covers:** R1, R2
- **Risk:** Low
- **Test-first:** no - pure configuration
- **Done when:** loads
- **Verify:** \`node check.cjs\`
`;
  const { root, p } = writePlan(plan({ tasks }));
  const res = docs.checkPlan(fs.readFileSync(p, "utf8"), { planPath: p, root });
  assert.deepEqual(res.errors, []);
  const t = res.plan.tasks[0];
  assert.equal(t.testFirst, false);
  assert.equal(t.testFirstReason, "pure configuration");
  assert.equal(t.verify, "node check.cjs");
  assert.equal(t.risk, "low");
});
