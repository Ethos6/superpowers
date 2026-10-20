"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const st = require("../lib/state.cjs");
const hooks = require("../lib/hooks.cjs");
const { project, tmpdir } = require("./helpers.cjs");

const HOOKS = path.join(__dirname, "..", "hooks");

function runHook(name, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, name)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("session start: valid JSON with the bootstrap and the sp command", () => {
  const r = runHook("session-start.cjs", { cwd: tmpdir(), source: "startup" }, { CLAUDE_PLUGIN_ROOT: "/opt/plugins/superpowers" });
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.equal(o.hookSpecificOutput.hookEventName, "SessionStart");
  const ctx = o.hookSpecificOutput.additionalContext;
  assert.match(ctx, /superpowers skills are installed/);
  assert.match(ctx, /node "\/opt\/plugins\/superpowers\/scripts\/sp\.cjs" status/);
  assert.doesNotMatch(ctx, /\{\{SP\}\}/);
  assert.doesNotMatch(ctx, /Current superpowers state/, "no ledger, no state line");
  assert.ok(ctx.length < 10000);
});

test("session start after compaction restores where the work stands", () => {
  const root = project();
  st.start(root, "docs/plans/slug.md");
  st.next(root);
  st.recordRun(root, 1, { cmd: "x", expect: "fail", exit: 1 });
  const sub = path.join(root, "src");
  fs.mkdirSync(sub);
  const ctx = JSON.parse(runHook("session-start.cjs", { cwd: sub, source: "compact" }).out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Plan docs\/plans\/slug\.md is in progress: 0\/2 tasks closed/);
  assert.match(ctx, /Task 1 "Core slugify" is active; last check matched its expectation \(expected fail\)/);
  assert.match(ctx, /must not be redone/);
});

test("session start survives garbage input and a corrupt ledger", () => {
  assert.equal(JSON.parse(runHook("session-start.cjs", "not json").out).hookSpecificOutput.hookEventName, "SessionStart");
  const root = project();
  fs.writeFileSync(path.join(root, ".superpowers", "state.json"), "{bad");
  const ctx = JSON.parse(runHook("session-start.cjs", { cwd: root }).out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /could not be read/);
});

test("edit gate: off by default, protects the ledger always", () => {
  const root = project();
  const edit = (file, tool = "Edit") => hooks.editDecision({ tool_name: tool, cwd: root, tool_input: { file_path: file } });
  assert.equal(edit(path.join(root, "src", "a.js")), null, "enforce is off");
  assert.equal(edit(path.join(root, ".superpowers", "state.json")).decision, "deny");
  assert.equal(edit(".superpowers/config.json", "Write").decision, "deny");
  assert.equal(hooks.editDecision({ tool_name: "Read", cwd: root, tool_input: { file_path: path.join(root, ".superpowers/state.json") } }), null);
  assert.equal(edit(path.join(tmpdir(), "elsewhere.js")), null, "files outside the project are not our business");
  assert.equal(hooks.editDecision({ tool_name: "Edit", cwd: tmpdir(), tool_input: { file_path: "/x/y.js" } }), null, "no ledger, no gate");
});

test("edit gate with enforce=on: docs allowed, code needs a plan or quick task", () => {
  const root = project({ enforce: "on" });
  const edit = (file, tool = "Edit") => hooks.editDecision({ tool_name: tool, cwd: root, tool_input: { file_path: path.join(root, file) } });
  assert.equal(edit("src/a.js").decision, "deny");
  assert.match(edit("src/a.js").reason, /sp quick/);
  assert.equal(edit("docs/specs/new.md"), null);
  assert.equal(edit("README.md"), null);
  assert.equal(edit("docs/diagram.svg"), null, "anything under docs/ is allowed");
  assert.equal(edit("nb.ipynb", "NotebookEdit").decision, "deny");
  st.quick(root, "small fix");
  assert.equal(edit("src/a.js"), null);
});

test("edit gate hook process emits a PreToolUse deny", () => {
  const root = project({ enforce: "on" });
  const r = runHook("edit-gate.cjs", { hook_event_name: "PreToolUse", tool_name: "Write", cwd: root, tool_input: { file_path: path.join(root, "x.js") } });
  const o = JSON.parse(r.out);
  assert.equal(o.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(o.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(runHook("edit-gate.cjs", { tool_name: "Write", cwd: root, tool_input: { file_path: path.join(root, "x.md") } }).out, "");
});

test("stop check: blocks once when an active task lacks a passing check", () => {
  const root = project({ enforce: "on" });
  assert.equal(hooks.stopDecision({ cwd: root }), null, "nothing in progress");
  st.start(root, "docs/plans/slug.md");
  assert.equal(hooks.stopDecision({ cwd: root }), null, "nothing active yet");
  st.next(root);
  const d = hooks.stopDecision({ cwd: root });
  assert.equal(d.decision, "block");
  assert.match(d.reason, /sp test 1 --expect pass/);
  assert.equal(hooks.stopDecision({ cwd: root, stop_hook_active: true }), null, "never blocks twice in a row");
  st.recordRun(root, 1, { cmd: "x", expect: "fail", exit: 1 });
  assert.equal(hooks.stopDecision({ cwd: root }).decision, "block", "a red run alone is not a passing check");
  st.recordRun(root, 1, { cmd: "x", expect: "pass", exit: 0 });
  assert.equal(hooks.stopDecision({ cwd: root }), null);
  const out = runHook("stop-check.cjs", { cwd: root, hook_event_name: "Stop" });
  assert.equal(out.out, "");
});

test("stop check is silent when enforce is off", () => {
  const root = project();
  st.start(root, "docs/plans/slug.md");
  st.next(root);
  assert.equal(hooks.stopDecision({ cwd: root }), null);
});

test("hooks.json points at scripts that exist and uses portable node commands", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));
  const cmds = Object.values(cfg.hooks).flat().flatMap((m) => m.hooks.map((h) => h.command));
  assert.equal(cmds.length, 3);
  for (const c of cmds) {
    const m = c.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[\w-]+\.cjs)"$/);
    assert.ok(m, c);
    assert.ok(fs.existsSync(path.join(__dirname, "..", m[1])), m[1]);
  }
});
