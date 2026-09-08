import { cloneImage, createImage, cropTo, resize } from "./image.js";
import type { RasterImage, Rect } from "./types.js";

/**
 * The image pipeline the Texo / FormulaNet model was trained and shipped with.
 *
 * Ported step for step from the reference browser app
 * (alephpi/Texo-web, app/composables/workers/imageProcessor.ts) rather than
 * reinvented. A vision-encoder-decoder is only as good as the match between the
 * tensor it gets and the tensor it saw in training, so fidelity beats taste
 * here: where the reference does something odd, this does the same odd thing.
 *
 * That is also why the generic `preprocess` in ./image.ts is NOT applied first.
 * Both chains decide independently whether to invert, and running them in
 * sequence can invert twice and hand the model a negative.
 */

/** UniMERNet normalisation constants, as used by the reference app. */
export const UNIMERNET_MEAN = 0.7931;
export const UNIMERNET_STD = 0.1738;

/** The model's input is a fixed square. */
export const MODEL_INPUT_SIZE = 384;

/** Ink/paper split used by both the inversion heuristic and the margin crop. */
const LEVEL_THRESHOLD = 200;

export interface ModelTensor {
  /** Single channel, row-major, length width * height. */
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * Rec. 601 luma. The reference uses image-js `.grey()`, whose default weights
 * differ slightly; on the near-neutral pixels of a document photo the two agree
 * to well under one level, and this keeps one greyscale definition in the
 * package rather than two.
 */
function toGreyLevels(img: RasterImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    // Composite onto white first: a transparent PNG otherwise reads as black ink.
    const alpha = d[i + 3]! / 255;
    const r = d[i]! * alpha + 255 * (1 - alpha);
    const g = d[i + 1]! * alpha + 255 * (1 - alpha);
    const b = d[i + 2]! * alpha + 255 * (1 - alpha);
    out[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

function levelsToImage(levels: Uint8ClampedArray, width: number, height: number): RasterImage {
  const img = createImage(width, height);
  for (let p = 0; p < levels.length; p++) {
    const v = levels[p]!;
    const i = p * 4;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  return img;
}

/**
 * Invert when dark pixels outnumber light ones. Counts either side of a fixed
 * level rather than comparing means, which is what the reference does and is
 * less easily fooled by a large flat background.
 */
export function reverseColor(levels: Uint8ClampedArray): Uint8ClampedArray {
  let dark = 0;
  for (const v of levels) if (v < LEVEL_THRESHOLD) dark++;
  const light = levels.length - dark;
  if (dark < light) return levels;
  const out = new Uint8ClampedArray(levels.length);
  for (let i = 0; i < levels.length; i++) out[i] = 255 - levels[i]!;
  return out;
}

/**
 * Bounding box of the ink after stretching the levels to full range. The
 * stretch is what makes a fixed threshold work on a dim photo.
 */
export function marginBounds(
  levels: Uint8ClampedArray,
  width: number,
  height: number,
): Rect | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of levels) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) return null;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const span = max - min;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const normalized = ((levels[y * width + x]! - min) / span) * 255;
      if (normalized < LEVEL_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;

  // The reference takes maxX - minX, not + 1, so the last row and column of ink
  // are shaved off. Matched deliberately: the model was fitted against this.
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** Fit inside the square without distorting, then centre on a black field. */
export function letterbox(img: RasterImage, size = MODEL_INPUT_SIZE): RasterImage {
  const scale = size / Math.min(img.height, img.width);
  let w = Math.round(img.width * scale);
  let h = Math.round(img.height * scale);
  if (w > size || h > size) {
    const ratio = Math.min(size / w, size / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  w = Math.max(1, Math.min(size, w));
  h = Math.max(1, Math.min(size, h));

  const scaled = resize(img, w, h);
  const padX = Math.floor((size - w) / 2);
  const padY = Math.floor((size - h) / 2);

  // Filled with 0, matching the reference. After the inversion step the page is
  // the dark value, so black padding reads as more background rather than ink.
  const out = createImage(size, size, 0);
  for (let y = 0; y < h; y++) {
    const src = y * w * 4;
    const dst = ((y + padY) * size + padX) * 4;
    out.data.set(scaled.data.subarray(src, src + w * 4), dst);
  }
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  return out;
}

/**
 * Full chain: grey, invert if needed, crop to the ink, letterbox to 384 square,
 * then normalise to the model's expected distribution.
 */
export function toModelTensor(source: RasterImage, size = MODEL_INPUT_SIZE): ModelTensor {
  let levels = toGreyLevels(source);
  let width = source.width;
  let height = source.height;

  levels = reverseColor(levels);

  const bounds = marginBounds(levels, width, height);
  let image = levelsToImage(levels, width, height);
  if (bounds) {
    image = cropTo(image, bounds);
    width = image.width;
    height = image.height;
  } else {
    image = cloneImage(image);
  }

  const boxed = letterbox(image, size);
  const data = new Float32Array(size * size);
  for (let p = 0; p < data.length; p++) {
    data[p] = (boxed.data[p * 4]! / 255 - UNIMERNET_MEAN) / UNIMERNET_STD;
  }
  return { data, width: size, height: size };
}
