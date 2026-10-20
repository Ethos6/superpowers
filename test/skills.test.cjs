"use strict";
// Lints the skills and manifests so the collection stays small, consistent and correct.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { HELP } = require("../scripts/sp.cjs");

const ROOT = path.join(__dirname, "..");
const SKILLS = path.join(ROOT, "skills");
const MAX_WORDS = 600;
const MAX_DESC = 300;

const names = fs.readdirSync(SKILLS).filter((n) => fs.statSync(path.join(SKILLS, n)).isDirectory());

function readSkill(name) {
  const text = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, `${name}: SKILL.md must start with --- frontmatter ---`);
  const fm = Object.fromEntries(
    m[1].split("\n").map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  return { fm, body: m[2] };
}

const words = (s) => (s.replace(/```[\s\S]*?```/g, " ").match(/\S+/g) || []).length;

test("there is a sensible number of skills, including the index", () => {
  assert.ok(names.includes("using-superpowers"));
  assert.ok(names.length >= 8 && names.length <= 15, String(names.length));
});

for (const name of names) {
  test(`skill ${name}: frontmatter, trigger description, budget, links, commands`, () => {
    const { fm, body } = readSkill(name);
    assert.deepEqual(Object.keys(fm).sort(), ["description", "name"], "only name and description");
    assert.equal(fm.name, name);
    assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.match(fm.description, /^Use (when|at|before)\b/, "descriptions say when to use the skill");
    assert.ok(fm.description.length <= MAX_DESC, `description is ${fm.description.length} chars`);
    const n = words(body);
    assert.ok(n <= MAX_WORDS, `${name} body is ${n} words; move detail to references/`);
    for (const [, target] of body.matchAll(/\]\(([^)#\s]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      assert.ok(fs.existsSync(path.join(SKILLS, name, target)), `${name}: broken link ${target}`);
    }
    for (const [, sub] of body.matchAll(/`sp ([a-z]+)/g)) {
      assert.match(HELP, new RegExp(`\\n  sp ${sub}\\b`), `${name} mentions sp ${sub}, which does not exist`);
    }
    assert.doesNotMatch(body, /\b(MUST|NEVER|ALWAYS|ABSOLUTELY|CRITICAL)\b/, "calm instructions, no shouting");
  });
}

test("reference files mention only real sp commands", () => {
  for (const name of names) {
    const dir = path.join(SKILLS, name, "references");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      for (const [, sub] of text.matchAll(/`sp ([a-z]+)/g)) assert.match(HELP, new RegExp(`\\n  sp ${sub}\\b`), `${name}/${f}: sp ${sub}`);
    }
  }
});

test("the session-start text stays small", () => {
  const text = fs.readFileSync(path.join(ROOT, "hooks", "bootstrap.md"), "utf8");
  assert.ok(words(text) <= 200, `${words(text)} words`);
  assert.match(text, /\{\{SP\}\}/);
});

test("all skill descriptions together stay under 2,500 characters", () => {
  const total = names.reduce((n, name) => n + readSkill(name).fm.description.length, 0);
  assert.ok(total <= 2500, String(total));
});

test("manifests agree with package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.name, "superpowers");
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, "./");
  assert.ok(market.owner && market.owner.name);
  assert.equal(market.plugins[0].version, undefined, "version lives in plugin.json only");
});

test("every source file is plain ASCII (no invisible characters)", () => {
  const files = [];
  for (const dir of ["lib", "scripts", "hooks", "test"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (/\.(cjs|json|md)$/.test(f)) files.push(path.join(dir, f));
  }
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    const bad = [...text].find((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && !"\n\t".includes(c)));
    assert.equal(bad, undefined, `${f} contains U+${bad && bad.charCodeAt(0).toString(16)}`);
  }
});
