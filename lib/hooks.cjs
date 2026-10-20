"use strict";
// Decision logic for the Claude Code hooks. Kept separate from the hook entry
// points so it can be unit-tested without spawning processes.

const fs = require("node:fs");
const path = require("node:path");
const st = require("./state.cjs");

const BOOTSTRAP_FILE = path.join(__dirname, "..", "hooks", "bootstrap.md");

function spCommand(pluginRoot) {
  const script = path.join(pluginRoot || path.join(__dirname, ".."), "scripts", "sp.cjs").split(path.sep).join("/");
  return `node "${script}"`;
}

function progressLine(root, state, cfg) {
  if (!state || state.finished) return null;
  const closed = state.tasks.filter(st.isClosed).length;
  const what = state.kind === "quick" ? `Quick task "${state.plan.title}"` : `Plan ${state.plan.path}`;
  const parts = [`${what} is in progress: ${closed}/${state.tasks.length} tasks closed.`];
  const active = state.tasks.filter((t) => t.status === "active");
  for (const t of active) {
    const last = t.runs[t.runs.length - 1];
    const lastTxt = last ? `last check ${last.ok ? "matched" : "did not match"} its expectation (expected ${last.expect})` : "no check recorded yet";
    parts.push(`Task ${t.id} "${t.title}" is active; ${lastTxt}.`);
  }
  if (!active.length) {
    const ready = st.readyTasks(state);
    if (ready.length) parts.push(`Next is Task ${ready[0].id} "${ready[0].title}".`);
    else if (closed === state.tasks.length) parts.push("All tasks are closed; the final step is `sp finish`.");
  }
  if (st.planDrift(root, state)) parts.push("The plan file changed since it was started; `sp sync` merges the edits.");
  parts.push(`Enforcement is ${cfg.enforce}. Completed tasks must not be redone; \`sp status\` shows the full ledger.`);
  return parts.join(" ");
}

/** Text added to the conversation at session start, resume, clear and compaction. */
function sessionContext(input, pluginRoot) {
  let text = "";
  try {
    text = fs.readFileSync(BOOTSTRAP_FILE, "utf8").trim();
  } catch {
    text = "The superpowers skills are installed.";
  }
  text = text.replace(/\{\{SP\}\}/g, spCommand(pluginRoot));
  const root = st.findRoot(input && input.cwd ? input.cwd : process.cwd());
  if (root) {
    try {
      const line = progressLine(root, st.loadState(root), st.loadConfig(root));
      if (line) text += `\n\nCurrent superpowers state for ${root}: ${line}`;
    } catch (e) {
      text += `\n\nThe superpowers ledger in ${root} could not be read (${e.message}).`;
    }
  }
  return text.slice(0, 9500);
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const DOC_EXT = /\.(md|mdx|markdown|rst|adoc)$/i;

/** Resolve symlinks in the longest existing prefix of `p` (the file itself may not exist yet). */
function realish(p) {
  let cur = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join((fs.realpathSync.native || fs.realpathSync)(cur), ...tail);
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      tail.unshift(path.basename(cur));
      cur = up;
    }
  }
}

/**
 * Is this path segment the ledger directory, however a case-insensitive or
 * Windows file system would read it (any case, trailing dots or spaces, or an
 * NTFS stream suffix such as "::$INDEX_ALLOCATION")?
 */
const isLedgerSegment = (seg) => seg.split(":")[0].replace(/[. ]+$/, "").toLowerCase() === st.DIR;
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

/**
 * PreToolUse decision for file edits. Returns null (allow, say nothing) or
 * { decision: "deny", reason }.
 */
function editDecision(input) {
  if (!input || !EDIT_TOOLS.has(input.tool_name)) return null;
  const ti = input.tool_input || {};
  const file = ti.file_path || ti.notebook_path || ti.path;
  if (typeof file !== "string" || !file) return null;
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const abs = realish(path.resolve(cwd, file));
  // The project is the one containing the edited file, not necessarily the cwd.
  const root = st.findRoot(path.dirname(abs)) || st.findRoot(cwd);
  if (!root) return null;
  const rootReal = realish(root);
  const rel = path.relative(rootReal, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const segs = rel.split(path.sep);
  // The ledger is only changed through sp, so its rules cannot be edited away.
  if (isLedgerSegment(segs[0]))
    return { decision: "deny", reason: `${segs.join("/")} is superpowers state; change it only through sp commands (sp status, sp sync, sp rule).` };
  const cfg = st.loadConfig(root);
  if (cfg.enforce !== "on") return null;
  const relPosix = segs.join("/");
  const docsDir = cfg.docsDir.replace(/\/+$/, "");
  const inDocs = CASE_INSENSITIVE_FS ? relPosix.toLowerCase().startsWith(`${docsDir.toLowerCase()}/`) : relPosix.startsWith(`${docsDir}/`);
  if (DOC_EXT.test(relPosix) || inDocs) return null;
  const state = st.loadState(root);
  if (state && !state.finished) return null;
  return {
    decision: "deny",
    reason:
      "This project enforces the superpowers workflow (enforce=on): code changes need an approved plan or a declared quick task. " +
      'Run `sp start <approved plan>`, or for a small change `sp quick "<what you are changing>"`, then retry. ' +
      `Markdown files and ${docsDir}/ can be edited at any time.`,
  };
}

/** Stop decision: returns null, or { decision: "block", reason }. Never blocks twice in a row. */
function stopDecision(input) {
  if (!input || input.stop_hook_active === true) return null;
  const root = st.findRoot(input.cwd || process.cwd());
  if (!root) return null;
  const cfg = st.loadConfig(root);
  if (cfg.enforce !== "on") return null;
  const state = st.loadState(root);
  if (!state || state.finished) return null;
  for (const t of state.tasks.filter((x) => x.status === "active")) {
    const last = t.runs[t.runs.length - 1];
    if (!last || !(last.expect === "pass" && last.ok)) {
      return {
        decision: "block",
        reason:
          `Task ${t.id} "${t.title}" is active but has no passing check after its latest run. ` +
          `Run \`sp test ${t.id} --expect pass${t.verify ? "" : " -- <command>"}\` and report the result, or tell the user plainly what is blocking the task. ` +
          "Do not describe the task as complete without that evidence.",
      };
    }
  }
  return null;
}

module.exports = { sessionContext, editDecision, stopDecision, progressLine, spCommand };
