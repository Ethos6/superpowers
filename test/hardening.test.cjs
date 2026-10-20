"use strict";
// Regression tests for problems found in pre-publication review.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const st = require("../lib/state.cjs");
const docs = require("../lib/docs.cjs");
const hooks = require("../lib/hooks.cjs");
const runner = require("../lib/runner.cjs");
const { project, tmpdir, setOk } = require("./helpers.cjs");

const PLAN = "docs/plans/slug.md";
const SP = path.join(__dirname, "..", "scripts", "sp.cjs");
const run = (root, id, expect, exit) => st.recordRun(root, id, { cmd: "node check.cjs", expect, exit });
const sp = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [SP, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const HIGH = "## Task 1: Auth\nCovers: R1, R2\nRisk: high\nDone when: x\nVerify: node check.cjs\n";

// --- rulings ---------------------------------------------------------------

test("accepting over findings needs the review cap, or the user", () => {
  const root = project();
  st.start(root, PLAN);
  assert.throws(() => st.rule(root, 1, { kind: "accept", reason: "looks fine" }), /no review yet/);
  assert.throws(() => st.rule(root, 1, { kind: "accept", reason: "user ok", by: "user" }), /no review yet/, "even the user's acceptance needs a review round");
  st.recordReview(root, 1, { verdict: "changes", note: "x" });
  assert.throws(() => st.rule(root, 1, { kind: "accept", reason: "r" }), /hit its limit/, "one round is not the cap");
  st.rule(root, 1, { kind: "accept", reason: "user said the naming is fine", by: "user" });
  assert.throws(() => st.rule(root, 2, { kind: "accept", reason: "r", by: "agent" }), /--by must be self or user/);
});

test("a high-risk task can only be accepted over findings by the user", () => {
  const root = project({ tasks: HIGH });
  fs.writeFileSync(path.join(root, ".superpowers", "config.json"), JSON.stringify({ ...st.loadConfig(root), maxReviewRounds: 1 }));
  st.start(root, PLAN);
  st.recordReview(root, 1, { verdict: "changes", note: "x" });
  assert.throws(() => st.rule(root, 1, { kind: "accept", reason: "r" }), /only the user can accept/);
  st.rule(root, 1, { kind: "accept", reason: "user accepted the residual risk", by: "user" });
});

test("approvals cannot carry blocker or major findings", () => {
  const root = project();
  st.start(root, PLAN);
  assert.throws(() => st.recordReview(root, 1, { verdict: "approve", findings: [{ severity: "blocker", issue: "sql injection" }] }), /cannot include blocker or major/);
  assert.throws(() => st.recordReview(root, 1, { verdict: "approve", findings: [{ severity: "major", issue: "x" }] }), /cannot include/);
  st.recordReview(root, 1, { verdict: "approve", findings: [{ severity: "minor", issue: "naming" }] });
});

// --- sync ------------------------------------------------------------------

test("sync needs an approved plan, and weakening recorded work needs a reason", () => {
  const root = project({ tasks: HIGH });
  st.start(root, PLAN);
  run(root, 1, "fail", 1);
  const file = path.join(root, PLAN);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.replace("Status: approved", "Status: draft"));
  assert.throws(() => st.sync(root), /not approved/);
  fs.writeFileSync(file, text.replace("Risk: high", "Risk: low"));
  assert.throws(() => st.sync(root), /changed Task 1 risk from high to low[\s\S]*--reason/);
  assert.throws(() => st.done(root, 1), /run `sp sync`/, "no closing while the plan and ledger disagree");
  const { changes } = st.sync(root, { reason: "user reclassified: internal tool" });
  assert.match(changes[0], /changed Task 1 risk from high to low/);
  assert.equal(st.loadState(root).history[0].reason, "user reclassified: internal tool");
});

test("sync does not carry progress over to a different task with the same number", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 1, "fail", 1);
  run(root, 1, "pass", 0);
  const file = path.join(root, PLAN);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("## Task 1: Core slugify", "## Task 1: Something else"));
  assert.throws(() => st.sync(root), /progress is discarded/);
  const { state } = st.sync(root, { reason: "rescoped with the user" });
  assert.equal(state.tasks[0].runs.length, 0);
  assert.equal(state.tasks[0].title, "Something else");
});

