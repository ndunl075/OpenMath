import type { RasterImage } from "./types.js";

/**
 * Bridges the pure pixel pipeline to the browser. Everything here is guarded so
 * the package still imports in Node, where the tests run.
 */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function hasCanvas(): boolean {
  return typeof OffscreenCanvas !== "undefined" || typeof document !== "undefined";
}

export function toCanvas(image: RasterImage): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get a 2d context");
    ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return canvas;
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get a 2d context");
    ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return canvas;
  }
  throw new Error("no canvas implementation available");
}

/** Decode anything the camera or a file picker hands us into raw pixels. */
export async function toRasterImage(
  source: ImageBitmap | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | Blob,
): Promise<RasterImage> {
  let bitmap: ImageBitmap;
  if (source instanceof Blob) {
    bitmap = await createImageBitmap(source);
  } else if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    bitmap = source;
  } else {
    bitmap = await createImageBitmap(source as CanvasImageSource);
  }

  const width = bitmap.width;
  const height = bitmap.height;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = (canvas as AnyCanvas).getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("could not get a 2d context");
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = new Uint8ClampedArray(new ArrayBuffer(imageData.data.length));
  data.set(imageData.data);
  return { width, height, data };
}

export async function toBlob(image: RasterImage, type = "image/png"): Promise<Blob> {
  const canvas = toCanvas(image);
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type });
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode the image"))),
      type,
    );
  });
}

export function toDataUrl(image: RasterImage): string {
  const canvas = toCanvas(image);
  if (canvas instanceof HTMLCanvasElement) return canvas.toDataURL("image/png");
  throw new Error("data URLs need a DOM canvas");
}
