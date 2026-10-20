"use strict";
// Runs every *.test.cjs in this folder in one process (works on Node 18+ and Windows).
const fs = require("node:fs");
const path = require("node:path");
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith(".test.cjs")).sort()) require(path.join(__dirname, f));
