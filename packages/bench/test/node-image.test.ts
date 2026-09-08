import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { toCanvas } from "@openmath/ocr";
import { decodeImage, installNodeCanvas } from "@openmath/bench";

/** Optional: the bench runs without it, but if it is here, check the real seam. */
const transformers = await import("@huggingface/transformers").catch(() => null);

async function writeImage(name: string, image: sharp.Sharp): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openmath-bench-"));
  const path = join(dir, name);
  await writeFile(path, await image.toBuffer());
  return path;
}

/** A 6x4 image with a distinctive first pixel, so orientation is visible. */
function swatch(): sharp.Sharp {
  const pixels = Buffer.alloc(6 * 4 * 3, 255);
  pixels[0] = 10;
  pixels[1] = 20;
  pixels[2] = 30;
  return sharp(pixels, { raw: { width: 6, height: 4, channels: 3 } });
}

describe("decoding a photo for the pipeline", () => {
  it("produces the RGBA shape packages/ocr expects", async () => {
    const path = await writeImage("swatch.png", swatch().png());
    const image = await decodeImage(path);

    expect(image.width).toBe(6);
    expect(image.height).toBe(4);
    expect(image.data).toHaveLength(6 * 4 * 4);
    expect([...image.data.slice(0, 4)]).toEqual([10, 20, 30, 255]);
  });

  it("applies the EXIF orientation phones set instead of rotating pixels", async () => {
    // Orientation 6 is a portrait photo stored landscape, which is what a phone
    // held upright hands over. Without honouring it every such photo reaches the
    // model on its side.
    const path = await writeImage("rotated.jpg", swatch().withMetadata({ orientation: 6 }).jpeg());
    const image = await decodeImage(path);

    expect(image.width).toBe(4);
    expect(image.height).toBe(6);
  });
});

describe("the Node canvas shim", () => {
  it("lets packages/ocr build a canvas outside a browser", () => {
    installNodeCanvas();
    const canvas = toCanvas({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray(new ArrayBuffer(8)).fill(200),
    });
    expect(canvas.width).toBe(2);
    expect(canvas.height).toBe(1);
  });

  it("hands the model an image transformers.js can read in Node", async () => {
    installNodeCanvas();
    const pixels = new Uint8ClampedArray(new ArrayBuffer(8 * 4 * 4));
    pixels.fill(200);
    const canvas = toCanvas({ width: 8, height: 4, data: pixels });

    // The seam: transformers.js refuses a canvas in Node but decodes a Blob,
    // so the shim canvas has to be one.
    expect(canvas).toBeInstanceOf(Blob);
    const decoded = await sharp(await (canvas as unknown as Blob).arrayBuffer()).metadata();
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(4);
    expect(decoded.format).toBe("png");
  });
});

describe.skipIf(!transformers)("against the real transformers.js", () => {
  it("accepts the shim canvas as model input", async () => {
    installNodeCanvas();
    const pixels = new Uint8ClampedArray(new ArrayBuffer(8 * 4 * 4));
    pixels.fill(200);

    // Exactly what createTransformersProvider passes to the pipeline.
    const image = await transformers!.RawImage.read(
      toCanvas({ width: 8, height: 4, data: pixels }) as never,
    );

    expect(image.width).toBe(8);
    expect(image.height).toBe(4);
    expect(image.data[0]).toBe(200);
  });
});
