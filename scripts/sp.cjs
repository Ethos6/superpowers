#!/usr/bin/env node
"use strict";
// sp - the superpowers command line. Zero dependencies; Node 18+.
// Exit codes: 0 ok, 1 a rule was not met (check failed, task cannot close),
// 2 usage error, 3 internal error.

const fs = require("node:fs");
const path = require("node:path");
const docs = require("../lib/docs.cjs");
const st = require("../lib/state.cjs");
const runner = require("../lib/runner.cjs");
const { SpError } = st;

const VERSION = require("../package.json").version;

const HELP = `sp ${VERSION} - evidence-backed workflow for coding agents

Setup
  sp init [--enforce on|off]        create .superpowers/ in the current directory
  sp config [key] [value]           show or set config (enforce, tdd, maxReviewRounds, docsDir)

Documents
  sp spec check <file> [--json]     check a spec: goal, R-numbered requirements, acceptance checks
  sp plan check <file> [--json]     check a plan and its traceability to the spec

Work
  sp start <plan> [--force --reason "<why>"]
                                    start an approved plan (--force sets current work aside, archived)
  sp quick "<summary>" [--test-cmd "<cmd>"] [--risk low|normal|high] [--no-tdd "<reason>"] [--force --reason "<why>"]
                                    start a one-task ledger for a small change
  sp next [--peek] [--json]         show the next task's brief and mark it active
  sp show <task> [--json]           show any task's brief and evidence without changing anything
  sp ready [--json]                 list every task whose dependencies are closed
  sp test <task> --expect fail|pass [--match "<text>"] [--tail <lines>] [--timeout <sec>] [-- <command>]
                                    run a check and record the result (default: the task's Verify);
                                    with --match the run counts only if its output contains <text>
  sp review <task> --verdict approve|changes [--by self|agent|user] [--note "<text>"] [--findings <file.json>]
  sp rule <task> --accept "<reason>" | --defer "<reason>" [--by self|user]
  sp done <task>                    close a task; refused without the required evidence
  sp sync [--reason "<why>"]        re-read the approved plan after editing it, keeping progress
  sp status [--json]                where the work stands
  sp finish [-- <command>]          run the full test command and write the final report

Exit codes: 0 ok, 1 rule not met, 2 usage error, 3 internal error.`;

const VALUE = new Set(["enforce", "expect", "verdict", "note", "findings", "accept", "defer", "timeout", "test-cmd", "match", "tail", "by", "reason", "risk", "no-tdd"]);
const FLAG = new Set(["force", "json", "peek", "help", "version"]);

function parse(argv) {
  const dash = argv.indexOf("--");
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const tail = dash === -1 ? null : argv.slice(dash + 1);
  const pos = [];
  const opts = {};
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a === "-h") {
      opts.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (VALUE.has(name)) {
      const v = eq !== -1 ? a.slice(eq + 1) : head[++i];
      if (v === undefined || (eq === -1 && v.startsWith("--")) || v === "") throw new SpError(`--${name} needs a value`, 2);
      opts[name] = v;
    } else if (FLAG.has(name) && eq === -1) opts[name] = true;
    else throw new SpError(`unknown option ${a}`, 2);
  }
  if (tail && tail.length === 0) throw new SpError("nothing after --; give the command to run", 2);
  return { pos, opts, tail };
}

function root(required = true) {
  const r = st.findRoot(process.cwd());
  if (!r && required) throw new SpError("no .superpowers/ found here or above; run `sp init` in the project root", 2);
  return r;
}

function showOutput(output, tail, err) {
  if (!output) return;
  let text = output.replace(/\s+$/, "");
  if (tail) {
    const lines = text.split(/\r?\n/);
    if (lines.length > tail) text = `... (${lines.length - tail} earlier lines omitted)\n` + lines.slice(-tail).join("\n");
  }
  err(text);
}

function fmtDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

