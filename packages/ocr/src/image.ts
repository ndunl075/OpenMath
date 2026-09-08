import type { RasterImage, Rect } from "./types.js";

/**
 * Pure pixel operations. Kept free of canvas and DOM so the preprocessing
 * chain is unit-testable and identical on the main thread, in a worker, and in
 * Node. ARCHITECTURE section 3 calls for plain canvas work rather than
 * OpenCV.js; this is that, minus the canvas.
 */

export function createImage(width: number, height: number, fill = 255): RasterImage {
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  data.fill(fill);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

export function cloneImage(img: RasterImage): RasterImage {
  const data = new Uint8ClampedArray(new ArrayBuffer(img.data.length));
  data.set(img.data);
  return { width: img.width, height: img.height, data };
}

/** Rec. 601 luma, written into all three channels. */
export function toGrayscale(img: RasterImage): RasterImage {
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    d[i] = y;
    d[i + 1] = y;
    d[i + 2] = y;
  }
  return out;
}

export function luminanceHistogram(img: RasterImage): Uint32Array {
  const hist = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
    hist[y] = (hist[y] ?? 0) + 1;
  }
  return hist;
}

export function meanLuminance(img: RasterImage): number {
  const d = img.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Stretch the middle of the histogram to full range, clipping the tails.
 * This is what rescues a photo taken in bad light, which is most of them.
 */
export function contrastStretch(img: RasterImage, lowPercent = 2, highPercent = 98): RasterImage {
  const hist = luminanceHistogram(img);
  const total = img.width * img.height;
  const lowCount = (total * lowPercent) / 100;
  const highCount = (total * highPercent) / 100;

  let acc = 0;
  let low = 0;
  let high = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= lowCount) {
      low = v;
      break;
    }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= highCount) {
      high = v;
      break;
    }
  }
  if (high <= low) return cloneImage(img);

  const scale = 255 / (high - low);
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      d[i + c] = (d[i + c]! - low) * scale;
    }
  }
  return out;
}

/**
 * Otsu's method: the luminance that best separates ink from paper.
 * Returns the first value of the lighter class, so `lum < threshold` is ink.
 */
export function otsuThreshold(img: RasterImage): number {
  const hist = luminanceHistogram(img);
  const total = img.width * img.height;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v]!;

  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let v = 0; v < 256; v++) {
    weightB += hist[v]!;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += v * hist[v]!;
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = v;
    }
  }
  return Math.min(255, best + 1);
}

/** Photos of a blackboard or a dark-mode screen arrive inverted. */
export function invertIfDarkBackground(img: RasterImage): RasterImage {
  if (meanLuminance(img) >= 110) return cloneImage(img);
  const out = cloneImage(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]!;
    d[i + 1] = 255 - d[i + 1]!;
    d[i + 2] = 255 - d[i + 2]!;
  }
  return out;
}

/** Bounding box of pixels darker than `threshold`, or null when the frame is blank. */
export function inkBounds(img: RasterImage, threshold: number): Rect | null {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
      if (lum < threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function cropTo(img: RasterImage, rect: Rect): RasterImage {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(Math.round(rect.width), img.width - x0));
  const h = Math.max(1, Math.min(Math.round(rect.height), img.height - y0));
  const out = createImage(w, h);
  for (let y = 0; y < h; y++) {
    const src = ((y + y0) * img.width + x0) * 4;
    out.data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return out;
}

export function padImage(img: RasterImage, padding: number, fill = 255): RasterImage {
  if (padding <= 0) return cloneImage(img);
  const out = createImage(img.width + padding * 2, img.height + padding * 2, fill);
  for (let y = 0; y < img.height; y++) {
    const src = y * img.width * 4;
    const dst = ((y + padding) * out.width + padding) * 4;
    out.data.set(img.data.subarray(src, src + img.width * 4), dst);
  }
  return out;
}

/** Bilinear resample. Good enough for a formula crop and cheap on a phone. */
export function resize(img: RasterImage, width: number, height: number): RasterImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createImage(w, h);
  const xRatio = img.width / w;
  const yRatio = img.height / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, (y + 0.5) * yRatio - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, (x + 0.5) * xRatio - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const fx = sx - x0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + c]!;
        const p10 = img.data[(y0 * img.width + x1) * 4 + c]!;
        const p01 = img.data[(y1 * img.width + x0) * 4 + c]!;
        const p11 = img.data[(y1 * img.width + x1) * 4 + c]!;
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out.data[o + c] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}

/** Scale down to fit a box, never up: upscaling adds no information. */
export function fitWithin(img: RasterImage, maxWidth: number, maxHeight: number): RasterImage {
  const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  if (scale >= 1) return cloneImage(img);
  return resize(img, img.width * scale, img.height * scale);
}

export interface PreprocessOptions {
  /** Region of the source the viewfinder selected. */
  crop?: Rect;
  /** Trim to the ink after cropping. */
  autoTrim?: boolean;
  /** White border added after trimming; models expect some margin. */
  padding?: number;
  maxWidth?: number;
  maxHeight?: number;
  contrast?: boolean;
}

/**
 * The full chain: crop to the viewfinder, normalise polarity, stretch contrast,
 * trim to the ink, pad, and scale into the model's window.
 */
export function preprocess(img: RasterImage, options: PreprocessOptions = {}): RasterImage {
  const {
    crop, autoTrim = true, padding = 16, maxWidth = 1024, maxHeight = 384, contrast = true,
  } = options;

  let out = crop ? cropTo(img, crop) : cloneImage(img);
  out = toGrayscale(out);
  out = invertIfDarkBackground(out);
  if (contrast) out = contrastStretch(out);

  if (autoTrim) {
    const threshold = Math.max(24, Math.min(230, otsuThreshold(out)));
    const bounds = inkBounds(out, threshold);
    if (bounds && bounds.width > 4 && bounds.height > 4) out = cropTo(out, bounds);
  }

  out = padImage(out, padding);
  out = fitWithin(out, maxWidth, maxHeight);
  return out;
}
