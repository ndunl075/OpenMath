/**
 * Guards the first load. Everything a visitor downloads before they can type a
 * problem has to stay small; the OCR model is a separate, deferred download and
 * is deliberately not counted here.
 */
import { gzipSync } from "node:zlib";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Where Vite actually writes, relative to the repository root. */
const OUTPUT = "apps/web/dist";
const DIST = join(OUTPUT, "assets");
const BUDGET_KB = 200;
/** Chunks fetched only when someone scans, not on first load. */
const DEFERRED = [/transformers/, /ocr-runtime/, /^ort-/];

/**
 * Two deployments failed on where the build lands, so it is checked here —
 * CI runs this straight after the build, which is the last place a mismatch
 * can be caught before it becomes a failed deploy.
 *
 * There are two config files because Vercel reads only the one sitting at
 * whatever it has been told the project root is. With the root left empty it
 * reads the top-level file; set to apps/web it reads the nested one and the
 * top-level file is invisible to it. Having only the top-level file meant the
 * SPA rewrite, the immutable asset caching and Service-Worker-Allowed were
 * all silently not applied, which a green deploy would not have revealed.
 *
 * Both must therefore describe the same directory, and carry the same routing
 * and headers, or the site behaves differently depending on a dashboard field.
 */
const configs = [
  { path: "vercel.json", base: "", expected: OUTPUT },
  { path: "apps/web/vercel.json", base: "apps/web", expected: "dist" },
];

for (const { path, expected } of configs) {
  const config = JSON.parse(await readFile(path, "utf8"));
  if (config.outputDirectory !== expected) {
    console.error(
      `${path} says the build lands in "${config.outputDirectory}", ` +
      `but from where that file sits it lands in "${expected}". ` +
      `A deploy reading that file would find nothing to serve.`,
    );
    process.exit(1);
  }
}

// The routing and headers are duplicated out of necessity, so they are
// compared rather than trusted.
const [rootConfig, nestedConfig] = await Promise.all(
  configs.map(async (c) => JSON.parse(await readFile(c.path, "utf8"))),
);
for (const key of ["cleanUrls", "rewrites", "headers"]) {
  if (JSON.stringify(rootConfig[key]) !== JSON.stringify(nestedConfig[key])) {
    console.error(
      `vercel.json and apps/web/vercel.json disagree about "${key}". ` +
      `The site would behave differently depending on the project's ` +
      `Root Directory setting.`,
    );
    process.exit(1);
  }
}

// index.html is what the host serves; assets alone are not a site.
for (const required of ["index.html", "sw.js", "manifest.webmanifest"]) {
  try {
    await access(join(OUTPUT, required));
  } catch {
    console.error(`the build produced no ${required} in "${OUTPUT}"`);
    process.exit(1);
  }
}

const files = await readdir(DIST);
let total = 0;
const rows = [];

for (const file of files) {
  if (!/\.(js|css)$/.test(file)) continue;
  if (DEFERRED.some((re) => re.test(file))) continue;
  const bytes = gzipSync(await readFile(join(DIST, file))).length;
  total += bytes;
  rows.push([file, bytes]);
}

rows.sort((a, b) => b[1] - a[1]);
for (const [file, bytes] of rows) {
  console.log(`${(bytes / 1024).toFixed(1).padStart(8)} kB  ${file}`);
}

const totalKb = total / 1024;
console.log(`\nFirst load: ${totalKb.toFixed(1)} kB gzipped (budget ${BUDGET_KB} kB)`);

if (totalKb > BUDGET_KB) {
  console.error(`\nOver budget by ${(totalKb - BUDGET_KB).toFixed(1)} kB.`);
  process.exit(1);
}