function printChecks(kind, file, res, out) {
  for (const e of res.errors) out(`  x ${e}`);
  for (const w of res.warnings) out(`  ! ${w}`);
  if (res.errors.length) out(`${kind} ${file}: ${res.errors.length} problem(s)`);
  else out(`${kind} ${file}: OK${res.warnings.length ? ` (${res.warnings.length} warning(s))` : ""}`);
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function brief(r, state, task) {
  const L = [];
  const where = state.kind === "quick" ? "quick task" : state.plan.path;
  const cmdHint = task.verify ? "" : " -- <command>";
  L.push(`Task ${task.id}: ${task.title}`);
  L.push(`(${where}; status ${task.status}; risk ${task.risk}; ${task.testFirst ? "test-first" : `test-first not required: ${task.testFirstReason || "-"}`})`);
  if (state.kind === "plan") {
    const text = readText(path.resolve(r, state.plan.path));
    if (text === null) L.push("", `! the plan file ${state.plan.path} is missing; restore it, or run \`sp sync\` after moving it back`);
    else {
      const pt = docs.parsePlan(text).tasks.find((t) => t.number === task.id);
      if (pt) L.push("", pt.text);
      const specText = state.plan.spec ? readText(path.resolve(r, state.plan.spec)) : null;
      if (specText && pt && pt.covers && pt.covers.length) {
        const spec = docs.parseSpec(specText);
        const reqs = spec.requirements.filter((x) => pt.covers.includes(x.id));
        const acc = spec.acceptance.filter((a) => a.covers.some((c) => pt.covers.includes(c)));
        L.push("", `Requirements (from ${state.plan.spec}):`, ...reqs.map((x) => `- ${x.id}: ${x.text}`));
        if (acc.length) L.push("Acceptance checks:", ...acc.map((a) => `- ${a.id} (${a.covers.join(", ")}): ${a.text}`));
      }
    }
  }
  if (task.runs.length || task.reviews.length) {
    L.push("", "Evidence so far:");
    for (const run of task.runs) L.push(`- run (expect ${run.expect}) \`${run.cmd}\` exited ${run.exit}: ${run.ok ? "counts" : "does not count"}`);
    for (const rv of task.reviews) L.push(`- review round ${rv.round}: ${rv.verdict} by ${rv.by || "self"}${rv.findings.length ? `, ${rv.findings.length} finding(s)` : ""}`);
  }
  if (st.isClosed(task)) {
    L.push("", `This task is ${task.status}${task.ruling ? ` (${task.ruling.kind}: ${task.ruling.reason})` : ""}.`);
    return L.join("\n");
  }
  L.push("", "Record evidence as you go:");
  if (task.testFirst) L.push(`  sp test ${task.id} --expect fail --match "<new test name>"${cmdHint}   # while the new test fails`);
  L.push(`  sp test ${task.id} --expect pass${cmdHint}   # after the change${task.verify ? ` (runs: ${task.verify})` : ""}`);
  if (task.risk === "high") L.push(`  sp review ${task.id} --findings <reviewer.json> --by agent   # high risk: not a self-review`);
  else if (task.risk !== "low") L.push(`  sp review ${task.id} --verdict approve|changes [--by agent]`);
  L.push(`  sp done ${task.id}`);
  return L.join("\n");
}

function statusLines(r, state) {
  const rules = st.rulesOf(r, state);
  const L = [];
  const closed = state.tasks.filter(st.isClosed).length;
  L.push(state.kind === "quick" ? `Quick task: ${state.plan.title}` : `Plan: ${state.plan.path} (${state.plan.title})`);
  L.push(`${closed}/${state.tasks.length} tasks closed${state.finished ? "; finished" : ""}. enforce=${rules.enforce}, tdd=${rules.tdd}, review rounds=${rules.maxReviewRounds}`);
  if (st.planDrift(r, state)) L.push("! the plan or its spec changed (or is missing) since it was started; run `sp sync` before closing tasks");
  L.push("");
  L.push("  #  status    risk    runs  reviews  time  title");
  for (const t of state.tasks) {
    const last = t.runs[t.runs.length - 1];
    const runMark = last ? `${t.runs.length}${last.ok ? "" : "!"}` : "0";
    L.push(
      `${String(t.id).padStart(3)}  ${String(t.status).padEnd(8)}  ${String(t.risk).padEnd(6)}  ${runMark.padEnd(4)}  ${String(t.reviews.length).padEnd(7)}  ${fmtDuration(st.durationMs(t)).padEnd(4)}  ${t.title}`,
    );
  }
  if (!state.finished) {
    const ready = st.readyTasks(state);
    const active = ready.find((t) => t.status === "active");
    if (active) {
      const b = st.doneBlockers(active, rules);
      L.push("", `In progress: Task ${active.id}. ${b.length ? `Still needed before \`sp done ${active.id}\`:\n- ${b.join("\n- ")}` : `Ready to close: \`sp done ${active.id}\``}`);
    } else if (ready.length) L.push("", `Next: Task ${ready[0].id} - run \`sp next\``);
    else if (state.tasks.every(st.isClosed)) L.push("", "All tasks closed - run `sp finish`");
  }
  return L;
}

/** A code fence longer than any backtick run inside the text. */
function fence(text) {
  const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map((m) => m.length));
  return "`".repeat(longest + 1);
}

