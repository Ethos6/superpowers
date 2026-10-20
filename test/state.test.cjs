"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const st = require("../lib/state.cjs");
const { project, tmpdir, plan } = require("./helpers.cjs");

const PLAN = "docs/plans/slug.md";
const run = (root, id, expect, exit) => st.recordRun(root, id, { cmd: "node check.cjs", expect, exit });

test("init is idempotent, keeps settings, and ignores itself in git", () => {
  const root = tmpdir();
  st.init(root, { enforce: "on" });
  st.init(root);
  assert.equal(st.loadConfig(root).enforce, "on");
  assert.equal(fs.readFileSync(path.join(root, ".superpowers", ".gitignore"), "utf8"), "*\n");
  assert.throws(() => st.init(root, { enforce: "maybe" }), /--enforce/);
});

test("findRoot walks up to the project root", () => {
  const root = project();
  const deep = path.join(root, "a", "b");
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(st.findRoot(deep), root);
  assert.equal(st.findRoot(tmpdir()), null);
});

test("start refuses draft and invalid plans, and a second plan", () => {
  const draft = project({ status: "draft" });
  assert.throws(() => st.start(draft, PLAN), /not approved/);
  const bad = project({ tasks: "## Task 1: x\nCovers: R1\n" });
  assert.throws(() => st.start(bad, PLAN), /problem\(s\)/);
  const root = project();
  st.start(root, PLAN);
  assert.throws(() => st.start(root, PLAN), /already started/);
  fs.copyFileSync(path.join(root, PLAN), path.join(root, "docs/plans/other.md"));
  assert.throws(() => st.start(root, "docs/plans/other.md"), /work is already in progress/);
  assert.throws(() => st.start(root, "docs/plans/other.md", { force: true }), /--force needs --reason/);
  assert.equal(st.start(root, "docs/plans/other.md", { force: true, reason: "user switched priorities" }).plan.path, "docs/plans/other.md");
  const archived = fs.readdirSync(path.join(root, ".superpowers", "abandoned"));
  assert.equal(archived.length, 1, "the replaced work is archived, not lost");
  const saved = JSON.parse(fs.readFileSync(path.join(root, ".superpowers", "abandoned", archived[0]), "utf8"));
  assert.equal(saved.abandonedBecause, "user switched priorities");
  assert.equal(saved.state.plan.path, PLAN);
});

test("next respects dependencies and resumes the active task", () => {
  const root = project();
  st.start(root, PLAN);
  assert.equal(st.next(root, { peek: true }).task.id, 1);
  assert.equal(st.loadState(root).tasks[0].status, "pending", "peek does not mark active");
  assert.equal(st.next(root).task.id, 1);
  assert.equal(st.next(root).task.id, 1, "the active task comes back after a resume");
  assert.deepEqual(st.readyTasks(st.loadState(root)).map((t) => t.id), [1], "task 2 waits on task 1");
});

test("done needs a passing latest run, red before green, and a review for normal risk", () => {
  const root = project();
  st.start(root, PLAN);
  st.next(root);
  assert.throws(() => st.done(root, 1), /no check recorded/);
  run(root, 1, "pass", 0);
  assert.throws(() => st.done(root, 1), /no failing run was recorded before a passing one[\s\S]*has no review/);
});

test("the full happy path closes tasks in order and finishes", () => {
  const root = project();
  st.start(root, PLAN);
  st.next(root);
  assert.equal(run(root, 1, "fail", 1).run.ok, true, "an expected failure is a successful red run");
  assert.equal(run(root, 1, "pass", 0).run.ok, true);
  st.recordReview(root, 1, { verdict: "approve" });
  st.done(root, 1);
  assert.throws(() => st.done(root, 1), /already done/);
  st.next(root);
  run(root, 2, "fail", 1);
  run(root, 2, "pass", 0);
  st.done(root, 2); // low risk: no review needed
  const fin = st.finish(root, { cmd: "node check.cjs", exit: 0 });
  assert.equal(fin.ok, true);
  assert.ok(st.loadState(root).finished);
  assert.throws(() => st.next(root), /no work in progress/);
});

