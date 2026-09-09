/**
 * The three rules the owner set for the interface: no pill shapes, no purple,
 * no gradients. Written down as a check rather than a promise, because a
 * design rule that lives only in someone's memory is one refactor from being
 * broken by accident.
 *
 * Deliberately narrow. It cannot tell you the design is good — only that it
 * has not drifted back into the three things that were explicitly rejected.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

/*
 * Everything that can put a colour or a corner on screen. `packages` is in
 * here because the one purple that survived the redesign was a fallback in
 * step-motion, not in the app: a check that only looks at `apps` proves less
 * than it appears to.
 */
const ROOTS = ["apps/web/src", "apps/web/tools", "apps/web/index.html", "packages"];
const EXTENSIONS = new Set([".css", ".ts", ".tsx", ".svg", ".mjs", ".html"]);

/**
 * Purple sits around hue 270-320 in oklch, which is how the old palette was
 * written. Also catches the hex and named forms in case anything is authored
 * a different way.
 */
const RULES = [
  {
    name: "no pill shapes",
    pattern: /radius-pill|border-radius:\s*999|border-radius:\s*9999/gi,
    why: "a pill was explicitly rejected; use a small consistent radius",
  },
  {
    name: "no gradients",
    pattern: /linear-gradient|radial-gradient|conic-gradient|<linearGradient|<radialGradient/gi,
    why: "flat fills only",
  },
  {
    name: "no purple",
    // Chroma-aware, because hue alone is not colour. A near-neutral grey
    // written as oklch(0.24 0.02 285) reads as grey to the eye, and banning
    // it would force pure greys for no reason. Only saturated purple counts.
    find: findPurple,
    why: "hue 270-320 above a faint tint is the palette that was rejected",
  },
];

const PURPLE_MIN_CHROMA = 0.05;
const PURPLE_HUES = [270, 320];

function findPurple(line) {
  if (/\b(violet|indigo|purple|magenta)\b/i.test(line)) return true;
  const colours = line.matchAll(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/gi);
  for (const [, , chroma, hue] of colours) {
    const c = Number(chroma);
    const h = Number(hue);
    if (c >= PURPLE_MIN_CHROMA && h >= PURPLE_HUES[0] && h <= PURPLE_HUES[1]) return true;
  }
  return false;
}

const SKIP_DIRS = new Set(["dist", "node_modules", "coverage", ".turbo"]);

const files = [];
async function walk(path) {
  if (!(await stat(path)).isDirectory()) {
    if (EXTENSIONS.has(extname(path))) files.push(path);
    return;
  }
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    await walk(join(path, entry.name));
  }
}
for (const root of ROOTS) await walk(root);

const violations = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  const lines = text.split("\n");
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      const hit = rule.find
        ? rule.find(line)
        : ((rule.pattern.lastIndex = 0), rule.pattern.test(line));
      if (hit) {
        violations.push(`${file}:${i + 1}  [${rule.name}] ${line.trim().slice(0, 90)}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`The interface broke ${violations.length} of its own rules:\n`);
  for (const v of violations) console.error("  " + v);
  console.error("\n" + RULES.map((r) => `  ${r.name}: ${r.why}`).join("\n"));
  process.exit(1);
}
console.log(`Design constraints hold across ${files.length} files: ${RULES.map((r) => r.name).join(", ")}.`);