const cell = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

function reportMarkdown(state) {
  const L = [];
  const f = state.finished;
  L.push(`# Report: ${cell(state.plan.title)}`, "");
  if (state.plan.path) L.push(`- Plan: \`${state.plan.path}\``);
  if (state.plan.spec) L.push(`- Spec: \`${state.plan.spec}\``);
  if (state.rules) L.push(`- Rules: test-first ${state.rules.tdd ? "required" : "off for this plan"}, review rounds ${state.rules.maxReviewRounds}`);
  L.push(`- Started: ${state.startedAt}`, `- Finished: ${f.ts}`);
  L.push(`- Final check: \`${f.cmd}\` exited ${f.exit}${f.overridden ? ` (**overrides** the plan's test command \`${f.planCommand}\`)` : ""}`, "");

  const deferred = state.tasks.filter((t) => t.status === "deferred");
  if (deferred.length) L.push(`**${deferred.length} task(s) deferred, not done:** ${deferred.map((t) => `Task ${t.id} (${cell(t.ruling && t.ruling.reason)})`).join("; ")}`, "");

  L.push("| Task | Status | Risk | Test-first | Red/green | Reviews | Ruling | Refused closes | Time |", "|---|---|---|---|---|---|---|---|---|");
  for (const t of state.tasks) {
    const red = t.runs.filter((x) => x.expect === "fail" && x.ok).length;
    const green = t.runs.filter((x) => x.expect === "pass" && x.ok).length;
    const reviews = t.reviews.length ? t.reviews.map((rv) => `${rv.verdict}/${rv.by || "self"}`).join(", ") : "-";
    const ruling = t.ruling ? `${t.ruling.kind} by ${t.ruling.by || "self"}: ${cell(t.ruling.reason)}` : "-";
    const tf = t.testFirst ? "yes" : `no: ${cell(t.testFirstReason)}`;
    L.push(`| ${t.id}. ${cell(t.title)} | ${t.status} | ${t.risk} | ${tf} | ${red}/${green} of ${t.runs.length} | ${reviews} | ${ruling} | ${t.refusals || 0} | ${fmtDuration(st.durationMs(t))} |`);
  }

  L.push("", "## Recorded runs", "");
  for (const t of state.tasks) {
    for (const run of t.runs) {
      const custom = t.verify && run.cmd !== t.verify ? " (not the task's Verify command)" : "";
      const match = run.match ? `, match "${cell(run.match)}" ${run.matched ? "found" : "not found"}` : "";
      L.push(`- Task ${t.id}: expect ${run.expect}, \`${cell(run.cmd)}\` exited ${run.exit}${match} - ${run.ok ? "counted" : "not counted"}${custom}`);
      if (run.expect === "fail" && run.ok && run.tail) {
        // Show how the red run failed, so a reader can judge whether it failed for the right reason.
        const lines = String(run.tail).split(/\r?\n/).map((x) => x.trimEnd()).filter((x) => x.trim()).slice(-6);
        const fz = fence(lines.join("\n"));
        L.push("", `  ${fz}text`, ...lines.map((x) => `  ${x}`), `  ${fz}`, "");
      }
    }
  }

  const notes = [];
  for (const t of state.tasks) {
    for (const rv of t.reviews) {
      for (const fd of rv.findings || []) {
        const where = fd.file ? ` (${cell(fd.file)}${fd.line ? `:${fd.line}` : ""})` : "";
        notes.push(`- Task ${t.id}, round ${rv.round} (${rv.verdict}, by ${rv.by || "self"}): **${fd.severity}**${where} ${cell(fd.issue)}`);
      }
      if (rv.note) notes.push(`- Task ${t.id}, round ${rv.round} (${rv.verdict}, by ${rv.by || "self"}): note - ${cell(rv.note)}`);
    }
  }
  if (notes.length) L.push("", "## Review findings", "", ...notes);

  const hist = Array.isArray(state.history) ? state.history : [];
  if (hist.length) {
    L.push("", "## Plan changes during the work", "");
    for (const h of hist) L.push(`- ${h.ts}: ${h.changes.map(cell).join("; ")}${h.reason ? ` (reason: ${cell(h.reason)})` : ""}`);
  }
  L.push("");
  return L.join("\n");
}

function slug(s) {
  return String(s || "work").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "work";
}

function uniqueReportPath(r, state) {
  const stamp = state.finished.ts.replace(/[:]/g, "").replace(/\..*$/, "").replace("T", "-");
  const base = path.join(r, st.DIR, "reports", `${stamp}-${slug(state.plan.title)}`);
  let file = `${base}.md`;
  for (let i = 2; fs.existsSync(file); i++) file = `${base}-${i}.md`;
  return file;
}

function requireState(r) {
  const state = st.loadState(r);
  if (!state || state.finished) throw new SpError("no work in progress; run `sp start <plan>` or `sp quick \"<summary>\"`", 2);
  return state;
}

function main(argv, io = { out: (s) => process.stdout.write(s + "\n"), err: (s) => process.stderr.write(s + "\n") }) {
  const { out, err } = io;
  try {
    const { pos, opts, tail } = parse(argv);
    const [cmd, sub, ...rest] = pos;
    if (opts.version) {
      out(VERSION);
      return 0;
    }
    if (cmd === "help" && sub) {
      const lines = HELP.split("\n");
      const start = lines.findIndex((l) => l.startsWith(`  sp ${sub}`));
      if (start === -1) throw new SpError(`no command ${sub}; run \`sp help\``, 2);
      let end = start + 1;
      while (end < lines.length && /^ {10,}\S/.test(lines[end])) end++;
      out(lines.slice(start, end).join("\n").replace(/^ {2}/gm, ""));
      return 0;
    }
    if (!cmd || opts.help || cmd === "help") {
      (cmd || opts.help ? out : err)(HELP);
      return cmd || opts.help ? 0 : 2;
    }
    if (tail && !["test", "finish"].includes(cmd)) throw new SpError(`\`sp ${cmd}\` does not take a command after --`, 2);

    switch (cmd) {
      case "init": {
        const cfg = st.init(process.cwd(), { enforce: opts.enforce });
        out(`initialized ${path.join(process.cwd(), st.DIR)} (enforce=${cfg.enforce}, tdd=${cfg.tdd})`);
        return 0;
      }
      case "config": {
        const r = root();
        const cfg = st.loadConfig(r);
        if (!sub) {
          out(JSON.stringify(cfg, null, 2));
          return 0;
        }
        if (!Object.prototype.hasOwnProperty.call(st.DEFAULT_CONFIG, sub) || sub === "version") throw new SpError(`unknown config key ${sub}`, 2);
        if (rest[0] === undefined) {
          out(String(cfg[sub]));
          return 0;
        }
        let v = rest[0];
        if (sub === "tdd") {
          if (!["true", "false"].includes(v)) throw new SpError("tdd must be true or false", 2);
          v = v === "true";
        } else if (sub === "maxReviewRounds") {
          v = Number(v);
          if (!Number.isInteger(v) || v < 1) throw new SpError("maxReviewRounds must be a positive integer", 2);
        } else if (sub === "enforce" && !["on", "off"].includes(v)) throw new SpError("enforce must be on or off", 2);
        st.setConfig(r, sub, v);
        const state = st.loadState(r);
        const note = state && !state.finished && st.RULE_KEYS.includes(sub) ? " (the work in progress keeps the rules it started with)" : "";
        out(`${sub} = ${JSON.stringify(v)}${note}`);
        return 0;
      }
      case "spec":
      case "plan": {
        if (sub !== "check" || !rest[0] || rest.length > 1) throw new SpError(`usage: sp ${cmd} check <file>`, 2);
        const file = rest[0];
        let text;
        try {
          if (!fs.statSync(file).isFile()) throw Object.assign(new Error("not a file"), { code: "EISDIR" });
          text = fs.readFileSync(file, "utf8");
        } catch (e) {
          throw new SpError(`cannot read ${file}: ${e.code || e.message}`, 2);
        }
        const res = cmd === "spec" ? docs.checkSpec(text) : docs.checkPlan(text, { planPath: path.resolve(file), root: root(false) || process.cwd() });
        if (opts.json) out(JSON.stringify({ errors: res.errors, warnings: res.warnings }, null, 2));
        else printChecks(cmd, file, res, out);
        return res.errors.length ? 1 : 0;
      }
      case "start": {
        if (!sub || rest.length) throw new SpError("usage: sp start <plan>", 2);
        const r = root();
        const state = st.start(r, sub, { force: opts.force, reason: opts.reason });
        out(`started ${state.plan.path}: ${state.tasks.length} task(s). Run \`sp next\`.`);
        return 0;
      }
      case "quick": {
        const r = root();
        const summary = [sub, ...rest].filter(Boolean).join(" ");
        const state = st.quick(r, summary, { force: opts.force, reason: opts.reason, testCommand: opts["test-cmd"], risk: opts.risk, noTdd: opts["no-tdd"] });
        const t = state.tasks[0];
        const hint = t.verify ? "" : " -- <command>";
        out(
          `quick task started: ${state.plan.title} (risk ${t.risk}${t.testFirst ? ", test-first" : ""}). ` +
            `${t.testFirst ? `Record the failing test with \`sp test 1 --expect fail${hint}\`, then ` : ""}` +
            `a passing check with \`sp test 1 --expect pass${hint}\`, then \`sp done 1\` and \`sp finish\`.`,
        );
        return 0;
      }
      case "sync": {
        if (sub) throw new SpError("usage: sp sync [--reason \"<why>\"]", 2);
        const { state, changes } = st.sync(root(), { reason: opts.reason });
        out(`synced ${state.plan.path}: ${state.tasks.length} task(s)${changes.length ? `\n- ${changes.join("\n- ")}` : "; no task changes"}`);
        return 0;
      }
      case "next": {
        const r = root();
        const { state, task } = st.next(r, { peek: opts.peek });
        if (!task) {
          const all = state.tasks.every(st.isClosed);
          if (opts.json) out(JSON.stringify({ task: null, allClosed: all }));
          else out(all ? "All tasks are closed. Run `sp finish`." : "No task is ready; the remaining tasks wait on unfinished dependencies.");
          return 0;
        }
        if (opts.json) out(JSON.stringify({ task, brief: brief(r, state, task) }, null, 2));
        else out(brief(r, state, task));
        return 0;
      }
      case "show": {
        if (!sub || rest.length) throw new SpError("usage: sp show <task>", 2);
        const r = root();
        const state = requireState(r);
        const task = st.getTask(state, sub);
        if (opts.json) out(JSON.stringify({ task, brief: brief(r, state, task) }, null, 2));
        else out(brief(r, state, task));
        return 0;
      }
      case "ready": {
        const state = requireState(root());
        const ready = st.readyTasks(state);
        if (opts.json) out(JSON.stringify(ready.map((t) => ({ id: t.id, title: t.title, status: t.status, risk: t.risk })), null, 2));
        else out(ready.length ? ready.map((t) => `Task ${t.id}: ${t.title} (${t.status})`).join("\n") : "No task is ready.");
        return 0;
      }
      case "test": {
        if (!sub || rest.length) throw new SpError("usage: sp test <task> --expect fail|pass [-- <command>]", 2);
        if (!opts.expect) throw new SpError("--expect fail|pass is required: say whether this run should fail (red) or pass (green)", 2);
        if (!["fail", "pass"].includes(opts.expect)) throw new SpError("--expect must be fail or pass", 2);
        const timeout = opts.timeout !== undefined ? Number(opts.timeout) : undefined;
        if (opts.timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) throw new SpError("--timeout must be a positive number of seconds", 2);
        const tailN = opts.tail !== undefined ? Number(opts.tail) : undefined;
        if (opts.tail !== undefined && (!Number.isInteger(tailN) || tailN < 1)) throw new SpError("--tail must be a positive whole number of lines", 2);
        const r = root();
        const state = requireState(r);
        const task = st.getTask(state, sub);
        if (st.isClosed(task)) throw new SpError(`Task ${task.id} is already ${task.status}`, 2);
        const shell = runner.pickShell();
        const command = tail ? runner.joinArgs(tail, shell) : task.verify;
        if (!command) throw new SpError(`Task ${task.id} has no Verify command; pass one after --`, 2);
        err(`sp: running \`${command}\` (expecting it to ${opts.expect})`);
        const res = runner.run(command, r, timeout, shell);
        if (res.error) throw new SpError(`could not run \`${command}\`: ${res.error}`, 2);
        showOutput(res.output, tailN, err);
        const { run } = st.recordRun(r, task.id, { cmd: command, expect: opts.expect, exit: res.exit, output: res.output, match: opts.match });
        const what = res.timedOut ? `timed out after ${timeout}s` : `exited ${res.exit}`;
        const outcomeMatches = opts.expect === "pass" ? res.exit === 0 : res.exit !== 0 && res.exit !== null;
        if (run.ok) out(`recorded: Task ${task.id} ${opts.expect === "fail" ? "red" : "green"} - \`${command}\` ${what} as expected${run.match ? ` and its output contains "${run.match}"` : ""}`);
        else if (run.match && !run.matched && outcomeMatches) out(`recorded: Task ${task.id} - \`${command}\` ${what}, but its output does not contain "${run.match}", so it does not count`);
        else out(`recorded: Task ${task.id} - \`${command}\` ${what}, but you expected it to ${opts.expect}`);
        return run.ok ? 0 : 1;
      }
      case "review": {
        if (!sub || rest.length || (!opts.verdict && !opts.findings)) throw new SpError("usage: sp review <task> --verdict approve|changes [--by ...] [--note ...] [--findings file.json]", 2);
        let findings = [];
        let verdict = opts.verdict;
        if (opts.findings) {
          let raw;
          try {
            raw = JSON.parse(fs.readFileSync(opts.findings, "utf8").replace(/^\uFEFF/, ""));
          } catch (e) {
            throw new SpError(`cannot read findings ${opts.findings}: ${e.message}`, 2);
          }
          if (Array.isArray(raw)) findings = raw;
          else if (raw && typeof raw === "object") {
            findings = raw.findings === undefined ? [] : raw.findings;
            if (!verdict) verdict = raw.verdict;
            else if (raw.verdict && raw.verdict !== verdict) throw new SpError(`--verdict ${verdict} contradicts the file's verdict ${raw.verdict}`, 2);
          } else throw new SpError("the findings file must contain a JSON object or array", 2);
        }
        if (!verdict) throw new SpError('no verdict: pass --verdict or include "verdict" in the findings file', 2);
        const res = st.recordReview(root(), sub, { verdict, note: opts.note, findings, by: opts.by });
        out(`recorded review round ${res.review.round} for Task ${res.task.id}: ${res.review.verdict} by ${res.review.by}${findings.length ? ` (${findings.length} finding(s))` : ""}`);
        if (res.capped)
          out(
            `Round ${res.review.round} of ${res.maxRounds} asked for changes. Stop the fix loop and decide: ` +
              `\`sp rule ${res.task.id} --accept "<why the remaining findings are acceptable>"\` (high risk: the user must agree, \`--by user\`) or \`sp rule ${res.task.id} --defer "<reason>"\`, and tell the user.`,
          );
        return 0;
      }
      case "rule": {
        if (!sub || rest.length || (!opts.accept && !opts.defer) || (opts.accept && opts.defer)) throw new SpError('usage: sp rule <task> --accept "<reason>" | --defer "<reason>" [--by self|user]', 2);
        const t = st.rule(root(), sub, opts.accept ? { kind: "accept", reason: opts.accept, by: opts.by } : { kind: "defer", reason: opts.defer, by: opts.by });
        out(`Task ${t.id}: ${t.ruling.kind} by ${t.ruling.by} - ${t.ruling.reason}`);
        return 0;
      }
      case "done": {
        if (!sub || rest.length) throw new SpError("usage: sp done <task>", 2);
        const t = st.done(root(), sub);
        out(`Task ${t.id} done.`);
        return 0;
      }
      case "status": {
        const r = root();
        const state = st.loadState(r);
        if (!state) {
          out(opts.json ? JSON.stringify({ state: null }) : "No work recorded yet. Run `sp start <plan>` or `sp quick \"<summary>\"`.");
          return 0;
        }
        if (opts.json) out(JSON.stringify({ state, drift: st.planDrift(r, state), ready: st.readyTasks(state).map((t) => t.id) }, null, 2));
        else out(statusLines(r, state).join("\n"));
        return 0;
      }
      case "finish": {
        if (sub) throw new SpError("usage: sp finish [-- <command>]", 2);
        const r = root();
        const state = st.finishPreflight(r);
        const shell = runner.pickShell();
        let command = tail ? runner.joinArgs(tail, shell) : state.plan.testCommand;
        if (!command && state.kind === "quick") {
          const passes = state.tasks[0].runs.filter((x) => x.expect === "pass" && x.ok);
          if (passes.length) command = passes[passes.length - 1].cmd;
        }
        if (!command) throw new SpError("no test command; add `Test command:` to the plan or pass one after --", 2);
        err(`sp: running the full check \`${command}\``);
        const res = runner.run(command, r, undefined, shell);
        if (res.error) throw new SpError(`could not run \`${command}\`: ${res.error}`, 2);
        showOutput(res.output, 40, err);
        const fin = st.finish(r, { cmd: command, exit: res.exit });
        if (!fin.ok) {
          out(`final check failed (exit ${res.exit}); the work is not finished`);
          return 1;
        }
        const file = uniqueReportPath(r, fin.state);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, reportMarkdown(fin.state));
        const deferred = fin.state.tasks.filter((t) => t.status === "deferred").length;
        out(`finished${deferred ? ` with ${deferred} task(s) deferred, not done` : ""}${fin.run.overridden ? "; note: the final command overrode the plan's test command" : ""}. Report: ${st.rel(r, file)}`);
        return 0;
      }
      default:
        throw new SpError(`unknown command ${cmd}; run \`sp help\``, 2);
    }
  } catch (e) {
    if (e instanceof SpError) {
      err(`sp: ${e.message}`);
      return e.code;
    }
    err(`sp: internal error: ${e && e.stack ? e.stack : e}`);
    return 3;
  }
}

module.exports = { main, HELP, reportMarkdown };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
