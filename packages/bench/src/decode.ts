import sharp from "sharp";
import type { RasterImage } from "@openmath/ocr";

/**
 * Decode a photo into the RGBA shape packages/ocr works in. `rotate()` with no
 * argument applies the EXIF orientation tag, which phones set instead of
 * rotating the pixels; without it every portrait photo reaches the model on its
 * side and the benchmark measures nothing but that.
 */
export async function decodeImage(path: string): Promise<RasterImage> {
  const { data, info } = await sharp(path)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8ClampedArray(new ArrayBuffer(info.width * info.height * 4));
  pixels.set(data.subarray(0, pixels.length));
  return { width: info.width, height: info.height, data: pixels };
}
