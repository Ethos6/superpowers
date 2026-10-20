#!/usr/bin/env node
"use strict";
const { runHook } = require("./run.cjs");
const { stopDecision } = require("../lib/hooks.cjs");

runHook((input) => stopDecision(input));