test("removing a task with progress needs a reason; finish refuses while the plan has drifted", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 2, "fail", 1);
  const file = path.join(root, PLAN);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, text.slice(0, text.indexOf("## Task 2")).replace("Covers: R1", "Covers: R1, R2"));
  assert.throws(() => st.sync(root), /removed Task 2 "Trimming" \(it had recorded progress\)/);
  st.rule(root, 1, { kind: "defer", reason: "r" });
  st.rule(root, 2, { kind: "defer", reason: "r" });
  assert.throws(() => st.finishPreflight(root), /run `sp sync`/);
});

// --- rules fixed at start ----------------------------------------------------

test("relaxing config mid-plan does not relax the plan's rules", () => {
  const root = project();
  st.start(root, PLAN);
  st.setConfig(root, "tdd", false);
  run(root, 1, "pass", 0);
  st.recordReview(root, 1, { verdict: "approve" });
  assert.throws(() => st.done(root, 1), /no failing run/);
  const logText = fs.readFileSync(path.join(root, ".superpowers", "log.jsonl"), "utf8");
  assert.match(logText, /"event":"config","key":"tdd","from":true,"to":false/);
  assert.throws(() => st.setConfig(root, "constructor", 1), /unknown config key/);
  assert.equal(sp(root, "config", "toString").code, 2);
});

// --- ids, state shape, odd inputs --------------------------------------------

test("task ids are whole numbers only", () => {
  const root = project();
  const state = st.start(root, PLAN);
  assert.equal(st.getTask(state, "task1").id, 1);
  assert.equal(st.getTask(state, "01").id, 1);
  for (const bad of ["1.5", "-1", "x", ""]) assert.throws(() => st.getTask(state, bad), /not a task number/);
  assert.throws(() => st.getTask(state, "7"), /no Task 7/);
});

test("a malformed ledger is reported, not crashed on", () => {
  const root = project();
  st.start(root, PLAN);
  for (const bad of ["{}", '{"plan":{},"tasks":[{}]}', "[]", "null"]) {
    fs.writeFileSync(path.join(root, ".superpowers", "state.json"), bad);
    for (const args of [["status"], ["done", "1"], ["finish"], ["next"]]) {
      const r = sp(root, ...args);
      assert.notEqual(r.code, 3, `${bad} ${args}: ${r.err}`);
      assert.doesNotMatch(r.err, /internal error/);
    }
  }
});

test("odd CLI inputs are usage errors, not crashes", () => {
  const root = project();
  fs.mkdirSync(path.join(root, "adir"));
  assert.equal(sp(root, "start", "adir").code, 2);
  assert.equal(sp(root, "plan", "check", "adir").code, 2);
  assert.equal(sp(root, "review", "1", "--by=", "--verdict", "approve").code, 2);
  assert.equal(sp(root, "test", "1", "--expect", "pass", "--timeout=").code, 2);
  assert.equal(sp(root, "status", "--", "x").code, 2);
  assert.equal(sp(root, "test", "1", "--expect", "pass", "--").code, 2);
  const file = tmpdir();
  fs.writeFileSync(path.join(file, ".superpowers"), "not a dir");
  assert.equal(sp(file, "init").code, 2);
  // plan file moved away after start: brief and done explain instead of crashing
  sp(root, "start", PLAN);
  fs.renameSync(path.join(root, PLAN), path.join(root, "moved.md"));
  const next = sp(root, "next");
  assert.equal(next.code, 0);
  assert.match(next.out, /plan file .* is missing/);
  assert.equal(sp(root, "done", "1").code, 1);
});