test("a later failing run reopens the evidence gap", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 1, "fail", 1);
  run(root, 1, "pass", 0);
  st.recordReview(root, 1, { verdict: "approve" });
  run(root, 1, "pass", 1); // regression after review
  assert.throws(() => st.done(root, 1), /latest recorded run is not a passing check/);
});

test("expectations are judged correctly, including timeouts", () => {
  const root = project();
  st.start(root, PLAN);
  assert.equal(run(root, 1, "fail", 0).run.ok, false, "a run that passes when it should fail is not red");
  assert.equal(run(root, 1, "pass", 2).run.ok, false);
  assert.equal(run(root, 1, "fail", null).run.ok, false, "a timeout is not evidence of a real failure");
  assert.throws(() => run(root, 1, "maybe", 0), /--expect/);
});

test("test-first evidence is a failing run followed by a passing one", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 1, "pass", 0); // a baseline green before writing the new test is fine
  st.recordReview(root, 1, { verdict: "approve" });
  assert.throws(() => st.done(root, 1), /no failing run was recorded before a passing one/);
  run(root, 1, "fail", 1);
  assert.throws(() => st.done(root, 1), /latest recorded run is not a passing check/, "red last: not done");
  run(root, 1, "pass", 0);
  st.done(root, 1);
});

test("a failed pass-expected run counts as the red run (no permanent lock-out)", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 1, "pass", 1); // the new test fails while expecting a pass
  run(root, 1, "pass", 0);
  st.recordReview(root, 1, { verdict: "approve" });
  st.done(root, 1);
});

test("tdd can be switched off per project, and per task with a reason", () => {
  const root = project();
  const cfgFile = path.join(root, ".superpowers", "config.json");
  fs.writeFileSync(cfgFile, JSON.stringify({ ...st.loadConfig(root), tdd: false }));
  st.start(root, PLAN);
  run(root, 1, "pass", 0);
  st.recordReview(root, 1, { verdict: "approve" });
  st.done(root, 1);

  const r2 = project({
    tasks: "## Task 1: Config\nCovers: R1, R2\nRisk: low\nTest-first: no - config only\nDone when: x\nVerify: node check.cjs\n",
  });
  st.start(r2, PLAN);
  run(r2, 1, "pass", 0);
  st.done(r2, 1);
});

test("review rounds: changes need content, the cap is reported, rulings close loops", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 1, "fail", 1);
  run(root, 1, "pass", 0);
  assert.throws(() => st.recordReview(root, 1, { verdict: "changes" }), /needs findings or a --note/);
  assert.throws(() => st.recordReview(root, 1, { verdict: "lgtm" }), /--verdict/);
  assert.throws(() => st.recordReview(root, 1, { verdict: "changes", findings: [{ severity: "huge", issue: "x" }] }), /severity/);
  assert.throws(() => st.recordReview(root, 1, { verdict: "changes", findings: [{ severity: "major", issue: "" }] }), /issue/);
  assert.throws(() => st.recordReview(root, 1, { verdict: "changes", findings: [{ severity: "major", issue: "x", line: 0 }] }), /line/);
  const f = [{ severity: "major", issue: "missing edge case", file: "slug.js", line: 3 }];
  assert.equal(st.recordReview(root, 1, { verdict: "changes", findings: f }).capped, false);
  st.recordReview(root, 1, { verdict: "changes", note: "still wrong" });
  assert.equal(st.recordReview(root, 1, { verdict: "changes", note: "and again" }).capped, true);
  assert.throws(() => st.done(root, 1), /latest review asked for changes/);
  assert.throws(() => st.rule(root, 1, { kind: "accept", reason: " " }), /needs a reason/);
  st.rule(root, 1, { kind: "accept", reason: "remaining findings are style only" });
  st.done(root, 1);
});

test("defer closes a task without evidence and is reported as deferred", () => {
  const root = project();
  st.start(root, PLAN);
  st.rule(root, 1, { kind: "defer", reason: "blocked on API access" });
  assert.equal(st.loadState(root).tasks[0].status, "deferred");
  assert.deepEqual(st.readyTasks(st.loadState(root)).map((t) => t.id), [2], "a deferred dependency no longer blocks");
});

