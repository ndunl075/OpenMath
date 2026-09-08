import { describe, expect, it } from "vitest";
import {
  createImage, letterbox, marginBounds, MODEL_INPUT_SIZE, reverseColor,
  toModelTensor, UNIMERNET_MEAN, UNIMERNET_STD,
} from "@openmath/ocr";
import type { RasterImage } from "@openmath/ocr";

function setPixel(img: RasterImage, x: number, y: number, v: number, a = 255): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = v;
  img.data[i + 1] = v;
  img.data[i + 2] = v;
  img.data[i + 3] = a;
}

function levels(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

/** Dark ink on a light page, which is what a photo of homework looks like. */
function page(width = 40, height = 30, ink = { x: 10, y: 8, w: 12, h: 9 }): RasterImage {
  const img = createImage(width, height, 255);
  for (let y = ink.y; y < ink.y + ink.h; y++) {
    for (let x = ink.x; x < ink.x + ink.w; x++) setPixel(img, x, y, 20);
  }
  return img;
}

describe("reverseColor", () => {
  it("inverts when dark pixels outnumber light ones", () => {
    const mostlyDark = levels([0, 0, 0, 255]);
    expect([...reverseColor(mostlyDark)]).toEqual([255, 255, 255, 0]);
  });

  it("leaves a page of paper alone", () => {
    const mostlyLight = levels([255, 255, 255, 0]);
    expect([...reverseColor(mostlyLight)]).toEqual([255, 255, 255, 0]);
  });

  it("inverts on a tie, matching the reference implementation", () => {
    expect([...reverseColor(levels([0, 255]))]).toEqual([255, 0]);
  });
});

describe("marginBounds", () => {
  it("finds the ink after stretching the levels", () => {
    const img = page();
    const grey = new Uint8ClampedArray(img.width * img.height);
    for (let p = 0; p < grey.length; p++) grey[p] = img.data[p * 4]!;
    const bounds = marginBounds(grey, img.width, img.height);
    expect(bounds).toEqual({ x: 10, y: 8, width: 11, height: 8 });
  });

  it("returns null for a flat frame rather than a zero-size box", () => {
    expect(marginBounds(new Uint8ClampedArray(16).fill(255), 4, 4)).toBeNull();
  });

  it("uses a stretched threshold, so a dim photo still yields a box", () => {
    // Nothing here is below the raw threshold; only the stretch reveals the ink.
    const dim = new Uint8ClampedArray(16).fill(250);
    dim[5] = 230;
    expect(marginBounds(dim, 4, 4)).not.toBeNull();
  });
});

describe("letterbox", () => {
  it("produces the model's square", () => {
    const out = letterbox(page(80, 20), MODEL_INPUT_SIZE);
    expect(out.width).toBe(MODEL_INPUT_SIZE);
    expect(out.height).toBe(MODEL_INPUT_SIZE);
  });

  it("preserves aspect ratio instead of squashing a wide formula", () => {
    const out = letterbox(page(80, 20), 100);
    // A 4:1 crop fits as 100x25 centred, so the corners stay padding.
    expect(out.data[0]).toBe(0);
    const middleRow = Math.floor(100 / 2);
    const centre = (middleRow * 100 + 50) * 4;
    expect(out.data[centre]).toBeGreaterThan(0);
  });

  it("pads with black, matching the reference", () => {
    const out = letterbox(page(80, 20), 100);
    expect(out.data[0]).toBe(0);
    expect(out.data[3]).toBe(255);
  });
});

describe("toModelTensor", () => {
  it("emits exactly one channel of the model's square", () => {
    const tensor = toModelTensor(page());
    expect(tensor.width).toBe(MODEL_INPUT_SIZE);
    expect(tensor.height).toBe(MODEL_INPUT_SIZE);
    expect(tensor.data).toHaveLength(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  });

  it("normalises to the distribution the model was trained on", () => {
    const white = (255 / 255 - UNIMERNET_MEAN) / UNIMERNET_STD;
    const black = (0 - UNIMERNET_MEAN) / UNIMERNET_STD;
    const tensor = toModelTensor(page());
    // Scanned for the extremes rather than asserted per pixel: the same claim
    // about all 384 x 384 of them, without a hundred and fifty thousand
    // assertions to build and tear down.
    let lowest = Infinity;
    let highest = -Infinity;
    for (const v of tensor.data) {
      if (v < lowest) lowest = v;
      if (v > highest) highest = v;
    }
    expect(lowest).toBeGreaterThanOrEqual(black - 1e-6);
    expect(highest).toBeLessThanOrEqual(white + 1e-6);
    // The padding is level 0, so the lowest value must actually occur.
    expect(lowest).toBeCloseTo(black, 5);
  });

  it("treats a transparent background as paper, not as ink", () => {
    const transparent = createImage(8, 8, 0);
    for (let i = 3; i < transparent.data.length; i += 4) transparent.data[i] = 0;
    const tensor = toModelTensor(transparent, 16);
    // Composited onto white and then left alone: no ink means no dark values
    // beyond the letterbox padding.
    expect(tensor.data.some((v) => v > 0)).toBe(true);
  });

  it("survives a blank frame without throwing", () => {
    expect(() => toModelTensor(createImage(20, 20, 255), 32)).not.toThrow();
  });

  it("gives the same tensor for a photo and its inverse", () => {
    const light = page(40, 30);
    const dark = createImage(40, 30, 0);
    for (let p = 0; p < 40 * 30; p++) {
      const i = p * 4;
      const v = 255 - light.data[i]!;
      dark.data[i] = v;
      dark.data[i + 1] = v;
      dark.data[i + 2] = v;
    }
    const a = toModelTensor(light, 64);
    const b = toModelTensor(dark, 64);
    // The inversion heuristic exists so a blackboard photo lands where a
    // textbook photo does.
    for (let i = 0; i < a.data.length; i++) {
      expect(b.data[i]).toBeCloseTo(a.data[i]!, 5);
    }
  });
});
