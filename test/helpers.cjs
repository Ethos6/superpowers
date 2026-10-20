"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dirs = [];
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpdir() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sp-test-")));
  dirs.push(d);
  return d;
}

const SPEC = `# Slugify helper
Status: approved

## Goal
Turn titles into URL slugs.

## Requirements
- R1: Lowercase and join words with single hyphens.
- R2: Trim leading and trailing hyphens.

## Acceptance
- A1 (R1): slugify("Hello, World") returns "hello-world".
- A2 (R2): slugify("--x--") returns "x".
`;

function plan({ status = "approved", tasks } = {}) {
  const body =
    tasks ||
    `## Task 1: Core slugify
Covers: R1
Risk: normal
Done when: A1 passes.
Verify: node check.cjs

## Task 2: Trimming
Covers: R2
Risk: low
Depends: 1
Done when: A2 passes.
Verify: node check.cjs
`;
  return `# Plan: Slugify helper
Spec: ../specs/slug.md
Status: ${status}
Test command: node check.cjs

${body}`;
}

/** A project with .superpowers/, a spec, a plan, and a check.cjs whose exit code is read from ok.txt. */
function project(opts = {}) {
  const st = require("../lib/state.cjs");
  const root = tmpdir();
  st.init(root, opts.enforce ? { enforce: opts.enforce } : {});
  fs.mkdirSync(path.join(root, "docs", "specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "specs", "slug.md"), opts.spec || SPEC);
  fs.writeFileSync(path.join(root, "docs", "plans", "slug.md"), opts.plan || plan(opts));
  fs.writeFileSync(path.join(root, "check.cjs"), 'process.exit(require("fs").readFileSync(__dirname + "/ok.txt", "utf8").trim() === "1" ? 0 : 1);\n');
  setOk(root, false);
  return root;
}

function setOk(root, ok) {
  fs.writeFileSync(path.join(root, "ok.txt"), ok ? "1" : "0");
}

module.exports = { tmpdir, project, setOk, SPEC, plan };
