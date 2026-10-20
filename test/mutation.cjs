"use strict";
// Mutation check: disable each enforcement rule in turn and confirm the test
// suite notices. Run with `npm run mutation`. All mutations happen in a
// temporary copy of the repository, so the real source is never modified, even
// if this script is killed.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SRC = path.join(__dirname, "..");
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "sp-mutation-"));
for (const entry of ["lib", "scripts", "hooks", "skills", "test", "package.json", ".claude-plugin"]) {
  fs.cpSync(path.join(SRC, entry), path.join(ROOT, entry), { recursive: true });
}
process.on("exit", () => fs.rmSync(ROOT, { recursive: true, force: true }));
const MUTATIONS = [
  ["lib/state.cjs", "if (!greenAfter)", "if (false)", "test-first evidence required"],
  ["lib/state.cjs", "else if (!lastIsGreen) out.push", "else if (false) out.push", "latest run must pass"],
  ["lib/state.cjs", "const needsReview = t.risk !== \"low\";", "const needsReview = false;", "review required for normal/high risk"],
  ["lib/state.cjs", "else if (t.risk === \"high\" && lastReview.by === \"self\")", "else if (false)", "high risk needs an independent reviewer"],
  ["lib/state.cjs", "if (review.verdict === \"approve\" && findings.some((f) => f.severity !== \"minor\"))", "if (false)", "approve cannot carry blockers"],
  ["lib/state.cjs", "if (!last || last.verdict !== \"changes\" || t.reviews.length < rules.maxReviewRounds)", "if (false)", "accept only at the review cap"],
  ["lib/state.cjs", "if (t.risk === \"high\") throw new SpError(`Task ${t.id} is high risk: only the user", "if (false) throw new SpError(`Task ${t.id} is high risk: only the user", "high-risk accept needs the user"],
  ["lib/state.cjs", "const capped = review.verdict === \"changes\" && entry.round >= rules.maxReviewRounds;", "const capped = false;", "review round cap"],
  ["lib/state.cjs", "if (plan.status !== \"approved\")\n      throw new SpError(\"the plan is not approved yet.", "if (false)\n      throw new SpError(\"the plan is not approved yet.", "only approved plans start"],
  ["lib/state.cjs", "if (!opts.force)\n    throw new SpError(`${what} is already in progress", "if (false)\n    throw new SpError(`${what} is already in progress", "one piece of work at a time"],
  ["lib/state.cjs", "archive(root, existing, String(opts.reason).trim());", "", "forced replacement is archived"],
  ["lib/state.cjs", "if (unmet.length)", "if (false)", "dependencies close first"],
  ["lib/state.cjs", "if (weakening.length && !reason)", "if (false)", "weakening sync needs a reason"],
  ["lib/state.cjs", "if (plan.status !== \"approved\") throw new SpError(\"the edited plan is not approved", "if (false) throw new SpError(\"the edited plan is not approved", "sync needs approval"],
  ["lib/state.cjs", "if (planDrift(root, state))\n    throw", "if (false)\n    throw", "no closing while the plan drifted"],
  ["lib/state.cjs", "if (state && state.rules) for", "if (false) for", "rules are fixed at start"],
  ["lib/state.cjs", "if (run.match && !matched) ok = false;", "", "--match must be found"],
  ["lib/state.cjs", "const failed = exit !== 0 && exit !== null;", "const failed = exit !== 0;", "a timeout is not a red run"],
  ["lib/state.cjs", "fd = fs.openSync(lock, \"wx\");", "fd = fs.openSync(lock, \"w\");", "ledger locking"],
  ["lib/state.cjs", "return Boolean(m) && !pidAlive(Number(m[1]));", "return false;", "crashed holders' locks are taken over"],
  ["lib/state.cjs", "if (ruling.kind === \"accept\" && t.reviews.length === 0)", "if (false)", "accepting needs a review round"],
  ["lib/state.cjs", "note(`changed Task ${n} Verify from", "if (false) note(`changed Task ${n} Verify from", "Verify changes are recorded and gated"],
  ["lib/state.cjs", "if (missing.length) {\n          merged.status = \"active\";", "if (false) {\n          merged.status = \"active\";", "stricter plans reopen closed tasks"],
  ["lib/runner.cjs", "const exit = code !== null ? code : signal && os.constants.signals[signal] ? 128 + os.constants.signals[signal] : 1;", "const exit = code;", "signal crashes count as failures"],
  ["lib/runner.cjs", "    finished = true;\n    killTree();", "    finished = true;", "leftover processes are killed"],
  ["lib/state.cjs", "if (state.plan.spec && state.plan.specSha) return", "if (false) return", "spec edits count as drift"],
  ["lib/state.cjs", "if (changes.length || reason) state.history.push", "if (changes.length) state.history.push", "sync reasons are recorded"],
  ["lib/state.cjs", "t.refusals = (t.refusals || 0) + 1;", "", "refused closes are counted"],
  ["lib/docs.cjs", "if (!covered.has(r.id)) errors.push", "if (false) errors.push", "every requirement covered by a task"],
  ["lib/docs.cjs", "if (!proven.has(r.id)) errors.push", "if (false) errors.push", "every requirement has an acceptance check"],
  ["lib/docs.cjs", "for (const m of plan.malformed)", "for (const m of [])", "unreadable task headings are errors"],
  ["lib/docs.cjs", "if (!inFenceBefore) {", "if (true) {", "headings in code fences ignored"],
  ["lib/hooks.cjs", "if (!input || input.stop_hook_active === true) return null;", "if (!input) return null;", "stop hook loop guard"],
  ["lib/hooks.cjs", "if (isLedgerSegment(segs[0]))", "if (false)", "ledger edit protection"],
  ["lib/hooks.cjs", "seg.split(\":\")[0].replace(/[. ]+$/, \"\").toLowerCase() === st.DIR", "seg === st.DIR", "ledger protection ignores case, trailing dots and streams"],
  ["lib/hooks.cjs", "if (state && !state.finished) return null;", "return null;", "edit gate when enforce is on"],
  ["lib/hooks.cjs", "const root = st.findRoot(path.dirname(abs)) || st.findRoot(cwd);", "const root = st.findRoot(cwd);", "gate finds the file's own project"],
];

function runSuite() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "test", "run.cjs")], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const m = (r.stdout || "").match(/^# fail (\d+)/m);
  return { code: r.status, failed: m ? Number(m[1]) : null };
}

const originals = new Map();
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(130));

const base = runSuite();
if (base.code !== 0) {
  console.error("the test suite must pass before mutation testing");
  process.exit(2);
}

let survived = 0;
for (const [rel, find, replace, name] of MUTATIONS) {
  const file = path.join(ROOT, rel);
  const text = originals.get(file) ?? fs.readFileSync(file, "utf8");
  originals.set(file, text);
  const count = text.split(find).length - 1;
  if (count !== 1) {
    console.log(`?? ${name}: pattern found ${count} times in ${rel}; update test/mutation.cjs`);
    survived++;
    continue;
  }
  fs.writeFileSync(file, text.replace(find, replace));
  try {
    const r = runSuite();
    const caught = r.code !== 0;
    if (!caught) survived++;
    console.log(`${caught ? "caught  " : "SURVIVED"} ${name}${caught ? ` (${r.failed} failing test(s))` : ""}`);
  } finally {
    fs.writeFileSync(file, text);
  }
}
console.log(`\n${MUTATIONS.length - survived}/${MUTATIONS.length} mutations caught`);
process.exitCode = survived ? 1 : 0;
