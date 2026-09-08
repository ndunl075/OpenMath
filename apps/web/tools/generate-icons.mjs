/**
 * Rasterises the app mark into every size a browser or an installed PWA asks
 * for. Run with `pnpm --filter @openmath/web icons` after editing the SVG.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const OUTPUTS = [
  { source: "icon.svg", name: "favicon-16.png", size: 16 },
  { source: "icon.svg", name: "favicon-32.png", size: 32 },
  { source: "icon.svg", name: "favicon-48.png", size: 48 },
  { source: "icon.svg", name: "icon-192.png", size: 192 },
  { source: "icon.svg", name: "icon-512.png", size: 512 },
  { source: "icon-maskable.svg", name: "icon-maskable-512.png", size: 512 },
  { source: "icon-maskable.svg", name: "apple-touch-icon.png", size: 180 },
];

await mkdir(publicDir, { recursive: true });

for (const { source, name, size } of OUTPUTS) {
  const svg = await readFile(join(here, source));
  const png = await sharp(svg, { density: 512 })
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(publicDir, name), png);
  console.log(`${name.padEnd(28)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

// A multi-resolution .ico for browsers and bookmark bars that still want one.
const icoSizes = [16, 32, 48];
const images = await Promise.all(
  icoSizes.map(async (size) => {
    const svg = await readFile(join(here, "icon.svg"));
    return { size, data: await sharp(svg, { density: 512 }).resize(size, size).png().toBuffer() };
  }),
);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const entries = [];
for (const { size, data } of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += data.length;
}
await writeFile(
  join(publicDir, "favicon.ico"),
  Buffer.concat([header, ...entries, ...images.map((i) => i.data)]),
);
console.log("favicon.ico                  16/32/48");
