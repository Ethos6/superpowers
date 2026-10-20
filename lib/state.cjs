"use strict";
// Project config and the task ledger. Everything lives in <root>/.superpowers/.
// The ledger is JSON so a resumed or compacted session can recover exactly where
// work stands, and so the rules for finishing a task are enforced by code.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { checkPlan } = require("./docs.cjs");

const DIR = ".superpowers";
const DEFAULT_CONFIG = Object.freeze({ version: 1, enforce: "off", tdd: true, maxReviewRounds: 3, docsDir: "docs" });
const RULE_KEYS = ["tdd", "maxReviewRounds"];
const ENFORCE = ["off", "on"];
const RISK_ORDER = { low: 0, normal: 1, high: 2 };
const VERDICTS = ["approve", "changes"];
const SEVERITIES = ["blocker", "major", "minor"];
const REVIEWERS = ["self", "agent", "user"];

class SpError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** Walk up from `start` to the nearest directory containing .superpowers/config.json. */
function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    try {
      if (fs.statSync(path.join(dir, DIR, "config.json")).isFile()) return dir;
    } catch {
      /* keep walking */
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new SpError(`${file} is not valid JSON (${e.message}); fix or delete it`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Locking: every read-modify-write of the ledger happens under an exclusive
// lock file, so parallel `sp` runs (for example sub-agents) cannot lose updates.
// ---------------------------------------------------------------------------

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) {
  Atomics.wait(sleepBuf, 0, 0, ms);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists, but owned by someone else
  }
}

/** A lock is stale when its holder process is gone, or it is older than 30 seconds. */
function lockIsStale(lock) {
  try {
    const st = fs.statSync(lock);
    if (Date.now() - st.mtimeMs > 30000) return true;
    // A lock that was just created may not have its owner written yet: only a
    // complete "<pid> <token>" whose process is gone counts as abandoned.
    const m = fs.readFileSync(lock, "utf8").match(/^(\d+) [0-9a-f]+$/);
    return Boolean(m) && !pidAlive(Number(m[1]));
  } catch {
    return false; // vanished or unreadable mid-write: just retry
  }
}

const RETRY = new Set(["EEXIST", "EPERM", "EACCES", "EBUSY"]);

function withLock(root, fn) {
  const lock = path.join(root, DIR, "lock");
  const token = `${process.pid} ${crypto.randomBytes(8).toString("hex")}`;
  const deadline = Date.now() + 20000;
  let fd = null;
  for (let attempt = 0; fd === null; attempt++) {
    try {
      fd = fs.openSync(lock, "wx");
      fs.writeSync(fd, token);
    } catch (e) {
      if (!RETRY.has(e.code)) throw new SpError(`cannot create lock ${lock}: ${e.code || e.message}`, 2);
      if (e.code === "EEXIST" && lockIsStale(lock)) {
        // Take over by renaming first: only one waiter's rename can succeed.
        const aside = `${lock}.stale.${crypto.randomBytes(4).toString("hex")}`;
        try {
          fs.renameSync(lock, aside);
          fs.rmSync(aside, { force: true });
          continue;
        } catch {
          /* someone else took it over; retry */
        }
      }
      if (Date.now() > deadline) throw new SpError(`the ledger is locked by another sp process (${lock}); try again`, 2);
      sleep(Math.min(5 + attempt * 5, 50));
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    try {
      // Only remove the lock if it is still ours.
      if (fs.readFileSync(lock, "utf8") === token) fs.rmSync(lock, { force: true });
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function normalizeConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) };
  if (!ENFORCE.includes(cfg.enforce)) cfg.enforce = "off";
  if (typeof cfg.tdd !== "boolean") cfg.tdd = DEFAULT_CONFIG.tdd;
  if (!Number.isInteger(cfg.maxReviewRounds) || cfg.maxReviewRounds < 1) cfg.maxReviewRounds = DEFAULT_CONFIG.maxReviewRounds;
  if (typeof cfg.docsDir !== "string" || !cfg.docsDir) cfg.docsDir = DEFAULT_CONFIG.docsDir;
  return cfg;
}

function loadConfig(root) {
  return normalizeConfig(readJson(path.join(root, DIR, "config.json"), {}));
}

/** Create .superpowers/ with a config and make git ignore it. Idempotent. */
function init(root, opts = {}) {
  const dir = path.join(root, DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.statSync(dir).isDirectory()) throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
  } catch (e) {
    throw new SpError(`cannot create ${dir}: ${e.code || e.message}`, 2);
  }
  const cfgFile = path.join(dir, "config.json");
  const cfg = normalizeConfig(readJson(cfgFile, {}));
  if (opts.enforce !== undefined) {
    if (!ENFORCE.includes(opts.enforce)) throw new SpError(`--enforce must be one of ${ENFORCE.join(", ")}`, 2);
    cfg.enforce = opts.enforce;
  }
  writeJson(cfgFile, cfg);
  // The ledger is working state, not project history: keep it out of git.
  fs.writeFileSync(path.join(dir, ".gitignore"), "*\n");
  return cfg;
}

