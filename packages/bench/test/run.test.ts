import { describe, expect, it } from "vitest";
import { createImage, normalizeLatex, OcrUnavailableError } from "@openmath/ocr";
import type { OcrProvider, OcrResult, RasterImage } from "@openmath/ocr";
import { ModelLoadError, runProvider } from "@openmath/bench";
import type { CorpusItem } from "@openmath/bench";

/**
 * A provider that reads from a lookup table instead of a model, which is the
 * whole point: the harness has to be measurable before any weights exist.
 */
function stubProvider(
  reads: Record<string, string>,
  options: { loadError?: Error; recognizeError?: Error } = {},
): OcrProvider & { seen: RasterImage[]; loads: number } {
  const order = Object.keys(reads);
  let index = 0;
  let loaded = false;
  const provider = {
    id: "stub",
    label: "Stub",
    license: "MIT",
    approximateBytes: 0,
    handwriting: "unknown" as const,
    seen: [] as RasterImage[],
    loads: 0,
    async load(): Promise<void> {
      provider.loads++;
      if (options.loadError) throw options.loadError;
      loaded = true;
    },
    isLoaded: () => loaded,
    async recognize(image: RasterImage): Promise<OcrResult> {
      provider.seen.push(image);
      if (options.recognizeError) throw options.recognizeError;
      const raw = reads[order[index++]!] ?? "";
      return { latex: normalizeLatex(raw), raw, ms: 1 };
    },
    dispose(): void {
      loaded = false;
    },
  };
  return provider;
}

function corpusItem(file: string, latex: string, over: Partial<CorpusItem> = {}): CorpusItem {
  return { file, latex, category: "printed", path: `/corpus/${file}`, line: 1, ...over };
}

/** Ten milliseconds per clock read, so every duration in a test is predictable. */
function fakeClock(): () => number {
  let t = 0;
  return () => (t += 10);
}

const loadImage = async (): Promise<RasterImage> => createImage(64, 32);

describe("running a provider over a corpus", () => {
  it("scores every photo and separates load time from inference", async () => {
    const items = [
      corpusItem("001.jpg", "2x + 3 = 7"),
      corpusItem("002.jpg", "3x = 12", { category: "handwritten" }),
      corpusItem("003.jpg", "x^{2} - 4 = 0", { category: "screen" }),
    ];
    const provider = stubProvider({
      "001.jpg": "2 \\cdot x + 3 = 7",
      "002.jpg": "3x = 12",
      "003.jpg": "x^{2} - 4 = O",
    });

    const run = await runProvider({ provider, items, loadImage, now: fakeClock() });

    expect(provider.loads).toBe(1);
    expect(run.loadMs).toBe(10);
    expect(run.items.map((i) => i.file)).toEqual(["001.jpg", "002.jpg", "003.jpg"]);

    expect(run.overall.n).toBe(3);
    expect(run.overall.exactMatch).toBe(1);
    // The \cdot read and the clean read both reach the right answer; the O for 0 does not.
    expect(run.overall.answerMatch).toBe(2);
    expect(run.overall.answerMatchRate).toBeCloseTo(2 / 3, 10);
    expect(run.overall.medianMs).toBe(10);
    expect(run.overall.p90Ms).toBe(10);
  });

  it("breaks the numbers down by category", async () => {
    const items = [
      corpusItem("001.jpg", "2x = 4"),
      corpusItem("002.jpg", "3x = 12", { category: "handwritten" }),
      corpusItem("003.jpg", "4x = 8", { category: "handwritten" }),
    ];
    const provider = stubProvider({
      "001.jpg": "2x = 4",
      "002.jpg": "3x = 12",
      "003.jpg": "4x = 3",
    });

    const run = await runProvider({ provider, items, loadImage, now: fakeClock() });

    expect(run.byCategory.printed?.answerMatchRate).toBe(1);
    expect(run.byCategory.handwritten?.answerMatchRate).toBe(0.5);
    expect(run.byCategory.screen).toBeUndefined();
  });

  it("preprocesses by default and hands over the raw photo when told not to", async () => {
    const items = [corpusItem("001.jpg", "2x = 4")];
    const reads = { "001.jpg": "2x = 4" };

    const preprocessed = stubProvider(reads);
    await runProvider({ provider: preprocessed, items, loadImage, now: fakeClock() });
    expect(preprocessed.seen[0]!.width).not.toBe(64);

    const raw = stubProvider(reads);
    await runProvider({ provider: raw, items, loadImage, preprocessImages: false, now: fakeClock() });
    expect(raw.seen[0]!.width).toBe(64);
  });

  it("records a recognition failure without losing the rest of the corpus", async () => {
    const items = [corpusItem("001.jpg", "2x = 4"), corpusItem("002.jpg", "3x = 9")];
    const provider = stubProvider({}, { recognizeError: new Error("out of memory") });

    const run = await runProvider({ provider, items, loadImage, now: fakeClock() });

    expect(run.items).toHaveLength(2);
    expect(run.items[0]!.error).toBe("out of memory");
    expect(run.items[0]!.raw).toBe("");
    expect(run.overall.errors).toBe(2);
    expect(run.overall.answerMatch).toBe(0);
  });

  it("reports progress per photo", async () => {
    const items = [corpusItem("001.jpg", "2x = 4"), corpusItem("002.jpg", "3x = 9")];
    const provider = stubProvider({ "001.jpg": "2x = 4", "002.jpg": "3x = 9" });
    const seen: string[] = [];

    await runProvider({
      provider,
      items,
      loadImage,
      now: fakeClock(),
      onItem: (result, index, total) => seen.push(`${index + 1}/${total} ${result.file}`),
    });

    expect(seen).toEqual(["1/2 001.jpg", "2/2 002.jpg"]);
  });

  it("turns a model that will not load into one clear error", async () => {
    const provider = stubProvider(
      {},
      { loadError: new OcrUnavailableError("Could not load the Texo model.") },
    );

    await expect(
      runProvider({ provider, items: [corpusItem("001.jpg", "2x = 4")], loadImage }),
    ).rejects.toBeInstanceOf(ModelLoadError);
    expect(provider.seen).toHaveLength(0);
  });
});
