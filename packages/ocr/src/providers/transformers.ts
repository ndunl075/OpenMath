import { normalizeWithReport } from "../normalize.js";
import { MODEL_INPUT_SIZE, toModelTensor } from "../texo-image.js";
import type { LoadProgress, OcrProvider, OcrResult, RasterImage } from "../types.js";
import { OcrUnavailableError } from "../types.js";

export interface TransformersProviderConfig {
  id: string;
  label: string;
  license: string;
  /** Repository id on the model host, e.g. "alephpi/FormulaNet". */
  modelId: string;
  approximateBytes: number;
  handwriting: "good" | "fair" | "unknown";
  /**
   * Weight precision. The published FormulaNet repo has no quantised export, so
   * asking for q8 makes the runtime request a file that does not exist.
   */
  dtype?: "q8" | "int8" | "fp16" | "fp32";
  device?: "wasm" | "webgpu" | "auto";
  maxNewTokens?: number;
  /** Model input square. */
  inputSize?: number;
  /**
   * Where weights are fetched from. Configurable so a host change is a one-line
   * fix, per the provider-agnostic requirement in ARCHITECTURE section 13.
   */
  remoteHost?: string;
  remotePathTemplate?: string;
}

interface LoadedModel {
  model: { generate(input: Record<string, unknown>): Promise<unknown> };
  tokenizer: { batch_decode(ids: unknown, options?: Record<string, unknown>): string[] };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  cat: (tensors: unknown[], dim: number) => unknown;
}

/**
 * A provider backed by transformers.js.
 *
 * Uses the model and tokenizer classes directly rather than the `image-to-text`
 * pipeline. The pipeline cannot load this model: its encoder is a custom
 * architecture with no registered image processor and the repository publishes
 * no preprocessor config, which is exactly why the reference browser app
 * hand-rolls the same two calls. Building the tensor ourselves also means the
 * provider needs no canvas, so it behaves identically in a worker, on the main
 * thread, and in Node under the bench.
 *
 * The library is imported dynamically so it lands in its own chunk and is
 * fetched only when someone actually scans.
 */
export function createTransformersProvider(config: TransformersProviderConfig): OcrProvider {
  let loaded: LoadedModel | null = null;
  let loading: Promise<void> | null = null;

  const load = async (onProgress?: (p: LoadProgress) => void): Promise<void> => {
    if (loaded) return;
    if (loading) return loading;

    loading = (async () => {
      let lib: Record<string, unknown>;
      try {
        lib = (await import(
          /* @vite-ignore */ "@huggingface/transformers"
        )) as unknown as Record<string, unknown>;
      } catch (cause) {
        throw new OcrUnavailableError(
          "The on-device recognition library could not be loaded. You can still type the problem in.",
          cause,
        );
      }

      const env = lib.env as Record<string, unknown> | undefined;
      if (env) {
        env.allowLocalModels = false;
        if (config.remoteHost) env.remoteHost = config.remoteHost;
        if (config.remotePathTemplate) env.remotePathTemplate = config.remotePathTemplate;
      }

      const VisionEncoderDecoderModel = lib.VisionEncoderDecoderModel as
        | { from_pretrained(id: string, options?: Record<string, unknown>): Promise<LoadedModel["model"]> }
        | undefined;
      const PreTrainedTokenizer = lib.PreTrainedTokenizer as
        | { from_pretrained(id: string, options?: Record<string, unknown>): Promise<LoadedModel["tokenizer"]> }
        | undefined;
      const Tensor = lib.Tensor as LoadedModel["Tensor"] | undefined;
      const cat = lib.cat as LoadedModel["cat"] | undefined;

      if (!VisionEncoderDecoderModel || !PreTrainedTokenizer || !Tensor || !cat) {
        throw new OcrUnavailableError(
          "The recognition library is missing the APIs this model needs.",
        );
      }

      onProgress?.({ fraction: null, loadedBytes: 0, totalBytes: null, status: "downloading" });

      try {
        const model = await VisionEncoderDecoderModel.from_pretrained(config.modelId, {
          dtype: config.dtype ?? "fp32",
          ...(config.device ? { device: config.device } : {}),
          progress_callback: (raw: unknown) => {
            const p = (raw ?? {}) as Record<string, unknown>;
            const bytes = typeof p.loaded === "number" ? p.loaded : 0;
            const total = typeof p.total === "number" ? p.total : null;
            onProgress?.({
              fraction: total ? Math.min(1, bytes / total) : null,
              loadedBytes: bytes,
              totalBytes: total,
              ...(typeof p.file === "string" ? { file: p.file } : {}),
              status: p.status === "ready" || p.status === "done" ? "initialising" : "downloading",
            });
          },
        });
        const tokenizer = await PreTrainedTokenizer.from_pretrained(config.modelId);
        loaded = { model, tokenizer, Tensor, cat };
      } catch (cause) {
        const detail = cause instanceof Error ? ` (${cause.message})` : "";
        throw new OcrUnavailableError(
          `Could not load the ${config.label} model from ${config.modelId}${detail}. Check your connection, or type the problem in instead.`,
          cause,
        );
      }

      onProgress?.({ fraction: 1, loadedBytes: 0, totalBytes: null, status: "ready" });
    })();

    try {
      await loading;
    } finally {
      loading = null;
    }
  };

  return {
    id: config.id,
    label: config.label,
    license: config.license,
    approximateBytes: config.approximateBytes,
    handwriting: config.handwriting,
    // The model's own chain runs inside recognize(); the generic one would
    // fight it, most visibly by inverting a second time.
    ownsPreprocessing: true,
    load,
    isLoaded: () => loaded !== null,
    async recognize(image: RasterImage): Promise<OcrResult> {
      if (!loaded) await load();
      const active = loaded;
      if (!active) throw new OcrUnavailableError("The recognition model is not loaded.");

      const started = Date.now();
      const size = config.inputSize ?? MODEL_INPUT_SIZE;
      const { data } = toModelTensor(image, size);
      const single = new active.Tensor("float32", data, [1, 1, size, size]);
      // The encoder wants three channels; the model is greyscale, so the one
      // channel is repeated rather than carrying colour that was never there.
      const pixel_values = active.cat([single, single, single], 1);

      const output = await active.model.generate({
        inputs: pixel_values,
        max_new_tokens: config.maxNewTokens ?? 512,
      });
      const decoded = active.tokenizer.batch_decode(output, { skip_special_tokens: true });
      const raw = decoded[0] ?? "";
      const { latex } = normalizeWithReport(raw);
      return { latex, raw, ms: Date.now() - started };
    },
    dispose() {
      loaded = null;
    },
  };
}
