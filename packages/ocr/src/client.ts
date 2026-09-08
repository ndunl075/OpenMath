import type { PreprocessOptions } from "./image.js";
import type { LoadProgress, OcrProvider, OcrResult, RasterImage } from "./types.js";
import { OcrUnavailableError } from "./types.js";
import type { WorkerRequest, WorkerResponse } from "./worker.js";

/** Omit that distributes over a union, unlike the built-in. */
type RequestInit_ = WorkerRequest extends infer T
  ? T extends { requestId: number }
    ? Omit<T, "requestId">
    : never
  : never;

export interface OcrClient {
  load(onProgress?: (p: LoadProgress) => void): Promise<void>;
  recognize(
    image: RasterImage,
    options?: PreprocessOptions,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<{ result: OcrResult; preprocessed: RasterImage }>;
  dispose(): void;
}

/**
 * Talks to the recognition worker. Falls back to running in-process when
 * workers are unavailable, so the app still works rather than showing an error
 * a user cannot act on.
 */
export function createWorkerClient(
  createWorker: () => Worker,
  providerId?: string,
): OcrClient {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: never) => void;
      reject: (error: Error) => void;
      onProgress?: (p: LoadProgress) => void;
    }
  >();

  const ensure = (): Worker => {
    if (worker) return worker;
    worker = createWorker();
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = pending.get(message.requestId);
      if (!entry) return;
      if (message.type === "progress") {
        entry.onProgress?.(message.progress);
        return;
      }
      pending.delete(message.requestId);
      if (message.type === "error") {
        entry.reject(
          message.name === "OcrUnavailableError"
            ? new OcrUnavailableError(message.message)
            : new Error(message.message),
        );
        return;
      }
      (entry.resolve as (value: unknown) => void)(message);
    });
    worker.addEventListener("error", (event) => {
      for (const [, entry] of pending) {
        entry.reject(new OcrUnavailableError(event.message || "the recognition worker failed"));
      }
      pending.clear();
    });
    return worker;
  };

  const send = <T extends WorkerResponse>(
    request: RequestInit_,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<T> => {
    const requestId = nextId++;
    const w = ensure();
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, {
        resolve: resolve as (value: never) => void,
        reject,
        ...(onProgress ? { onProgress } : {}),
      });
      w.postMessage({ ...request, requestId } as WorkerRequest);
    });
  };

  return {
    async load(onProgress) {
      await send({ type: "load", ...(providerId ? { providerId } : {}) }, onProgress);
    },
    async recognize(image, options, onProgress) {
      const message = await send<Extract<WorkerResponse, { type: "result" }>>(
        {
          type: "recognize",
          image,
          ...(options ? { options } : {}),
          ...(providerId ? { providerId } : {}),
        },
        onProgress,
      );
      return { result: message.result, preprocessed: message.preprocessed };
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}

/** Same interface, no worker. Used as a fallback and in tests. */
export function createInProcessClient(provider: OcrProvider, preprocessFn: typeof import("./image.js").preprocess): OcrClient {
  return {
    load: (onProgress) => provider.load(onProgress),
    async recognize(image, options, onProgress) {
      if (!provider.isLoaded()) await provider.load(onProgress);
      const preprocessed = preprocessFn(image, options ?? {});
      const result = await provider.recognize(preprocessed);
      return { result, preprocessed };
    },
    dispose: () => provider.dispose(),
  };
}
