/**
 * Guards the first load. Everything a visitor downloads before they can type a
 * problem has to stay small; the OCR model is a separate, deferred download and
 * is deliberately not counted here.
 */
import { gzipSync } from "node:zlib";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT = "dist";
const DIST = join(OUTPUT, "assets");
const BUDGET_KB = 200;
/** Chunks fetched only when someone scans, not on first load. */
const DEFERRED = [/transformers/, /ocr-runtime/, /^ort-/];

/**
 * The host has to be told where the build lands, and nothing checked that what
 * it was told matched where the build actually lands. A deployment failed on
 * exactly that: vercel.json said apps/web/dist while Vite wrote somewhere
 * else, and the mismatch only surfaced as a failed deploy. Checked here
 * because CI already runs this straight after the build.
 */
const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
if (vercel.outputDirectory !== OUTPUT) {
  console.error(
    `vercel.json says the build lands in "${vercel.outputDirectory}", ` +
    `but it lands in "${OUTPUT}". A deploy would find nothing to serve.`,
  );
  process.exit(1);
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
