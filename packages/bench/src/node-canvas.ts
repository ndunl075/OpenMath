import sharp from "sharp";

/**
 * A canvas for Node, just wide enough for the recognition path.
 *
 * `packages/ocr` hands the model a canvas, because in the browser that is what
 * both ends already speak. Node has neither OffscreenCanvas nor ImageData, so
 * the bench installs these two shims before loading a provider.
 *
 * The unobvious part: transformers.js only calls `fromCanvas` in a browser and
 * throws in Node, but it decodes a Blob with sharp. So the shim canvas *is* a
 * Blob whose bytes are a PNG of what was drawn into it, and the library takes
 * its Node path without knowing a canvas was involved. If a future version
 * changes how it reads its input, this class is the one seam to fix.
 */
class NodeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace = "srgb";
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class NodeCanvas extends Blob {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    super([]);
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext(kind: string): unknown {
    if (kind !== "2d") return null;
    return {
      putImageData: (image: NodeImageData): void => {
        this.pixels.set(image.data.subarray(0, this.pixels.length));
      },
      getImageData: (): NodeImageData => new NodeImageData(this.pixels, this.width, this.height),
    };
  }

  /**
   * PNG rather than raw pixels because the consumer sniffs the format. The
   * round trip costs a few milliseconds against hundreds for inference, and it
   * keeps the shim to one method.
   */
  override async arrayBuffer(): Promise<ArrayBuffer> {
    const png = await sharp(Buffer.from(this.pixels.buffer, this.pixels.byteOffset, this.pixels.length), {
      raw: { width: this.width, height: this.height, channels: 4 },
    })
      .png()
      .toBuffer();
    return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  }
}

/** Install the shims, unless something real is already there. Safe to call twice. */
export function installNodeCanvas(): void {
  const global = globalThis as Record<string, unknown>;
  if (global["OffscreenCanvas"] === undefined) {
    Object.defineProperty(globalThis, "OffscreenCanvas", { value: NodeCanvas, configurable: true, writable: true });
  }
  if (global["ImageData"] === undefined) {
    Object.defineProperty(globalThis, "ImageData", { value: NodeImageData, configurable: true, writable: true });
  }
}

export { NodeCanvas, NodeImageData };
