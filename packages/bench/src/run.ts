import { cropTo, preprocess } from "@openmath/ocr";
import type { OcrProvider, PreprocessOptions, RasterImage } from "@openmath/ocr";
import { aggregate, aggregateByCategory, scoreItem } from "./score.js";
import type { CorpusItem, ItemResult, ProviderRun } from "./types.js";

export interface RunOptions {
  provider: OcrProvider;
  items: readonly CorpusItem[];
  /** Decoding is injected so the scoring path can be exercised without image files. */
  loadImage: (item: CorpusItem) => Promise<RasterImage>;
  /** Off measures what the model does with an untouched photo, for A/B-ing the pipeline. */
  preprocessImages?: boolean;
  modelId?: string;
  device?: string;
  onItem?: (result: ItemResult, index: number, total: number) => void;
  /** Injectable clock, so timing-sensitive tests stay deterministic. */
  now?: () => number;
}

/** Thrown when the weights never arrived; the CLI turns this into advice. */
export class ModelLoadError extends Error {
  readonly provider: string;
  override readonly cause?: unknown;
  constructor(provider: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ModelLoadError";
    this.provider = provider;
    this.cause = cause;
  }
}

/**
 * Recognise every photo with one provider and score the results.
 *
 * Load time is measured once and kept out of the per-image numbers: a 20 MB
 * download is a first-run cost the user pays behind a progress bar, while
 * inference is what they wait for every single scan.
 */
export async function runProvider(options: RunOptions): Promise<ProviderRun> {
  const { provider, items, loadImage, onItem } = options;
  const now = options.now ?? (() => Date.now());
  const usePreprocess = options.preprocessImages ?? true;

  const loadStarted = now();
  try {
    await provider.load();
  } catch (cause) {
    throw new ModelLoadError(provider.id, cause);
  }
  const loadMs = now() - loadStarted;

  const results: ItemResult[] = [];
  for (const [index, item] of items.entries()) {
    // Decoding is not timed: in the app the frame arrives from the camera, so a
    // JPEG read off a disk is the harness's own cost, not the product's.
    const image = await loadImage(item);

    const preprocessStarted = now();
    // Mirror the worker: a provider with its own pipeline gets the crop and
    // nothing else, so a benched score reflects what the app actually sends.
    const prepared = provider.ownsPreprocessing
      ? item.crop
        ? cropTo(image, item.crop)
        : image
      : usePreprocess
        ? preprocess(image, { ...(item.crop ? { crop: item.crop } : {}) } satisfies PreprocessOptions)
        : image;
    const preprocessMs = now() - preprocessStarted;

    let raw = "";
    let error: string | undefined;
    const started = now();
    try {
      // The raw emission, not the provider's own normalised `latex`: every
      // provider then gets normalised by the same code before it is scored.
      raw = (await provider.recognize(prepared)).raw;
    } catch (e) {
      // One unreadable photo must not lose the other 199 results.
      error = e instanceof Error ? e.message : String(e);
    }
    const ms = now() - started;

    const result: ItemResult = {
      file: item.file,
      category: item.category,
      ...(item.lighting ? { lighting: item.lighting } : {}),
      ...(item.skew ? { skew: item.skew } : {}),
      raw,
      ...scoreItem(item.latex, raw),
      ms,
      preprocessMs,
      ...(error ? { error } : {}),
    };
    results.push(result);
    onItem?.(result, index, items.length);
  }

  return {
    provider: provider.id,
    label: provider.label,
    license: provider.license,
    ...(options.modelId ? { modelId: options.modelId } : {}),
    ...(options.device ? { device: options.device } : {}),
    loadMs,
    overall: aggregate(results),
    byCategory: aggregateByCategory(results),
    items: results,
  };
}
