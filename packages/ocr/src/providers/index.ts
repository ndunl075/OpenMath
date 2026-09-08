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
    // The Hub id is FormulaNet; "Texo" is the project and product name and has
    // no repository of its own. Confirmed against the reference browser app's
    // constants and the training repo's own push script.
    modelId: "alephpi/FormulaNet",
    // Encoder 51.7 MB + decoder 24.7 MB. The repository publishes no quantised
    // export, so this is the real download and dtype must stay fp32.
    approximateBytes: 76 * 1024 * 1024,
    handwriting: "good",
    dtype: "fp32",
    inputSize: 384,
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
