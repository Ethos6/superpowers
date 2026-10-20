"use strict";
// Runs one shell command for `sp test` / `sp finish` and reports how it ended.
//
// It is started as a separate Node process (see run() below) so that the parent
// can stay synchronous while this process owns the command's whole process
// tree: a POSIX process group, or a taskkill /T tree on Windows. The tree is
// killed when the timeout fires, when the command's shell exits (so leftover
// background processes cannot keep sp waiting), when this process is
// interrupted, and when its parent disappears. The result is passed back on
// file descriptor 3, so no temporary files are needed.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

/** Which shell runs commands. Windows prefers Git Bash, matching Claude Code's Bash tool. */
function pickShell(env = process.env, platform = process.platform) {
  if (env.SP_SHELL) return env.SP_SHELL;
  if (platform !== "win32") return true;
  const exists = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (env.CLAUDE_CODE_GIT_BASH_PATH && exists(env.CLAUDE_CODE_GIT_BASH_PATH)) return env.CLAUDE_CODE_GIT_BASH_PATH;
  for (const dir of (env.PATH || env.Path || "").split(";")) {
    if (!dir || /[\\/](system32|windowsapps)[\\/]?$/i.test(dir)) continue; // skip the WSL launcher
    const p = path.join(dir, "bash.exe");
    if (exists(p)) return p;
  }
  return true; // cmd.exe
}

function isPosixShell(shell, platform = process.platform) {
  if (shell === true) return platform !== "win32";
  return /(^|[\\/])(ba|z|da|k)?sh(\.exe)?$/i.test(String(shell));
}

/** Join argv words into one command line for the given shell, quoting where needed. */
function joinArgs(args, shell, platform = process.platform) {
  if (args.length === 1) return args[0]; // one string: the user wrote a full command line
  if (isPosixShell(shell, platform)) return args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
  return args.map((a) => (/^[\w@+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)).join(" ");
}

/** Parent side: run `command` in `cwd`, capture its combined output, enforce `timeoutSec`. */
function run(command, cwd, timeoutSec, shell = pickShell()) {
  const t = Number(timeoutSec) > 0 ? Number(timeoutSec) : 0;
  const res = spawnSync(process.execPath, [__filename, String(t), JSON.stringify(shell), command], {
    cwd,
    stdio: ["inherit", "pipe", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // A backstop in case the runner itself hangs; it normally ends long before this.
    timeout: t ? (t + 30) * 1000 : undefined,
    killSignal: "SIGKILL",
  });
  const output = `${res.stdout || ""}${res.stderr || ""}`;
  let result = null;
  try {
    result = JSON.parse(String((res.output && res.output[3]) || "").trim().split("\n").pop());
  } catch {
    result = null;
  }
  if (!result) result = { exit: null, timedOut: Boolean(res.error && res.error.code === "ETIMEDOUT"), error: res.error ? res.error.message : null, signal: res.signal || null };
  return { ...result, output };
}

// ---------------------------------------------------------------------------
// Child side.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const [timeoutArg, shellArg, command] = process.argv.slice(2);
  const timeoutMs = Number(timeoutArg) * 1000;
  const shell = JSON.parse(shellArg);
  const posix = process.platform !== "win32";
  let timedOut = false;
  let finished = false;
  let child = null;

  const report = (obj) => {
    try {
      fs.writeSync(3, JSON.stringify(obj) + "\n");
    } catch {
      /* parent is gone */
    }
  };
  const killTree = () => {
    if (!child || !child.pid) return;
    if (posix) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* group already gone */
      }
    } else {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
  };
  const end = (obj) => {
    if (finished) return;
    finished = true;
    killTree();
    report(obj);
    process.exit(0);
  };

  try {
    child = spawn(command, { shell, stdio: "inherit", detached: posix, windowsHide: true });
  } catch (e) {
    end({ exit: null, timedOut: false, error: e.message, signal: null });
  }

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => end({ exit: null, timedOut: false, error: `interrupted by ${sig}`, signal: sig }));
  }
  const parent = process.ppid;
  const watch = setInterval(() => {
    if (process.ppid !== parent) end({ exit: null, timedOut: false, error: "sp exited before the command finished", signal: null });
  }, 500);
  watch.unref();

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          end({ exit: null, timedOut: true, error: null, signal: null });
        }, timeoutMs)
      : null;

  child.on("error", (e) => end({ exit: null, timedOut: false, error: e.message, signal: null }));
  child.on("exit", (code, signal) => {
    if (timer) clearTimeout(timer);
    if (timedOut) return;
    // A command killed by a signal (a crash, not our timeout) is a failure with
    // the conventional 128+N exit status, so it can count as a failing run.
    const exit = code !== null ? code : signal && os.constants.signals[signal] ? 128 + os.constants.signals[signal] : 1;
    end({ exit, timedOut: false, error: null, signal: signal || null });
  });
}

module.exports = { run, pickShell, joinArgs, isPosixShell };
