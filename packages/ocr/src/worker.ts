/**
 * Runs recognition off the main thread so the camera preview never stutters
 * while a model is loading or generating, per ARCHITECTURE section 3.
 */
import { cropTo, preprocess, type PreprocessOptions } from "./image.js";
import { getProvider } from "./providers/index.js";
import type { LoadProgress, OcrResult, RasterImage } from "./types.js";

export type WorkerRequest =
  | { type: "load"; requestId: number; providerId?: string }
  | {
      type: "recognize";
      requestId: number;
      providerId?: string;
      image: RasterImage;
      options?: PreprocessOptions;
    }
  | { type: "dispose"; requestId: number };

export type WorkerResponse =
  | { type: "progress"; requestId: number; progress: LoadProgress }
  | { type: "loaded"; requestId: number }
  | { type: "result"; requestId: number; result: OcrResult; preprocessed: RasterImage }
  | { type: "error"; requestId: number; message: string; name: string }
  | { type: "disposed"; requestId: number };

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

async function handle(request: WorkerRequest): Promise<void> {
  const { requestId } = request;
  try {
    if (request.type === "load") {
      const provider = getProvider(request.providerId);
      await provider.load((progress) => post({ type: "progress", requestId, progress }));
      post({ type: "loaded", requestId });
      return;
    }

    if (request.type === "recognize") {
      const provider = getProvider(request.providerId);
      if (!provider.isLoaded()) {
        await provider.load((progress) => post({ type: "progress", requestId, progress }));
      }
      const options = request.options ?? {};
      // A provider with its own pipeline gets the viewfinder crop and nothing
      // else; see OcrProvider.ownsPreprocessing.
      const prepared = provider.ownsPreprocessing
        ? options.crop
          ? cropTo(request.image, options.crop)
          : request.image
        : preprocess(request.image, options);
      const result = await provider.recognize(prepared);
      post({ type: "result", requestId, result, preprocessed: prepared });
      return;
    }

    if (request.type === "dispose") {
      getProvider().dispose();
      post({ type: "disposed", requestId });
    }
  } catch (error) {
    post({
      type: "error",
      requestId,
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});
