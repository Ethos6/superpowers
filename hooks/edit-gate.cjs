#!/usr/bin/env node
"use strict";
const { runHook } = require("./run.cjs");
const { editDecision } = require("../lib/hooks.cjs");

runHook((input) => {
  const d = editDecision(input);
  if (!d) return null;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.reason } };
});
