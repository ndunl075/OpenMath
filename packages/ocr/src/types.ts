/** A decoded image as plain RGBA bytes, so the pipeline works without a DOM. */
export interface RasterImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrResult {
  /** Normalised LaTeX, ready to parse. */
  latex: string;
  /** Exactly what the model emitted, kept for the report flow. */
  raw: string;
  /** 0..1 when the model reports one. */
  confidence?: number;
  /** Wall-clock inference time in milliseconds. */
  ms: number;
}

export interface LoadProgress {
  /** 0..1, or null while the total size is unknown. */
  fraction: number | null;
  loadedBytes: number;
  totalBytes: number | null;
  file?: string;
  status: "downloading" | "initialising" | "ready";
}

/**
 * The seam the rest of the app codes against. Nothing above this interface
 * knows which model is loaded, which is what makes swapping the model (and
 * therefore the licence, per ARCHITECTURE section 9) a one-line change.
 */
export interface OcrProvider {
  readonly id: string;
  readonly label: string;
  readonly license: string;
  /** Rough download size in bytes, shown before the first scan. */
  readonly approximateBytes: number;
  readonly handwriting: "good" | "fair" | "unknown";
  load(onProgress?: (p: LoadProgress) => void): Promise<void>;
  isLoaded(): boolean;
  recognize(image: RasterImage): Promise<OcrResult>;
  dispose(): void;
}

export class OcrUnavailableError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "OcrUnavailableError";
    this.cause = cause;
  }
}
