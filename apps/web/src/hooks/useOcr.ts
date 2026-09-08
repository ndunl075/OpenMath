import { useCallback, useRef, useState } from "preact/hooks";
import {
  createWorkerClient, type LoadProgress, type OcrClient, type OcrResult,
  OcrUnavailableError, PROVIDER_CONFIGS, DEFAULT_PROVIDER_ID, toRasterImage,
} from "@openmath/ocr";
import type { Rect } from "@openmath/ocr";

export type OcrStatus =
  | { phase: "idle" }
  | { phase: "loading"; progress: LoadProgress }
  | { phase: "recognising" }
  | { phase: "error"; message: string };

export function useOcr(providerId: string = DEFAULT_PROVIDER_ID) {
  const clientRef = useRef<OcrClient | null>(null);
  const [status, setStatus] = useState<OcrStatus>({ phase: "idle" });

  const client = useCallback((): OcrClient => {
    if (!clientRef.current) {
      clientRef.current = createWorkerClient(
        () => new Worker(new URL("../ocr-worker.ts", import.meta.url), { type: "module" }),
        providerId,
      );
    }
    return clientRef.current;
  }, [providerId]);

  const recognize = useCallback(
    async (source: HTMLCanvasElement | Blob, crop?: Rect): Promise<OcrResult | null> => {
      try {
        const image = await toRasterImage(source);
        setStatus({ phase: "loading", progress: { fraction: null, loadedBytes: 0, totalBytes: null, status: "downloading" } });
        const { result } = await client().recognize(
          image,
          crop ? { crop } : {},
          (progress) => setStatus({ phase: "loading", progress }),
        );
        setStatus({ phase: "idle" });
        return result;
      } catch (error) {
        const message =
          error instanceof OcrUnavailableError
            ? error.message
            : "Recognition failed. You can type the problem in instead.";
        setStatus({ phase: "error", message });
        return null;
      }
    },
    [client],
  );

  const reset = useCallback(() => setStatus({ phase: "idle" }), []);

  return {
    status,
    recognize,
    reset,
    provider: PROVIDER_CONFIGS[providerId] ?? PROVIDER_CONFIGS[DEFAULT_PROVIDER_ID]!,
  };
}