test("finish needs every task closed and a passing final run", () => {
  const root = project();
  st.start(root, PLAN);
  assert.throws(() => st.finish(root, { cmd: "x", exit: 0 }), /unfinished task/);
  st.rule(root, 1, { kind: "defer", reason: "r" });
  st.rule(root, 2, { kind: "defer", reason: "r" });
  assert.equal(st.finish(root, { cmd: "x", exit: 1 }).ok, false);
  assert.equal(st.loadState(root).finished, null, "a failed final run does not finish the work");
  assert.equal(st.finish(root, { cmd: "x", exit: 0 }).ok, true);
});

test("sync keeps progress, adds new tasks, and drift is detected", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 1, "fail", 1);
  assert.equal(st.planDrift(root, st.loadState(root)), false);
  const file = path.join(root, PLAN);
  fs.appendFileSync(file, "\n## Task 3: Docs\nCovers: R1\nRisk: low\nTest-first: no - docs\nDone when: x\nVerify: node check.cjs\n");
  assert.equal(st.planDrift(root, st.loadState(root)), true);
  const { state: s, changes } = st.sync(root);
  assert.deepEqual(changes, ['added Task 3 "Docs"']);
  assert.equal(s.tasks.length, 3);
  assert.equal(s.tasks[0].runs.length, 1, "existing evidence is kept");
  assert.equal(st.planDrift(root, s), false);
});

test("quick tasks use the same evidence rules", () => {
  const root = project();
  assert.throws(() => st.quick(root, "  "), /describe the change/);
  const s = st.quick(root, "fix typo in error message");
  assert.equal(s.tasks[0].status, "active");
  assert.equal(s.tasks[0].testFirst, true, "quick tasks are test-first by default");
  assert.equal(s.tasks[0].risk, "low");
  assert.throws(() => st.done(root, 1), /no check recorded/);
  run(root, 1, "pass", 0);
  assert.throws(() => st.done(root, 1), /no failing run/);
  run(root, 1, "fail", 1);
  run(root, 1, "pass", 0);
  st.done(root, 1);
  assert.throws(() => st.quick(root, "another"), /already in progress/, "an unfinished quick task blocks a new one");
  assert.equal(st.finish(root, { cmd: "node check.cjs", exit: 0 }).ok, true);
  assert.equal(st.quick(root, "another").plan.title, "another");
});

test("unknown tasks and corrupt state give clear errors", () => {
  const root = project();
  st.start(root, PLAN);
  assert.throws(() => st.done(root, 9), /no Task 9/);
  fs.writeFileSync(path.join(root, ".superpowers", "state.json"), "{oops");
  assert.throws(() => st.loadState(root), /not valid JSON/);
});

test("plan helper sanity: fixture plan is valid", () => {
  assert.match(plan(), /Task 2: Trimming/);
});

test("a task cannot close before the tasks it depends on", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 2, "fail", 1);
  run(root, 2, "pass", 0);
  assert.throws(() => st.done(root, 2), /depends on unfinished task\(s\): 1/);
});

test("--match: a red run only counts when the output names the expected failure", () => {
  const root = project();
  st.start(root, PLAN);
  const typo = st.recordRun(root, 1, { cmd: "x", expect: "fail", exit: 1, output: "SyntaxError: Unexpected token", match: "slugify trims" });
  assert.equal(typo.run.ok, false);
  assert.equal(typo.run.matched, false);
  const real = st.recordRun(root, 1, { cmd: "x", expect: "fail", exit: 1, output: "not ok 3 - slugify trims hyphens", match: "slugify trims" });
  assert.equal(real.run.ok, true);
  assert.match(real.run.tail, /slugify trims hyphens/);
});

test("high-risk tasks need approval from someone other than the author", () => {
  const root = project({ tasks: "## Task 1: Auth\nCovers: R1, R2\nRisk: high\nDone when: x\nVerify: node check.cjs\n" });
  st.start(root, PLAN);
  run(root, 1, "fail", 1);
  run(root, 1, "pass", 0);
  st.recordReview(root, 1, { verdict: "approve" });
  assert.throws(() => st.done(root, 1), /high risk, so its approval must come from someone other than the author/);
  assert.throws(() => st.recordReview(root, 1, { verdict: "approve", by: "robot" }), /--by/);
  st.recordReview(root, 1, { verdict: "approve", by: "agent" });
  st.done(root, 1);
});
