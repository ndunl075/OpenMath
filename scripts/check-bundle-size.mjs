/**
 * Guards the first load. Everything a visitor downloads before they can type a
 * problem has to stay small; the OCR model is a separate, deferred download and
 * is deliberately not counted here.
 */
import { gzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const DIST = "apps/web/dist/assets";
const BUDGET_KB = 200;
/** Chunks fetched only when someone scans, not on first load. */
const DEFERRED = [/transformers/, /ocr-runtime/, /^ort-/];

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