function setConfig(root, key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key) || key === "version") throw new SpError(`unknown config key ${key}`, 2);
  return withLock(root, () => {
    const file = path.join(root, DIR, "config.json");
    const raw = normalizeConfig(readJson(file, {}));
    const old = raw[key];
    raw[key] = value;
    writeJson(file, raw);
    log(root, { event: "config", key, from: old, to: value });
    return raw;
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function statePath(root) {
  return path.join(root, DIR, "state.json");
}

function validState(s) {
  return (
    s &&
    typeof s === "object" &&
    s.plan &&
    typeof s.plan === "object" &&
    Array.isArray(s.tasks) &&
    s.tasks.every((t) => t && typeof t === "object" && Number.isInteger(t.id) && Array.isArray(t.runs) && Array.isArray(t.reviews) && Array.isArray(t.depends))
  );
}

function loadState(root) {
  const s = readJson(statePath(root), null);
  if (s === null) return null;
  if (!validState(s)) throw new SpError(`${statePath(root)} is not a valid ledger; restore it from .superpowers/abandoned/ or delete it`);
  return s;
}

function saveState(root, state) {
  writeJson(statePath(root), state);
}

function log(root, event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  fs.mkdirSync(path.join(root, DIR), { recursive: true });
  fs.appendFileSync(path.join(root, DIR, "log.jsonl"), line);
}

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function rel(root, p) {
  return path.relative(root, p).split(path.sep).join("/");
}

/** The rules a plan runs under, fixed when it starts so they cannot be relaxed midway. */
function rulesOf(root, state) {
  const base = loadConfig(root);
  if (state && state.rules) for (const k of RULE_KEYS) if (k in state.rules) base[k] = state.rules[k];
  return base;
}

function taskFromPlan(t) {
  return {
    id: t.number,
    title: t.title,
    status: "pending",
    risk: t.risk,
    testFirst: t.testFirst,
    testFirstReason: t.testFirstReason || null,
    depends: t.depends,
    covers: t.covers || [],
    verify: t.verify,
    runs: [],
    reviews: [],
    ruling: null,
  };
}

/** Load and check a plan file; throws with every problem listed if it is not usable. */
function loadPlan(root, planFile) {
  const abs = path.resolve(root, planFile);
  let text;
  try {
    if (!fs.statSync(abs).isFile()) throw new SpError(`plan ${planFile} is not a file`, 2);
    text = fs.readFileSync(abs, "utf8");
  } catch (e) {
    if (e instanceof SpError) throw e;
    throw new SpError(`plan ${planFile} cannot be read (${e.code || e.message})`, 2);
  }
  const res = checkPlan(text, { planPath: abs, root });
  return { abs, text, ...res };
}

/** Move unfinished work aside (never delete evidence) before it is replaced. */
function archive(root, state, reason) {
  const file = path.join(root, DIR, "abandoned", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeJson(file, { abandonedBecause: reason, state });
  log(root, { event: "abandon", plan: state.plan.path || state.plan.title, reason, archived: rel(root, file) });
  return file;
}

function replaceGuard(root, existing, opts, what) {
  if (!existing || existing.finished) return;
  if (!opts.force)
    throw new SpError(`${what} is already in progress (${existing.plan.path || `quick task "${existing.plan.title}"`}). Finish it, or pass --force --reason "<why>" to set it aside`);
  if (!opts.reason || !String(opts.reason).trim()) throw new SpError("--force needs --reason \"<why the current work is being set aside>\"", 2);
  archive(root, existing, String(opts.reason).trim());
}

function start(root, planFile, opts = {}) {
  return withLock(root, () => {
    const { abs, text, plan, spec, errors } = loadPlan(root, planFile);
    if (errors.length) throw new SpError(`plan has ${errors.length} problem(s); run \`sp plan check ${rel(root, abs)}\``);
    if (plan.status !== "approved")
      throw new SpError("the plan is not approved yet. Show it to the user; after they approve, set `Status: approved` and run start again");
    const existing = loadState(root);
    if (existing && !existing.finished && existing.plan.path === rel(root, abs) && !opts.force)
      throw new SpError("this plan is already started; use `sp status`, or `sp sync` after editing the plan");
    replaceGuard(root, existing, opts, "work");
    const cfg = loadConfig(root);
    const state = {
      version: 1,
      kind: "plan",
      plan: {
        path: rel(root, abs),
        title: plan.title,
        sha: sha(text),
        spec: spec ? rel(root, spec.path) : null,
        specSha: spec ? sha(fs.readFileSync(spec.path, "utf8")) : null,
        testCommand: plan.testCommand,
      },
      rules: Object.fromEntries(RULE_KEYS.map((k) => [k, cfg[k]])),
      startedAt: new Date().toISOString(),
      tasks: plan.tasks.map(taskFromPlan),
      history: [],
      finished: null,
    };
    saveState(root, state);
    log(root, { event: "start", plan: state.plan.path, tasks: state.tasks.length, rules: state.rules });
    return state;
  });
}

/** Start a one-task "quick" ledger for small work that does not need a spec and plan. */
function quick(root, summary, opts = {}) {
  if (!summary || !summary.trim()) throw new SpError('describe the change: sp quick "<what you are changing>"', 2);
  const risk = opts.risk || "low";
  if (!(risk in RISK_ORDER)) throw new SpError("--risk must be low, normal or high", 2);
  if (opts.noTdd !== undefined && !String(opts.noTdd).trim()) throw new SpError('--no-tdd needs a reason: --no-tdd "<why a failing test first does not fit>"', 2);
  return withLock(root, () => {
    replaceGuard(root, loadState(root), opts, "work");
    const cfg = loadConfig(root);
    const testFirst = opts.noTdd === undefined;
    const task = taskFromPlan({ number: 1, title: summary.trim(), risk, testFirst, testFirstReason: testFirst ? null : String(opts.noTdd).trim(), depends: [], verify: opts.testCommand || null });
    const state = {
      version: 1,
      kind: "quick",
      plan: { path: null, title: summary.trim(), sha: null, spec: null, testCommand: opts.testCommand || null },
      rules: Object.fromEntries(RULE_KEYS.map((k) => [k, cfg[k]])),
      startedAt: new Date().toISOString(),
      tasks: [{ ...task, status: "active", startedAt: new Date().toISOString() }],
      history: [],
      finished: null,
    };
    saveState(root, state);
    log(root, { event: "quick", title: state.plan.title, risk, testFirst });
    return state;
  });
}

const hasProgress = (t) => t.runs.length > 0 || t.reviews.length > 0 || Boolean(t.ruling) || t.status === "done";

/**
 * Re-read an edited plan and merge it into the ledger. Progress is kept only for
 * tasks whose number and title are unchanged. Removing a task with progress, or
 * lowering a started task's risk or test-first requirement, needs a reason, and
 * every change is recorded for the final report.
 */
function sync(root, opts = {}) {
  return withLock(root, () => {
    const state = requireActive(root);
    if (state.kind !== "plan") throw new SpError("nothing to sync for a quick task", 2);
    const { text, plan, spec, errors } = loadPlan(root, state.plan.path);
    if (errors.length) throw new SpError(`plan has ${errors.length} problem(s); run \`sp plan check ${state.plan.path}\``);
    if (plan.status !== "approved") throw new SpError("the edited plan is not approved; get the user's approval for the change and set `Status: approved` first");
    const specSha = spec ? sha(fs.readFileSync(spec.path, "utf8")) : null;
    const rules = rulesOf(root, state);
    const old = new Map(state.tasks.map((t) => [t.id, t]));
    const changes = [];
    const weakening = [];
    const note = (text, weakens) => {
      changes.push(text);
      if (weakens) weakening.push(text);
    };
    const list = (a) => (a && a.length ? a.join(", ") : "none");
    const tasks = plan.tasks.map((pt) => {
      const fresh = taskFromPlan(pt);
      const prev = old.get(pt.number);
      old.delete(pt.number);
      if (!prev) {
        note(`added Task ${pt.number} "${pt.title}"`, false);
        return fresh;
      }
      const n = pt.number;
      if (prev.title !== pt.title) {
        if (hasProgress(prev)) {
          note(`replaced Task ${n} "${prev.title}" (its recorded progress is discarded) with "${pt.title}"`, true);
          return fresh;
        }
        note(`renamed Task ${n} "${prev.title}" to "${pt.title}"`, false);
      }
      // Every rule-relevant field change is recorded; anything that makes a task easier to close needs a reason.
      if (pt.risk !== prev.risk) note(`changed Task ${n} risk from ${prev.risk} to ${pt.risk}`, RISK_ORDER[pt.risk] < RISK_ORDER[prev.risk]);
      if (pt.testFirst !== prev.testFirst)
        note(pt.testFirst ? `turned on test-first for Task ${n}` : `turned off test-first for Task ${n} (${pt.testFirstReason})`, !pt.testFirst);
      if ((pt.verify || null) !== (prev.verify || null)) note(`changed Task ${n} Verify from \`${prev.verify || "-"}\` to \`${pt.verify || "-"}\``, true);
      if (list(pt.depends) !== list(prev.depends)) note(`changed Task ${n} dependencies from ${list(prev.depends)} to ${list(pt.depends)}`, prev.depends.some((d) => !pt.depends.includes(d)));
      if (prev.covers && list(pt.covers) !== list(prev.covers)) note(`changed Task ${n} covered requirements from ${list(prev.covers)} to ${list(pt.covers)}`, false);
      if (prev.title !== pt.title) return { ...fresh, status: prev.status, startedAt: prev.startedAt };
      const merged = { ...fresh, status: prev.status, startedAt: prev.startedAt, runs: prev.runs, reviews: prev.reviews, ruling: prev.ruling, doneAt: prev.doneAt };
      // A closed task that no longer meets the (stricter) rules is reopened.
      if (merged.status === "done") {
        const missing = doneBlockers(merged, rules);
        if (missing.length) {
          merged.status = "active";
          merged.doneAt = undefined;
          note(`reopened Task ${n}: under the edited plan it still needs: ${missing.join("; ")}`, false);
        }
      }
      return merged;
    });
    for (const prev of old.values()) note(`removed Task ${prev.id} "${prev.title}"${hasProgress(prev) ? " (it had recorded progress)" : ""}`, true);
    if ((spec ? rel(root, spec.path) : null) !== state.plan.spec) note(`linked spec changed from ${state.plan.spec || "none"} to ${spec ? rel(root, spec.path) : "none"}`, false);
    else if (specSha !== (state.plan.specSha || null)) note(`spec ${state.plan.spec} was edited`, false);
    if (!changes.length && sha(text) !== state.plan.sha) note("plan text edited (no task rules changed)", false);
    const reason = opts.reason ? String(opts.reason).trim() : "";
    if (weakening.length && !reason)
      throw new SpError(
        `this edit weakens or discards recorded work:\n- ${weakening.join("\n- ")}\n` +
          'Confirm it is what the user agreed to, then run `sp sync --reason "<why>"`. It will appear in the final report.',
      );
    state.tasks = tasks;
    state.plan.sha = sha(text);
    state.plan.title = plan.title;
    state.plan.testCommand = plan.testCommand;
    state.plan.spec = spec ? rel(root, spec.path) : null;
    state.plan.specSha = specSha;
    if (!Array.isArray(state.history)) state.history = [];
    if (changes.length || reason) state.history.push({ ts: new Date().toISOString(), event: "sync", changes, reason: reason || null });
    saveState(root, state);
    log(root, { event: "sync", changes, reason: reason || null });
    return { state, changes };
  });
}

function requireActive(root) {
  const state = loadState(root);
  if (!state || state.finished) throw new SpError("no work in progress; run `sp start <plan>` or `sp quick \"<summary>\"`", 2);
  return state;
}

function getTask(state, id) {
  const s = String(id).trim().replace(/^task/i, "");
  if (!/^\d+$/.test(s)) throw new SpError(`"${id}" is not a task number`, 2);
  const n = Number(s);
  const t = state.tasks.find((x) => x.id === n);
  if (!t) throw new SpError(`no Task ${n} in ${state.plan.path || "this quick task"}`, 2);
  return t;
}

const isClosed = (t) => t.status === "done" || t.status === "deferred";

function readyTasks(state) {
  const closed = new Set(state.tasks.filter(isClosed).map((t) => t.id));
  return state.tasks.filter((t) => !isClosed(t) && t.depends.every((d) => closed.has(d)));
}

/** Pick the next task (an active one first), mark it active, and return it. */
function next(root, opts = {}) {
  const pick = (state) => {
    const ready = readyTasks(state);
    return ready.find((x) => x.status === "active") || ready[0] || null;
  };
  if (opts.peek) {
    const state = requireActive(root);
    return { state, task: pick(state) };
  }
  return withLock(root, () => {
    const state = requireActive(root);
    const t = pick(state);
    if (t && t.status !== "active") {
      t.status = "active";
      t.startedAt = new Date().toISOString();
      saveState(root, state);
      log(root, { event: "task-start", task: t.id });
    }
    return { state, task: t };
  });
}

/** True when the plan (or its spec) changed since it was started or last synced. */
function planDrift(root, state) {
  if (state.kind !== "plan" || !state.plan.path) return false;
  try {
    if (sha(fs.readFileSync(path.resolve(root, state.plan.path), "utf8")) !== state.plan.sha) return true;
    if (state.plan.spec && state.plan.specSha) return sha(fs.readFileSync(path.resolve(root, state.plan.spec), "utf8")) !== state.plan.specSha;
    return false;
  } catch {
    return true;
  }
}

function refuseOnDrift(root, state, action) {
  if (planDrift(root, state))
    throw new SpError(`the plan or its spec changed (or is missing) since it was started; run \`sp sync\` before ${action} so the ledger matches them`);
}

/** Record a check run for a task. `expect` is "fail" (red) or "pass" (green). */
function recordRun(root, id, run) {
  if (!["fail", "pass"].includes(run.expect)) throw new SpError("--expect must be fail or pass", 2);
  return withLock(root, () => {
    const state = requireActive(root);
    const t = getTask(state, id);
    if (isClosed(t)) throw new SpError(`Task ${t.id} is already ${t.status}`, 2);
    const exit = run.exit === undefined ? null : run.exit;
    const failed = exit !== 0 && exit !== null;
    let ok = run.expect === "pass" ? exit === 0 : failed;
    // --match: the run only counts if its output contains the given text, such as
    // the new test's name, so an unrelated failure is not taken as the red run.
    const matched = run.match ? String(run.output || "").includes(run.match) : null;
    if (run.match && !matched) ok = false;
    const entry = {
      ts: new Date().toISOString(),
      cmd: run.cmd,
      expect: run.expect,
      exit,
      ok,
      match: run.match || null,
      matched,
      tail: run.output ? String(run.output).slice(-1200) : null,
    };
    t.runs.push(entry);
    if (t.status === "pending") {
      t.status = "active";
      t.startedAt = entry.ts;
    }
    saveState(root, state);
    log(root, { event: "run", task: t.id, expect: entry.expect, exit: entry.exit, ok: entry.ok, cmd: entry.cmd });
    return { task: t, run: entry };
  });
}

function validateFindings(findings) {
  if (!Array.isArray(findings)) throw new SpError("findings must be a JSON array", 2);
  findings.forEach((f, i) => {
    if (!f || typeof f !== "object") throw new SpError(`finding ${i + 1} must be an object`, 2);
    if (!SEVERITIES.includes(f.severity)) throw new SpError(`finding ${i + 1}: severity must be ${SEVERITIES.join(", ")}`, 2);
    if (typeof f.issue !== "string" || !f.issue.trim()) throw new SpError(`finding ${i + 1}: issue must be a non-empty string`, 2);
    if (f.file !== undefined && typeof f.file !== "string") throw new SpError(`finding ${i + 1}: file must be a string`, 2);
    if (f.line !== undefined && (!Number.isInteger(f.line) || f.line < 1)) throw new SpError(`finding ${i + 1}: line must be a positive integer`, 2);
  });
  return findings;
}

function recordReview(root, id, review) {
  if (!VERDICTS.includes(review.verdict)) throw new SpError(`--verdict must be ${VERDICTS.join(" or ")}`, 2);
  const by = review.by === undefined ? "self" : review.by;
  if (!REVIEWERS.includes(by)) throw new SpError(`--by must be ${REVIEWERS.join(", ")}`, 2);
  const findings = validateFindings(review.findings || []);
  if (review.verdict === "approve" && findings.some((f) => f.severity !== "minor"))
    throw new SpError("an approval cannot include blocker or major findings; record `changes` instead", 2);
  if (review.verdict === "changes" && findings.length === 0 && !(review.note || "").trim())
    throw new SpError("a `changes` verdict needs findings or a --note saying what to change", 2);
  return withLock(root, () => {
    const state = requireActive(root);
    const rules = rulesOf(root, state);
    const t = getTask(state, id);
    if (isClosed(t)) throw new SpError(`Task ${t.id} is already ${t.status}`, 2);
    const entry = { ts: new Date().toISOString(), round: t.reviews.length + 1, verdict: review.verdict, by, findings, note: review.note || null };
    t.reviews.push(entry);
    saveState(root, state);
    log(root, { event: "review", task: t.id, round: entry.round, verdict: entry.verdict, by, findings: findings.length });
    const capped = review.verdict === "changes" && entry.round >= rules.maxReviewRounds;
    return { task: t, review: entry, capped, maxRounds: rules.maxReviewRounds };
  });
}

/**
 * A ruling ends a task's review loop.
 * - defer: close the task unfinished, with a reason (shown in the report).
 * - accept: accept the work despite open review findings. On its own authority
 *   the agent may accept only after the review-round cap is reached; otherwise,
 *   and always for high-risk tasks, the acceptance must come from the user.
 */
function rule(root, id, ruling) {
  if (!["accept", "defer"].includes(ruling.kind)) throw new SpError('use --accept "<reason>" or --defer "<reason>"', 2);
  if (!ruling.reason || !String(ruling.reason).trim()) throw new SpError("a ruling needs a reason", 2);
  const by = ruling.by === undefined ? "self" : ruling.by;
  if (!["self", "user"].includes(by)) throw new SpError("--by must be self or user for a ruling", 2);
  return withLock(root, () => {
    const state = requireActive(root);
    const rules = rulesOf(root, state);
    const t = getTask(state, id);
    if (isClosed(t)) throw new SpError(`Task ${t.id} is already ${t.status}`, 2);
    if (ruling.kind === "accept" && t.reviews.length === 0)
      throw new SpError(`Task ${t.id} has no review yet; accepting over review findings needs at least one recorded review round`);
    if (ruling.kind === "accept" && by === "self") {
      const last = t.reviews[t.reviews.length - 1];
      if (t.risk === "high") throw new SpError(`Task ${t.id} is high risk: only the user can accept it over review findings (\`--by user\`, after they agree)`);
      if (!last || last.verdict !== "changes" || t.reviews.length < rules.maxReviewRounds)
        throw new SpError(
          `accepting over review findings is for when the review loop has hit its limit (${rules.maxReviewRounds} rounds); ` +
            "until then, fix the findings or answer them in the next review round. If the user agrees to accept now, record it with --by user",
        );
    }
    t.ruling = { ts: new Date().toISOString(), kind: ruling.kind, by, reason: String(ruling.reason).trim() };
    if (ruling.kind === "defer") {
      t.status = "deferred";
      t.doneAt = t.ruling.ts;
    }
    saveState(root, state);
    log(root, { event: "rule", task: t.id, kind: ruling.kind, by });
    return t;
  });
}

/** Why a task cannot be closed yet. Empty array means it can. */
function doneBlockers(t, rules) {
  const out = [];
  const last = t.runs[t.runs.length - 1];
  const lastIsGreen = Boolean(last && last.expect === "pass" && last.ok);
  const cmdHint = t.verify ? "" : " -- <command>";
  if (!last) out.push(`no check recorded; run \`sp test ${t.id} --expect pass${cmdHint}\``);
  else if (!lastIsGreen) out.push(`the latest recorded run is not a passing check; run \`sp test ${t.id} --expect pass${cmdHint}\` after your last change`);
  if (rules.tdd && t.testFirst) {
    // Evidence of test-first: a failing run (a red run, or a pass-expected run that
    // failed) followed later by a passing run.
    const isRed = (r) => (r.expect === "fail" && r.ok) || (r.expect === "pass" && !r.ok && r.exit !== null && r.exit !== 0 && r.matched !== false);
    const firstRed = t.runs.findIndex(isRed);
    const greenAfter = firstRed !== -1 && t.runs.slice(firstRed + 1).some((r) => r.expect === "pass" && r.ok);
    if (!greenAfter)
      out.push(
        "no failing run was recorded before a passing one, so there is no evidence the test was written first. " +
          `Record one with \`sp test ${t.id} --expect fail${cmdHint}\` while the new test fails, then make it pass. ` +
          "If this task truly cannot be test-first, that is a plan change: agree it with the user, mark the task `Test-first: no - <reason>`, and `sp sync --reason`",
      );
  }
  const needsReview = t.risk !== "low";
  const accepted = t.ruling && t.ruling.kind === "accept";
  if (needsReview && !accepted) {
    const lastReview = t.reviews[t.reviews.length - 1];
    if (!lastReview) out.push(`Task ${t.id} is ${t.risk} risk and has no review; record one with \`sp review ${t.id} --verdict ...\``);
    else if (lastReview.verdict !== "approve") out.push("the latest review asked for changes; fix them and record a new review round");
    else if (t.risk === "high" && lastReview.by === "self")
      out.push(`Task ${t.id} is high risk, so its approval must come from someone other than the author: a sub-agent reviewer (\`--by agent\`) or the user (\`--by user\`)`);
  }
  return out;
}

function done(root, id) {
  return withLock(root, () => {
    const state = requireActive(root);
    refuseOnDrift(root, state, "closing tasks");
    const rules = rulesOf(root, state);
    const t = getTask(state, id);
    if (isClosed(t)) throw new SpError(`Task ${t.id} is already ${t.status}`, 2);
    const unmet = t.depends.filter((d) => !isClosed(getTask(state, d)));
    if (unmet.length) throw new SpError(`Task ${t.id} depends on unfinished task(s): ${unmet.join(", ")}`);
    const blockers = doneBlockers(t, rules);
    if (blockers.length) {
      t.refusals = (t.refusals || 0) + 1;
      saveState(root, state);
      log(root, { event: "done-refused", task: t.id, reasons: blockers.length });
      throw new SpError(`Task ${t.id} cannot be marked done yet:\n- ${blockers.join("\n- ")}`);
    }
    t.status = "done";
    t.doneAt = new Date().toISOString();
    saveState(root, state);
    log(root, { event: "done", task: t.id });
    return t;
  });
}

/** Check that the work can be finished (before running the final command). */
function finishPreflight(root) {
  const state = requireActive(root);
  refuseOnDrift(root, state, "finishing");
  const open = state.tasks.filter((t) => !isClosed(t));
  if (open.length) throw new SpError(`unfinished task(s): ${open.map((t) => t.id).join(", ")}; close or defer them first`);
  return state;
}

/** Close the whole plan after a passing full-suite run. */
function finish(root, run) {
  return withLock(root, () => {
    const state = finishPreflight(root);
    const entry = {
      ts: new Date().toISOString(),
      cmd: run.cmd,
      exit: run.exit,
      ok: run.exit === 0,
      planCommand: state.plan.testCommand || null,
      overridden: Boolean(state.plan.testCommand && run.cmd !== state.plan.testCommand),
    };
    if (!entry.ok) {
      log(root, { event: "finish-failed", exit: run.exit, cmd: run.cmd });
      return { state, run: entry, ok: false };
    }
    state.finished = entry;
    saveState(root, state);
    log(root, { event: "finish", cmd: run.cmd, overridden: entry.overridden });
    return { state, run: entry, ok: true };
  });
}

function durationMs(t) {
  if (!t.startedAt) return null;
  const end = t.doneAt ? new Date(t.doneAt) : new Date();
  return end - new Date(t.startedAt);
}

module.exports = {
  DIR,
  DEFAULT_CONFIG,
  RULE_KEYS,
  SpError,
  findRoot,
  init,
  loadConfig,
  setConfig,
  rulesOf,
  loadState,
  saveState,
  loadPlan,
  start,
  quick,
  sync,
  next,
  readyTasks,
  recordRun,
  recordReview,
  rule,
  doneBlockers,
  done,
  finishPreflight,
  finish,
  planDrift,
  isClosed,
  getTask,
  durationMs,
  withLock,
  rel,
};
