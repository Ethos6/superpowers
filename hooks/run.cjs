"use strict";
// Shared entry point for the hooks: read the event JSON from stdin, call a
// decision function, and print exactly one JSON object (or nothing).
// Hooks fail open: on any internal error they print nothing and exit 0, so a
// bug here can never stop the user from working.

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

async function runHook(build) {
  try {
    const raw = await readStdin();
    let input = {};
    try {
      input = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      input = {};
    }
    const output = build(input);
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (e) {
    if (process.env.SUPERPOWERS_DEBUG) process.stderr.write(`superpowers hook error: ${e && e.stack ? e.stack : e}\n`);
  }
}

module.exports = { runHook };