test("quick task options: risk, opting out of test-first needs a reason", () => {
  const root = project();
  assert.throws(() => st.quick(root, "x", { risk: "extreme" }), /--risk/);
  assert.equal(sp(root, "quick", "x", "--no-tdd=").code, 2);
  const s = st.quick(root, "rename config key", { noTdd: "pure config", risk: "normal" });
  assert.equal(s.tasks[0].testFirst, false);
  assert.equal(s.tasks[0].testFirstReason, "pure config");
  assert.equal(s.tasks[0].risk, "normal");
});

test("report names are unique per finish", () => {
  const root = project();
  setOk(root, true);
  for (let i = 0; i < 2; i++) {
    sp(root, "quick", "fix typo", "--no-tdd", "text only");
    sp(root, "test", "1", "--expect", "pass", "--", "node", "check.cjs");
    sp(root, "done", "1");
    assert.equal(sp(root, "finish").code, 0);
  }
  assert.equal(fs.readdirSync(path.join(root, ".superpowers", "reports")).length, 2);
});

test("sp show gives any task's brief without changing state", () => {
  const root = project();
  st.start(root, PLAN);
  const before = fs.readFileSync(path.join(root, ".superpowers", "state.json"), "utf8");
  const r = sp(root, "show", "2");
  assert.equal(r.code, 0);
  assert.match(r.out, /Task 2: Trimming/);
  assert.match(r.out, /R2: Trim/);
  assert.equal(fs.readFileSync(path.join(root, ".superpowers", "state.json"), "utf8"), before);
});

// --- parsing -----------------------------------------------------------------

test("unreadable task headings are errors, not silently dropped", () => {
  const p = docs.parsePlan("# Plan: x\n## Task 1: A\n## Task 2 Migrate data\n## Task 3:\n### task 4 - fine\n");
  assert.deepEqual(p.tasks.map((t) => t.number), [1, 4]);
  assert.deepEqual(p.malformed.map((m) => m.line), [3, 4]);
});

test("plan check reports unreadable task headings", () => {
  const root = tmpdir();
  const res = docs.checkPlan("# Plan: x\nSpec: none - test\nStatus: draft\n## Task 1: A\nCovers: none - x\nDone when: x\nVerify: y\n## Task 2 Migrate data\n", { root });
  assert.match(res.errors.join("\n"), /line 8 looks like a task heading but cannot be read: "## Task 2 Migrate data"/);
});

test("Depends accepts 'Task 1' and ignores words", () => {
  assert.deepEqual(docs.parsePlan("# Plan: x\n## Task 1: A\n## Task 2: B\nDepends: Task 1\n").tasks[1].depends, [1]);
});

