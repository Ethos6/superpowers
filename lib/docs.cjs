"use strict";
// Parsing and checking of spec and plan Markdown files. Zero dependencies.
//
// A spec lists numbered requirements (R1, R2, ...) and acceptance checks that
// say which requirements they prove (A1 (R1, R2): ...). A plan lists tasks that
// say which requirements they cover and how to verify them. Together they give
// traceability: every requirement -> at least one acceptance check and one task.

const fs = require("node:fs");
const path = require("node:path");

const RISKS = ["low", "normal", "high"];
const PLAN_STATUSES = ["draft", "approved"];
const LIMITS = {
  taskWordsWarn: 300,
  taskCodeLinesWarn: 12,
  taskCodeLinesError: 40,
};

/** Remove Markdown emphasis/backticks around a value: **x** -> x, `x` -> x. */
function clean(s) {
  return String(s ?? "")
    .trim()
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/^`(.*)`$/, "$1")
    .trim();
}

function splitLines(text) {
  return String(text).replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
}

/** Read a `Key: value` field. Accepts `Key:`, `**Key:**`, `**Key**:` and `- Key:`. */
function readField(lines, key) {
  const re = new RegExp(`^\\s*(?:[-*]\\s+)?\\*{0,2}${key.replace(/ /g, "\\s+")}\\*{0,2}\\s*:\\s*\\*{0,2}\\s*(.*)$`, "i");
  for (const line of lines) {
    const m = line.match(re);
    if (m) return clean(m[1]);
  }
  return null;
}

/** Split Markdown into `## ` sections (outside fenced code). Returns [{title, start, lines}]. */
function sections(lines) {
  const out = [];
  let cur = { title: "", start: 0, lines: [] };
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const h = !fence && line.match(/^##[ \t]+(.*)$/);
    if (h) {
      out.push(cur);
      cur = { title: stripClosingHashes(h[1]), start: i, lines: [] };
    } else cur.lines.push(line);
  });
  out.push(cur);
  return out;
}

/** Trim a heading's text and drop optional closing #s. Done in code, not regex, to stay linear-time. */
function stripClosingHashes(s) {
  let t = s.trim();
  let end = t.length;
  while (end > 0 && t[end - 1] === "#") end--;
  if (end < t.length && (end === 0 || t[end - 1] === " " || t[end - 1] === "\t")) t = t.slice(0, end);
  return t.trim();
}

