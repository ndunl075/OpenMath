import { describe, expect, it } from "vitest";
import {
  contrastStretch, createImage, cropTo, fitWithin, inkBounds, invertIfDarkBackground,
  meanLuminance, otsuThreshold, padImage, preprocess, resize, toGrayscale,
} from "@openmath/ocr";
import type { RasterImage } from "@openmath/ocr";

function setPixel(img: RasterImage, x: number, y: number, v: number): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = v;
  img.data[i + 1] = v;
  img.data[i + 2] = v;
  img.data[i + 3] = 255;
}

/** A white page with a dark blob, which is what a cropped formula looks like. */
function pageWithInk(width = 40, height = 30, rect = { x: 10, y: 8, w: 12, h: 9 }): RasterImage {
  const img = createImage(width, height, 255);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) setPixel(img, x, y, 20);
  }
  return img;
}

describe("image operations", () => {
  it("creates an opaque white canvas", () => {
    const img = createImage(4, 3);
    expect(img.data).toHaveLength(4 * 3 * 4);
    expect(meanLuminance(img)).toBeCloseTo(255, 0);
    expect(img.data[3]).toBe(255);
  });

  it("converts to grey without changing perceived brightness much", () => {
    const img = createImage(2, 2, 128);
    const grey = toGrayscale(img);
    expect(grey.data[0]).toBe(grey.data[1]);
    expect(grey.data[1]).toBe(grey.data[2]);
  });

  it("finds the ink bounding box", () => {
    const img = pageWithInk();
    const bounds = inkBounds(img, 128);
    expect(bounds).toEqual({ x: 10, y: 8, width: 12, height: 9 });
  });

  it("returns null for a blank frame instead of a zero-size box", () => {
    expect(inkBounds(createImage(10, 10, 255), 128)).toBeNull();
  });

  it("separates ink from paper with Otsu", () => {
    const threshold = otsuThreshold(pageWithInk());
    expect(threshold).toBeGreaterThan(20);
    expect(threshold).toBeLessThan(255);
  });

  it("inverts a photo of a dark background", () => {
    const dark = createImage(8, 8, 20);
    const fixed = invertIfDarkBackground(dark);
    expect(meanLuminance(fixed)).toBeGreaterThan(200);
  });

  it("leaves a light photo alone", () => {
    const light = createImage(8, 8, 240);
    expect(meanLuminance(invertIfDarkBackground(light))).toBeCloseTo(240, 0);
  });

  it("stretches a low-contrast image toward full range", () => {
    const flat = createImage(20, 20, 120);
    for (let x = 0; x < 20; x++) setPixel(flat, x, 0, 100);
    const stretched = contrastStretch(flat);
    const values = new Set([...stretched.data.filter((_, i) => i % 4 === 0)]);
    expect(values.size).toBeGreaterThan(1);
  });

  it("crops within bounds and clamps a rectangle that runs off the edge", () => {
    const img = pageWithInk();
    expect(cropTo(img, { x: 10, y: 8, width: 12, height: 9 })).toMatchObject({
      width: 12, height: 9,
    });
    const clamped = cropTo(img, { x: 35, y: 25, width: 100, height: 100 });
    expect(clamped.width).toBe(5);
    expect(clamped.height).toBe(5);
  });

  it("pads with white", () => {
    const padded = padImage(createImage(4, 4, 0), 3);
    expect(padded.width).toBe(10);
    expect(padded.height).toBe(10);
    expect(padded.data[0]).toBe(255);
  });

  it("resizes and preserves overall brightness", () => {
    const img = pageWithInk(40, 30);
    const small = resize(img, 20, 15);
    expect(small.width).toBe(20);
    expect(small.height).toBe(15);
    expect(Math.abs(meanLuminance(small) - meanLuminance(img))).toBeLessThan(25);
  });

  it("scales down to fit but never up", () => {
    const img = createImage(200, 100);
    expect(fitWithin(img, 100, 100).width).toBe(100);
    expect(fitWithin(img, 400, 400).width).toBe(200);
  });
});

describe("preprocess", () => {
  it("trims to the ink and pads it", () => {
    const img = pageWithInk(80, 60, { x: 20, y: 15, w: 20, h: 12 });
    const out = preprocess(img, { padding: 5, autoTrim: true, maxWidth: 1000, maxHeight: 1000 });
    expect(out.width).toBe(20 + 10);
    expect(out.height).toBe(12 + 10);
  });

  it("honours the viewfinder crop", () => {
    const img = pageWithInk(80, 60, { x: 20, y: 15, w: 20, h: 12 });
    const out = preprocess(img, {
      crop: { x: 0, y: 0, width: 10, height: 10 },
      autoTrim: false, padding: 0,
    });
    expect(out.width).toBe(10);
    expect(out.height).toBe(10);
  });

  it("fits inside the model window", () => {
    const img = pageWithInk(4000, 1200, { x: 100, y: 100, w: 3000, h: 900 });
    const out = preprocess(img, { maxWidth: 1024, maxHeight: 384 });
    expect(out.width).toBeLessThanOrEqual(1024);
    expect(out.height).toBeLessThanOrEqual(384);
  });

  it("survives a blank frame without throwing", () => {
    const out = preprocess(createImage(50, 50, 255));
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });
});