test("pathological headings parse in linear time", () => {
  const t0 = Date.now();
  docs.parsePlan("## Task 1:" + " ".repeat(30000) + "x" + " ".repeat(30000) + "#\n");
  docs.parseSpec("## " + " ".repeat(60000) + "x\n## Requirements" + " ".repeat(60000) + "\n");
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

// --- concurrency -------------------------------------------------------------

test("concurrent writers do not lose ledger updates", async () => {
  const root = project();
  st.start(root, PLAN);
  const P = 6;
  const M = 25;
  const lib = JSON.stringify(path.join(__dirname, "..", "lib", "state.cjs"));
  const code = `const st = require(${lib}); for (let i = 0; i < ${M}; i++) st.recordRun(process.argv[1], 1, { cmd: "x", expect: "pass", exit: 0 });`;
  await Promise.all(
    Array.from(
      { length: P },
      () =>
        new Promise((resolve) => {
          const c = spawn(process.execPath, ["-e", code, root], { stdio: "ignore" });
          c.on("exit", resolve);
        }),
    ),
  );
  assert.equal(st.loadState(root).tasks[0].runs.length, P * M);
});

test("parallel sp runs do not lose updates", async () => {
  const root = project();
  st.start(root, PLAN);
  setOk(root, true);
  const N = 12;
  await Promise.all(
    Array.from(
      { length: N },
      () =>
        new Promise((resolve) => {
          const c = spawn(process.execPath, [SP, "test", "1", "--expect", "pass"], { cwd: root, stdio: "ignore" });
          c.on("exit", resolve);
        }),
    ),
  );
  assert.equal(st.loadState(root).tasks[0].runs.length, N);
});

// --- runner ------------------------------------------------------------------

test("argument quoting keeps spaces and quotes intact", () => {
  const root = project();
  sp(root, "start", PLAN);
  const r = sp(root, "test", "1", "--expect", "pass", "--", process.execPath, "-e", "console.log('a b \"c\"')");
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /a b "c"/);
  assert.equal(runner.joinArgs(["npm test"], true), "npm test", "a single argument is a full command line");
  assert.equal(runner.joinArgs(["echo", "it's"], "/bin/bash", "linux"), "echo 'it'\\''s'");
  assert.equal(runner.joinArgs(["echo", "a b"], true, "win32"), 'echo "a b"');
});

test("the Windows shell choice prefers Git Bash and skips the WSL launcher", () => {
  const dir = tmpdir();
  const sys = path.join(dir, "System32");
  const git = path.join(dir, "Git", "bin");
  fs.mkdirSync(sys, { recursive: true });
  fs.mkdirSync(git, { recursive: true });
  fs.writeFileSync(path.join(sys, "bash.exe"), "");
  fs.writeFileSync(path.join(git, "bash.exe"), "");
  assert.equal(runner.pickShell({ PATH: `${sys};${git}` }, "win32"), path.join(git, "bash.exe"));
  assert.equal(runner.pickShell({ PATH: sys }, "win32"), true);
  assert.equal(runner.pickShell({ SP_SHELL: "pwsh" }, "win32"), "pwsh");
  assert.equal(runner.pickShell({}, "linux"), true);
});

test("a timeout kills the whole process tree", { skip: process.platform === "win32" && "uses POSIX process groups" }, () => {
  const dir = tmpdir();
  const marker = path.join(dir, "child-alive");
  const script = `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "x"), 2500)`;
  const res = runner.run(`${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)} & wait`, dir, 1);
  assert.equal(res.timedOut, true);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
  assert.equal(fs.existsSync(marker), false, "the grandchild was left running");
});

// --- hooks -------------------------------------------------------------------

test("ledger protection survives case, trailing dots and symlinks", (t) => {
  const root = project();
  const edit = (file, cwd = root) => hooks.editDecision({ tool_name: "Edit", cwd, tool_input: { file_path: file } });
  for (const f of [".SUPERPOWERS/state.json", ".Superpowers/config.json", ".superpowers./state.json", ".superpowers /state.json"])
    assert.equal(edit(path.join(root, f))?.decision, "deny", f);
  const link = path.join(tmpdir(), "link");
  try {
    fs.symlinkSync(root, link, "dir");
  } catch (e) {
    if (process.platform === "win32") return t.skip(`symlinks unavailable (${e.code})`);
    throw e;
  }
  assert.equal(edit(path.join(link, ".superpowers", "state.json"))?.decision, "deny", "via a symlink to the project");
});

test("the gate uses the project that contains the file (monorepos)", () => {
  const mono = tmpdir();
  const pkg = path.join(mono, "packages", "x");
  fs.mkdirSync(pkg, { recursive: true });
  st.init(pkg, { enforce: "on" });
  const d = hooks.editDecision({ tool_name: "Write", cwd: mono, tool_input: { file_path: path.join(pkg, "src", "a.js") } });
  assert.equal(d?.decision, "deny");
  assert.equal(hooks.editDecision({ tool_name: "Write", cwd: mono, tool_input: { file_path: path.join(pkg, ".superpowers", "state.json") } })?.decision, "deny");
});

test("with enforce on, .txt build files are code, not docs", () => {
  const root = project({ enforce: "on" });
  const edit = (f) => hooks.editDecision({ tool_name: "Edit", cwd: root, tool_input: { file_path: path.join(root, f) } });
  assert.equal(edit("CMakeLists.txt")?.decision, "deny");
  assert.equal(edit("requirements.txt")?.decision, "deny");
  assert.equal(edit("notes.md"), null);
});

test("stop and refusal messages give a runnable command for quick tasks", () => {
  const root = project({ enforce: "on" });
  st.quick(root, "fix");
  assert.match(hooks.stopDecision({ cwd: root }).reason, /sp test 1 --expect pass -- <command>/);
});

// --- second review round ---------------------------------------------------

test("sync records and gates weakening of tasks that have not started", () => {
  const root = project();
  st.start(root, PLAN);
  const file = path.join(root, PLAN);
  const text = fs.readFileSync(file, "utf8");
  const t2 = text.slice(text.indexOf("## Task 2"));
  const weaker = t2.replace("Verify: node check.cjs", "Verify: true").replace("Risk: low", "Risk: low\nTest-first: no - trivial");
  fs.writeFileSync(file, text.replace(t2, weaker));
  assert.throws(() => st.sync(root), /turned off test-first for Task 2[\s\S]*changed Task 2 Verify from `node check\.cjs` to `true`/);
  const { changes } = st.sync(root, { reason: "user agreed: trivial" });
  assert.equal(changes.length, 2);
  assert.equal(st.loadState(root).history[0].reason, "user agreed: trivial");
});

test("making a closed task stricter reopens it", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 1, "fail", 1);
  run(root, 1, "pass", 0);
  st.recordReview(root, 1, { verdict: "approve" });
  st.done(root, 1);
  const file = path.join(root, PLAN);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Risk: normal", "Risk: high"));
  const { state, changes } = st.sync(root);
  assert.equal(state.tasks[0].status, "active");
  assert.match(changes.join("\n"), /changed Task 1 risk from normal to high[\s\S]*reopened Task 1: .*high risk/);
});