function parseIdList(s) {
  return String(s ?? "")
    .split(/[,\s]+/)
    .map((x) => x.trim().replace(/[*`.;]/g, ""))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

function parseSpec(text) {
  const lines = splitLines(text);
  const title = (lines.find((l) => /^#\s+\S/.test(l)) || "").replace(/^#\s+/, "").trim() || null;
  const secs = sections(lines);
  const find = (re) => secs.find((s) => re.test(s.title));
  const reqSec = find(/^requirements?\b/i);
  const accSec = find(/^acceptance\b/i);
  const goalSec = find(/^goal\b/i);
  const requirements = [];
  if (reqSec) {
    reqSec.lines.forEach((line, k) => {
      const m = line.match(/^\s*[-*]\s+\*{0,2}(R\d+)\*{0,2}\s*[:.)\u2013\u2014-]\s*(.+)$/);
      if (m) requirements.push({ id: m[1], text: m[2].trim(), line: reqSec.start + k + 2 });
    });
  }
  const acceptance = [];
  if (accSec) {
    accSec.lines.forEach((line, k) => {
      const m = line.match(/^\s*[-*]\s+\*{0,2}(A\d+)\*{0,2}\s*\(([^)]*)\)\s*\*{0,2}\s*[:.\u2013\u2014-]?\s*(.+)$/);
      if (m) acceptance.push({ id: m[1], covers: parseIdList(m[2]), text: m[3].trim(), line: accSec.start + k + 2 });
    });
  }
  return {
    title,
    status: (readField(lines, "Status") || "").toLowerCase() || null,
    hasGoal: Boolean(goalSec && goalSec.lines.some((l) => l.trim())),
    hasRequirementsSection: Boolean(reqSec),
    hasAcceptanceSection: Boolean(accSec),
    requirements,
    acceptance,
  };
}

function checkSpec(text) {
  const spec = parseSpec(text);
  const errors = [];
  const warnings = [];
  if (!spec.title) errors.push("missing a `# Title` line");
  if (!spec.hasGoal) errors.push("missing a non-empty `## Goal` section");
  if (!spec.hasRequirementsSection) errors.push("missing a `## Requirements` section");
  else if (spec.requirements.length === 0) errors.push("no requirements found; write them as `- R1: ...`");
  if (!spec.hasAcceptanceSection) errors.push("missing an `## Acceptance` section");
  else if (spec.acceptance.length === 0) errors.push("no acceptance checks found; write them as `- A1 (R1): ...`");

  const reqIds = new Set();
  for (const r of spec.requirements) {
    if (reqIds.has(r.id)) errors.push(`${r.id} is defined twice (line ${r.line})`);
    reqIds.add(r.id);
  }
  const accIds = new Set();
  const proven = new Set();
  for (const a of spec.acceptance) {
    if (accIds.has(a.id)) errors.push(`${a.id} is defined twice (line ${a.line})`);
    accIds.add(a.id);
    if (a.covers.length === 0) errors.push(`${a.id} does not say which requirement it checks; write \`- ${a.id} (R1): ...\``);
    for (const id of a.covers) {
      if (!reqIds.has(id)) errors.push(`${a.id} refers to ${id}, which is not a requirement`);
      else proven.add(id);
    }
  }
  for (const r of spec.requirements) {
    if (!proven.has(r.id)) errors.push(`${r.id} has no acceptance check; add \`- A? (${r.id}): <how we will know it works>\``);
  }
  if (spec.status && !["draft", "approved"].includes(spec.status)) warnings.push(`unknown Status "${spec.status}"; use draft or approved`);
  return { spec, errors, warnings };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

// Linear-time: no two adjacent quantifiers can match the same characters.
const TASK_HEADING = /^#{2,3}[ \t]+Task[ \t]+(\d+)[ \t]*[:.\u2013\u2014-](.*)$/i;
const TASK_LIKE = /^#{2,4}[ \t]*Task\b/i;

function matchTask(line) {
  const m = line.match(TASK_HEADING);
  if (!m) return null;
  const title = stripClosingHashes(m[2]);
  return title ? { number: Number(m[1]), title } : null;
}

function parsePlan(text) {
  const lines = splitLines(text);
  const title = (lines.find((l) => /^#\s+\S/.test(l)) || "").replace(/^#\s+/, "").replace(/^plan\s*:\s*/i, "").trim() || null;
  const firstTask = lines.findIndex((l) => matchTask(l));
  const header = firstTask === -1 ? lines : lines.slice(0, firstTask);
  const tasks = [];
  let fence = null;
  let cur = null;
  const malformed = [];
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    const inFenceBefore = Boolean(fence);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    if (!inFenceBefore) {
      const t = matchTask(line);
      if (t) {
        cur = { number: t.number, title: t.title, line: i + 1, body: [] };
        tasks.push(cur);
        return;
      }
      if (TASK_LIKE.test(line)) malformed.push({ line: i + 1, text: line.trim().slice(0, 80) });
      if (cur && /^##\s+/.test(line)) {
        cur = null;
        return;
      }
    }
    if (cur) cur.body.push(line);
  });

  for (const t of tasks) {
    const covers = readField(t.body, "Covers");
    t.covers = covers === null ? null : /^none\b/i.test(covers) ? [] : parseIdList(covers);
    t.coversNone = covers !== null && /^none\b/i.test(covers);
    t.risk = (readField(t.body, "Risk") || "normal").toLowerCase();
    t.verify = readField(t.body, "Verify");
    t.doneWhen = readField(t.body, "Done when");
    const tf = readField(t.body, "Test-first");
    t.testFirst = tf === null ? true : !/^no\b/i.test(tf);
    t.testFirstReason = tf && /^no\b/i.test(tf) ? tf.replace(/^no\b[\s:,\u2013\u2014-]*/i, "").trim() : null;
    const deps = readField(t.body, "Depends");
    t.depends =
      deps === null || /^none\b/i.test(deps)
        ? []
        : parseIdList(deps)
            .map((d) => d.replace(/^task/i, ""))
            .filter((d) => /^\d+$/.test(d))
            .map(Number);
    t.files = readField(t.body, "Files");
    let inCode = false;
    let codeLines = 0;
    let words = 0;
    for (const l of t.body) {
      if (/^\s*(`{3,}|~{3,})/.test(l)) {
        inCode = !inCode;
        continue;
      }
      if (inCode) codeLines++;
      else words += (l.match(/\S+/g) || []).length;
    }
    t.words = words;
    t.codeLines = codeLines;
    t.text = t.body.join("\n").trim();
  }
  return {
    title,
    spec: readField(header, "Spec"),
    status: (readField(header, "Status") || "").toLowerCase() || null,
    testCommand: readField(header, "Test command"),
    tasks,
    malformed,
  };
}

/**
 * Check a plan. `opts.planPath` lets the linked spec be resolved; `opts.root` is
 * the project root (spec paths may be relative to either).
 */
function checkPlan(text, opts = {}) {
  const plan = parsePlan(text);
  const errors = [];
  const warnings = [];
  if (!plan.title) errors.push("missing a `# Plan: <title>` line");
  if (!plan.status) errors.push("missing `Status: draft` (or `approved`) near the top");
  else if (!PLAN_STATUSES.includes(plan.status)) errors.push(`Status must be draft or approved, not "${plan.status}"`);
  if (!plan.testCommand) warnings.push("no `Test command:`; `sp finish` will need one passed explicitly");
  if (plan.tasks.length === 0) errors.push("no tasks found; write them as `## Task 1: <title>`");
  for (const m of plan.malformed)
    errors.push(`line ${m.line} looks like a task heading but cannot be read: "${m.text}"; write it as \`## Task N: <title>\``);

  plan.tasks.forEach((t, i) => {
    const at = `Task ${t.number}`;
    if (t.number !== i + 1) errors.push(`${at} (line ${t.line}) is out of order; tasks must be numbered 1, 2, 3, ...`);
    if (t.covers === null) errors.push(`${at} has no \`Covers:\` line (requirement ids, or \`none - <reason>\`)`);
    if (!t.verify) errors.push(`${at} has no \`Verify:\` command`);
    if (!t.doneWhen) errors.push(`${at} has no \`Done when:\` line`);
    if (!RISKS.includes(t.risk)) errors.push(`${at} has Risk "${t.risk}"; use low, normal or high`);
    if (!t.testFirst && !t.testFirstReason) errors.push(`${at} says \`Test-first: no\` without a reason; write \`Test-first: no - <why>\``);
    for (const d of t.depends) {
      if (d >= t.number || d < 1) errors.push(`${at} depends on Task ${d}; a task can only depend on earlier tasks`);
    }
    if (t.codeLines > LIMITS.taskCodeLinesError)
      errors.push(`${at} contains ${t.codeLines} lines of code; plans record decisions, not implementations (limit ${LIMITS.taskCodeLinesError})`);
    else if (t.codeLines > LIMITS.taskCodeLinesWarn)
      warnings.push(`${at} contains ${t.codeLines} lines of code; keep code to signatures and key assertions`);
    if (t.words > LIMITS.taskWordsWarn) warnings.push(`${at} is ${t.words} words; consider splitting it`);
  });

  let spec = null;
  if (!plan.spec) errors.push("missing `Spec: <path>` near the top (use `Spec: none - <reason>` for work without one)");
  else if (!/^none\b/i.test(plan.spec)) {
    const candidates = [];
    if (opts.planPath) candidates.push(path.resolve(path.dirname(opts.planPath), plan.spec));
    if (opts.root) candidates.push(path.resolve(opts.root, plan.spec));
    const found = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) errors.push(`spec ${plan.spec} was not found`);
    else {
      const sc = checkSpec(fs.readFileSync(found, "utf8"));
      spec = sc.spec;
      spec.path = found;
      for (const e of sc.errors) errors.push(`spec: ${e}`);
      if (plan.status === "approved" && sc.spec.status !== "approved")
        errors.push("the plan is approved but its spec is not; set `Status: approved` in the spec after the user approves it");
    }
  }

  if (spec) {
    const ids = new Set(spec.requirements.map((r) => r.id));
    const covered = new Set();
    for (const t of plan.tasks) {
      for (const id of t.covers || []) {
        if (!ids.has(id)) errors.push(`Task ${t.number} covers ${id}, which is not in the spec`);
        else covered.add(id);
      }
    }
    for (const r of spec.requirements) {
      if (!covered.has(r.id)) errors.push(`${r.id} is not covered by any task`);
    }
  }
  return { plan, spec, errors, warnings };
}

module.exports = { RISKS, LIMITS, parseSpec, checkSpec, parsePlan, checkPlan, readField, splitLines };
