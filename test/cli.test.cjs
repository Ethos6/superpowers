"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { project, setOk, tmpdir } = require("./helpers.cjs");

const SP = path.join(__dirname, "..", "scripts", "sp.cjs");

function sp(cwd, ...args) {
  const r = spawnSync(process.execPath, [SP, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("help, version and usage errors", () => {
  const d = tmpdir();
  assert.equal(sp(d, "--version").out.trim(), require("../package.json").version);
  assert.equal(sp(d, "help").code, 0);
  assert.equal(sp(d).code, 2);
  assert.equal(sp(d, "bogus").code, 2);
  assert.equal(sp(d, "status").code, 2, "no .superpowers/ yet");
  assert.match(sp(d, "status").err, /sp init/);
  assert.equal(sp(d, "init", "--wat").code, 2);
  assert.equal(sp(d, "init", "--enforce").code, 2);
});

test("init, config get and set with validation", () => {
  const d = tmpdir();
  assert.equal(sp(d, "init").code, 0);
  assert.equal(sp(d, "config", "enforce").out.trim(), "off");
  assert.equal(sp(d, "config", "enforce", "on").code, 0);
  assert.equal(sp(d, "config", "enforce").out.trim(), "on");
  assert.equal(sp(d, "config", "enforce", "maybe").code, 2);
  assert.equal(sp(d, "config", "tdd", "false").code, 0);
  assert.equal(JSON.parse(sp(d, "config").out).tdd, false);
  assert.equal(sp(d, "config", "maxReviewRounds", "0").code, 2);
  assert.equal(sp(d, "config", "nope", "1").code, 2);
});

test("spec and plan check exit codes and JSON output", () => {
  const root = project();
  assert.equal(sp(root, "spec", "check", "docs/specs/slug.md").code, 0);
  assert.equal(sp(root, "plan", "check", "docs/plans/slug.md").code, 0);
  fs.writeFileSync(path.join(root, "bad.md"), "# T\n");
  const r = sp(root, "spec", "check", "bad.md", "--json");
  assert.equal(r.code, 1);
  assert.ok(JSON.parse(r.out).errors.length > 0);
  assert.equal(sp(root, "spec", "check", "missing.md").code, 2);
  assert.equal(sp(root, "plan", "check").code, 2);
});

test("full workflow through the CLI, with refusals along the way", () => {
  const root = project();
  assert.equal(sp(root, "start", "docs/plans/slug.md").code, 0);
  const brief = sp(root, "next");
  assert.match(brief.out, /Task 1: Core slugify/);
  assert.match(brief.out, /R1: Lowercase/);
  assert.match(brief.out, /A1 \(R1\)/);
  assert.match(brief.out, /sp test 1 --expect fail/);

  assert.equal(sp(root, "test", "1").code, 2, "--expect is required");
  setOk(root, false);
  const red = sp(root, "test", "1", "--expect", "fail");
  assert.equal(red.code, 0);
  assert.match(red.out, /red/);
  assert.equal(sp(root, "done", "1").code, 1);

  setOk(root, true);
  assert.equal(sp(root, "test", "1", "--expect", "pass").code, 0);
  const refused = sp(root, "done", "1");
  assert.equal(refused.code, 1);
  assert.match(refused.err, /no review/);

  const findings = path.join(root, "f.json");
  fs.writeFileSync(findings, JSON.stringify({ verdict: "changes", findings: [{ severity: "major", issue: "no unicode test", fix: "add one" }], not_checked: [] }));
  assert.equal(sp(root, "review", "1", "--findings", findings).code, 0, "verdict read from the reviewer's JSON");
  assert.equal(sp(root, "review", "1", "--verdict", "approve", "--findings", findings).code, 2, "contradicting verdicts are refused");
  assert.equal(sp(root, "review", "1", "--verdict", "approve").code, 0);
  assert.equal(sp(root, "done", "1").code, 0);

  const s = JSON.parse(sp(root, "status", "--json").out);
  assert.deepEqual(s.ready, [2]);
  assert.match(sp(root, "status").out, /1\/2 tasks closed/);

  sp(root, "next");
  setOk(root, false);
  sp(root, "test", "2", "--expect", "fail");
  setOk(root, true);
  sp(root, "test", "2", "--expect", "pass", "--", "node", "check.cjs");
  assert.equal(sp(root, "done", "2").code, 0);
  assert.match(sp(root, "next").out, /All tasks are closed/);

  setOk(root, false);
  const failedFinish = sp(root, "finish");
  assert.equal(failedFinish.code, 1);
  assert.match(failedFinish.out, /not finished/);
  setOk(root, true);
  const fin = sp(root, "finish");
  assert.equal(fin.code, 0, fin.err);
  const report = fs.readFileSync(path.join(root, fin.out.match(/Report: (.*)/)[1].trim()), "utf8");
  assert.match(report, /\| 1\. Core slugify \| done \| normal \| yes \| 1\/1 of 2 \| changes\/self, approve\/self \| - \|/);
  assert.match(report, /\| 2\. Trimming \| done \| low \| yes \|/);
  assert.match(report, /## Recorded runs[\s\S]*Task 2: expect pass, `node check\.cjs` exited 0 - counted/);
});

test("test reports a mismatch with exit 1 and honours --timeout", () => {
  const root = project();
  sp(root, "start", "docs/plans/slug.md");
  setOk(root, true);
  const r = sp(root, "test", "1", "--expect", "fail");
  assert.equal(r.code, 1);
  assert.match(r.out, /but you expected it to fail/);
  const slow = sp(root, "test", "1", "--expect", "pass", "--timeout", "1", "--", process.execPath, "-e", "setTimeout(() => {}, 5000)");
  assert.equal(slow.code, 1);
  assert.match(slow.out, /timed out/);
  assert.equal(sp(root, "test", "1", "--expect", "pass", "--timeout", "abc").code, 2);
});

test("review cap message and rulings via the CLI", () => {
  const root = project();
  sp(root, "config", "maxReviewRounds", "1");
  sp(root, "start", "docs/plans/slug.md");
  assert.match(sp(root, "config", "maxReviewRounds", "5").out, /keeps the rules it started with/);
  const r = sp(root, "review", "1", "--verdict", "changes", "--note", "rename x");
  assert.match(r.out, /Stop the fix loop and decide/);
  assert.equal(sp(root, "rule", "1").code, 2);
  assert.equal(sp(root, "rule", "1", "--accept", "a", "--defer", "b").code, 2);
  assert.equal(sp(root, "rule", "1", "--defer", "waiting on design").code, 0);
  assert.match(sp(root, "status").out, /deferred/);
});

test("quick task end to end, finish reuses the passing command", () => {
  const root = project();
  setOk(root, true);
  const q = sp(root, "quick", "fix", "the", "typo");
  assert.equal(q.code, 0);
  assert.match(q.out, /risk low, test-first/);
  assert.equal(sp(root, "test", "1", "--expect", "pass").code, 2, "a quick task has no Verify command by default");
  assert.equal(sp(root, "test", "1", "--expect", "pass", "--", "node", "check.cjs").code, 0);
  const refused = sp(root, "done", "1");
  assert.equal(refused.code, 1, "quick tasks are test-first by default");
  assert.match(refused.err, /--expect fail -- <command>/);
  setOk(root, false);
  assert.equal(sp(root, "test", "1", "--expect", "fail", "--", "node", "check.cjs").code, 0);
  setOk(root, true);
  assert.equal(sp(root, "test", "1", "--expect", "pass", "--", "node", "check.cjs").code, 0);
  assert.equal(sp(root, "done", "1").code, 0);
  const fin = sp(root, "finish");
  assert.equal(fin.code, 0, fin.err);
  assert.match(fin.out, /Report: \.superpowers\/reports\/.*fix-the-typo\.md/);
});

test("sync via CLI after a plan edit, and status shows drift first", () => {
  const root = project();
  sp(root, "start", "docs/plans/slug.md");
  fs.appendFileSync(path.join(root, "docs/plans/slug.md"), "\n");
  assert.match(sp(root, "status").out, /changed \(or is missing\) since it was started/);
  assert.equal(sp(root, "sync").code, 0);
  assert.doesNotMatch(sp(root, "status").out, /changed since/);
});

test("corrupt state is a clear rule error, not a crash", () => {
  const root = project();
  sp(root, "start", "docs/plans/slug.md");
  fs.writeFileSync(path.join(root, ".superpowers", "state.json"), "{broken");
  const r = sp(root, "status");
  assert.equal(r.code, 1);
  assert.match(r.err, /not valid JSON/);
  assert.doesNotMatch(r.err, /internal error/);
});

test("test --match, --tail, review --by, and findings in the final report", () => {
  const root = project();
  sp(root, "start", "docs/plans/slug.md");
  fs.writeFileSync(path.join(root, "noisy.cjs"), 'for (let i = 0; i < 50; i++) console.log("line " + i); console.log("FAIL: trims hyphens"); process.exit(1);\n');
  const miss = sp(root, "test", "1", "--expect", "fail", "--match", "unicode", "--", "node", "noisy.cjs");
  assert.equal(miss.code, 1);
  assert.match(miss.out, /does not contain "unicode", so it does not count/);
  const hit = sp(root, "test", "1", "--expect", "fail", "--match", "trims hyphens", "--tail", "3", "--", "node", "noisy.cjs");
  assert.equal(hit.code, 0);
  assert.match(hit.err, /earlier lines omitted/);
  assert.doesNotMatch(hit.err, /line 10\b/);
  assert.equal(sp(root, "test", "1", "--expect", "fail", "--tail", "0").code, 2);
  setOk(root, true);
  sp(root, "test", "1", "--expect", "pass");
  const f = path.join(root, "f.json");
  fs.writeFileSync(f, JSON.stringify({ verdict: "approve", findings: [{ severity: "minor", issue: "rename helper", file: "slug.js", line: 4 }] }));
  const rv = sp(root, "review", "1", "--findings", f, "--by", "agent");
  assert.match(rv.out, /approve by agent \(1 finding\(s\)\)/);
  assert.equal(sp(root, "review", "1", "--verdict", "approve", "--by", "bot").code, 2);
  sp(root, "done", "1");
  sp(root, "rule", "2", "--defer", "not needed yet");
  const fin = sp(root, "finish");
  const report = fs.readFileSync(path.join(root, fin.out.match(/Report: (.*)/)[1].trim()), "utf8");
  assert.match(report, /## Review findings/);
  assert.match(report, /Task 1, round 1 \(approve, by agent\): \*\*minor\*\* \(slug\.js:4\) rename helper/);
  assert.match(report, /\*\*1 task\(s\) deferred, not done:\*\* Task 2 \(not needed yet\)/);
  assert.match(report, /defer by self: not needed yet/);
  assert.match(report, /match "trims hyphens" found - counted/);
});