test("a crashed holder's lock is taken over at once; a live holder's lock is respected", () => {
  const root = project();
  st.start(root, PLAN);
  const lock = path.join(root, ".superpowers", "lock");
  fs.writeFileSync(lock, "999999999 deadbeef"); // no such process
  const t0 = Date.now();
  run(root, 1, "fail", 1);
  assert.ok(Date.now() - t0 < 2000, "stale lock taken over quickly");
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, `${process.pid} someone-else`); // alive holder (this process), fresh
  const res = spawnSync(process.execPath, [SP, "status"], { cwd: root, encoding: "utf8" });
  assert.equal(res.status, 0, "reads do not need the lock");
  fs.rmSync(lock);
});

test("a command killed by a signal counts as a failing run", { skip: process.platform === "win32" && "POSIX signals" }, () => {
  const res = runner.run("kill -SEGV $$", tmpdir());
  assert.equal(res.exit, 139);
  assert.equal(res.signal, "SIGSEGV");
});

test("background processes left by a command do not keep sp waiting", { skip: process.platform === "win32" && "POSIX process groups" }, () => {
  const t0 = Date.now();
  const res = runner.run("sleep 5 & true", tmpdir());
  assert.equal(res.exit, 0);
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
});

test("interrupting a run kills its command", { skip: process.platform !== "linux" && "uses /proc" }, async () => {
  const dir = tmpdir();
  const marker = path.join(dir, "survived");
  const script = `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "x"), 1500)`;
  const cmd = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
  const outer = spawn(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "..", "lib", "runner.cjs"))}).run(${JSON.stringify(cmd)}, ${JSON.stringify(dir)})`], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 500));
  const kids = spawnSync("pgrep", ["-P", String(outer.pid)], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  for (const k of kids) process.kill(Number(k), "SIGTERM");
  await new Promise((r) => setTimeout(r, 2000));
  outer.kill("SIGKILL");
  assert.equal(fs.existsSync(marker), false, "the command kept running after sp was interrupted");
});

test("sp show rejects extra arguments and omits evidence hints for closed tasks", () => {
  const root = project();
  st.start(root, PLAN);
  assert.equal(sp(root, "show", "1", "2").code, 2);
  st.rule(root, 2, { kind: "defer", reason: "later" });
  assert.doesNotMatch(sp(root, "show", "2").out, /Record evidence/);
  assert.match(sp(root, "show", "1").out, /Record evidence/);
});

test("ledger protection is limited to the project's own ledger folder", () => {
  const root = project();
  const edit = (f) => hooks.editDecision({ tool_name: "Edit", cwd: root, tool_input: { file_path: path.join(root, f) } });
  assert.equal(edit("src/.superpowers/fixture.json"), null, "a fixture folder deeper in the tree is ordinary code");
  assert.equal(edit(".superpowers::$INDEX_ALLOCATION/state.json")?.decision, "deny", "NTFS stream names");
});

test("the docs folder check follows the file system's case rules", () => {
  const root = project({ enforce: "on" });
  const d = hooks.editDecision({ tool_name: "Edit", cwd: root, tool_input: { file_path: path.join(root, "DOCS", "evil.js") } });
  if (process.platform === "linux") assert.equal(d?.decision, "deny");
  else assert.equal(d, null);
});

// --- second trial ------------------------------------------------------------

test("editing the spec blocks closing until sync, and is recorded with its reason", () => {
  const root = project();
  st.start(root, PLAN);
  run(root, 2, "fail", 1);
  run(root, 2, "pass", 0);
  const spec = path.join(root, "docs", "specs", "slug.md");
  fs.writeFileSync(spec, fs.readFileSync(spec, "utf8").replace("Trim leading and trailing hyphens.", "Trim leading and trailing hyphens and dots."));
  assert.equal(st.planDrift(root, st.loadState(root)), true);
  assert.throws(() => st.done(root, 2), /plan or its spec changed/);
  const { changes } = st.sync(root, { reason: "user widened R2 after review" });
  assert.deepEqual(changes, ["spec docs/specs/slug.md was edited"]);
  assert.equal(st.loadState(root).history[0].reason, "user widened R2 after review");
});

test("a sync reason is kept even when no task changed", () => {
  const root = project();
  st.start(root, PLAN);
  fs.appendFileSync(path.join(root, PLAN), "\nA note for builders.\n");
  const { changes } = st.sync(root, { reason: "clarified context" });
  assert.deepEqual(changes, ["plan text edited (no task rules changed)"]);
  assert.equal(st.loadState(root).history.length, 1);
  const again = st.sync(root, { reason: "user re-confirmed the plan" });
  assert.deepEqual(again.changes, []);
  assert.equal(st.loadState(root).history.length, 2, "a reason with no edits is still recorded");
  assert.equal(st.loadState(root).history[1].reason, "user re-confirmed the plan");
});

test("the report shows refused closes and how each red run failed", () => {
  const root = project();
  sp(root, "start", PLAN);
  fs.writeFileSync(path.join(root, "red.cjs"), 'console.log("not ok 1 - trims hyphens"); console.log("expected x got --x--"); process.exit(1);\n');
  sp(root, "test", "1", "--expect", "fail", "--", "node", "red.cjs");
  setOk(root, true);
  sp(root, "test", "1", "--expect", "pass");
  assert.equal(sp(root, "done", "1").code, 1);
  sp(root, "review", "1", "--verdict", "approve");
  assert.equal(sp(root, "done", "1").code, 0);
  sp(root, "rule", "2", "--defer", "later");
  const fin = sp(root, "finish");
  const report = fs.readFileSync(path.join(root, fin.out.match(/Report: (.*)/)[1].trim()), "utf8");
  assert.match(report, /\| Refused closes \|/);
  assert.match(report, /\| 1\. Core slugify \| done \|.*\| 1 \| \d+s \|/);
  assert.match(report, /```text\n  not ok 1 - trims hyphens\n  expected x got --x--\n  ```/);
});

test("sp help <command> shows just that command", () => {
  const d = tmpdir();
  const r = sp(d, "help", "review");
  assert.equal(r.code, 0);
  assert.match(r.out, /^sp review <task> --verdict/);
  assert.doesNotMatch(r.out, /sp finish/);
  assert.match(sp(d, "help", "test").out, /with --match the run counts only/);
  assert.equal(sp(d, "help", "nope").code, 2);
});
