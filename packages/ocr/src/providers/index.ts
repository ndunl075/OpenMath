import type { OcrProvider } from "../types.js";
import { createTransformersProvider, type TransformersProviderConfig } from "./transformers.js";

export * from "./transformers.js";

/**
 * The models we can swap between. This list is the whole licence decision from
 * ARCHITECTURE section 9: Texo is the accuracy pick but is AGPL-3.0, and the
 * others are permissive. Nothing above the OcrProvider interface changes when
 * the default moves.
 *
 * Sizes are the published figures for the quantised builds and should be
 * re-measured on device during the OCR bench, which is build-order step 2.
 */
export const PROVIDER_CONFIGS: Record<string, TransformersProviderConfig> = {
  texo: {
    id: "texo",
    label: "Texo",
    license: "AGPL-3.0",
    modelId: "alephpi/Texo",
    approximateBytes: 22 * 1024 * 1024,
    handwriting: "good",
    dtype: "q8",
    maxNewTokens: 512,
  },
  texteller: {
    id: "texteller",
    label: "TexTeller",
    license: "Apache-2.0",
    modelId: "onnx-community/TexTeller-ONNX",
    approximateBytes: 90 * 1024 * 1024,
    handwriting: "fair",
    dtype: "q8",
    maxNewTokens: 512,
  },
  "pix2text-mfr": {
    id: "pix2text-mfr",
    label: "Pix2Text MFR",
    license: "MIT",
    modelId: "breezedeus/pix2text-mfr-1.5",
    approximateBytes: 120 * 1024 * 1024,
    handwriting: "fair",
    dtype: "fp32",
    maxNewTokens: 512,
  },
};

/**
 * Texo has the best published handwriting score of the three, which is the
 * subset students actually photograph. Switching to `pix2text-mfr` is the
 * all-permissive path if AGPL turns out to be unacceptable.
 */
export const DEFAULT_PROVIDER_ID = "texo";

const cache = new Map<string, OcrProvider>();

export function getProvider(id: string = DEFAULT_PROVIDER_ID): OcrProvider {
  const cached = cache.get(id);
  if (cached) return cached;
  const config = PROVIDER_CONFIGS[id];
  if (!config) throw new Error(`unknown OCR provider: ${id}`);
  const provider = createTransformersProvider(config);
  cache.set(id, provider);
  return provider;
}

export function listProviders(): TransformersProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS);
}

/** Drop cached providers, releasing their model handles. */
export function resetProviders(): void {
  for (const provider of cache.values()) provider.dispose();
  cache.clear();
}
