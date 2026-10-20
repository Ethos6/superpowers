#!/usr/bin/env node
"use strict";
const path = require("node:path");
const { runHook } = require("./run.cjs");
const { sessionContext } = require("../lib/hooks.cjs");

runHook((input) => ({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: sessionContext(input, process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, "..")),
  },
}));
