import { normalizeWithReport } from "../normalize.js";
import type { LoadProgress, OcrProvider, OcrResult, RasterImage } from "../types.js";
import { OcrUnavailableError } from "../types.js";
import { toCanvas } from "../canvas.js";

export interface TransformersProviderConfig {
  id: string;
  label: string;
  license: string;
  /** Repository id on the model host, e.g. "onnx-community/TexTeller-ONNX". */
  modelId: string;
  approximateBytes: number;
  handwriting: "good" | "fair" | "unknown";
  /** Quantisation. q8 keeps the download small enough for a phone. */
  dtype?: "q8" | "int8" | "fp16" | "fp32";
  device?: "wasm" | "webgpu" | "auto";
  maxNewTokens?: number;
  /**
   * Where weights are fetched from. Configurable so a host change is a one-line
   * fix, per the provider-agnostic requirement in ARCHITECTURE section 13.
   */
  remoteHost?: string;
  remotePathTemplate?: string;
}

type Pipeline = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;

function readGeneratedText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const text = readGeneratedText(item);
      if (text) return text;
    }
    return "";
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["generated_text", "text", "label"]) {
      const value = record[key];
      if (typeof value === "string") return value;
      if (Array.isArray(value)) {
        const nested = readGeneratedText(value);
        if (nested) return nested;
      }
    }
  }
  return "";
}

/**
 * A provider backed by transformers.js. The library is imported dynamically so
 * it lands in its own chunk and is fetched only when someone actually scans,
 * which keeps the first paint small for people who only ever type.
 */
export function createTransformersProvider(config: TransformersProviderConfig): OcrProvider {
  let pipe: Pipeline | null = null;
  let loading: Promise<void> | null = null;

  const load = async (onProgress?: (p: LoadProgress) => void): Promise<void> => {
    if (pipe) return;
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

      const pipeline = lib.pipeline as
        | ((task: string, model: string, options?: Record<string, unknown>) => Promise<Pipeline>)
        | undefined;
      if (!pipeline) {
        throw new OcrUnavailableError("The recognition library is missing its pipeline API.");
      }

      onProgress?.({ fraction: null, loadedBytes: 0, totalBytes: null, status: "downloading" });

      try {
        pipe = await pipeline("image-to-text", config.modelId, {
          dtype: config.dtype ?? "q8",
          device: config.device ?? "wasm",
          progress_callback: (raw: unknown) => {
            const p = (raw ?? {}) as Record<string, unknown>;
            const loaded = typeof p.loaded === "number" ? p.loaded : 0;
            const total = typeof p.total === "number" ? p.total : null;
            const status = p.status === "ready" || p.status === "done" ? "initialising" : "downloading";
            onProgress?.({
              fraction: total ? Math.min(1, loaded / total) : null,
              loadedBytes: loaded,
              totalBytes: total,
              ...(typeof p.file === "string" ? { file: p.file } : {}),
              status,
            });
          },
        });
      } catch (cause) {
        throw new OcrUnavailableError(
          `Could not load the ${config.label} model. Check your connection, or type the problem in instead.`,
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
    load,
    isLoaded: () => pipe !== null,
    async recognize(image: RasterImage): Promise<OcrResult> {
      if (!pipe) await load();
      if (!pipe) throw new OcrUnavailableError("The recognition model is not loaded.");
      const started = Date.now();
      const canvas = toCanvas(image);
      const output = await pipe(canvas, { max_new_tokens: config.maxNewTokens ?? 512 });
      const raw = readGeneratedText(output);
      const { latex } = normalizeWithReport(raw);
      return { latex, raw, ms: Date.now() - started };
    },
    dispose() {
      pipe = null;
    },
  };
}
