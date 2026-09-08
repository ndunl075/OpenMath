import { describe, expect, it } from "vitest";
import { createImage, normalizeLatex } from "@openmath/ocr";
import type { OcrProvider, OcrResult, RasterImage } from "@openmath/ocr";
import { diffResults, formatDiff, formatResults, runProvider } from "@openmath/bench";
import type { BenchResults, CorpusItem, ProviderRun } from "@openmath/bench";

function stubProvider(id: string, reads: Record<string, string>): OcrProvider {
  const order = Object.keys(reads);
  let index = 0;
  return {
    id,
    label: id === "texo" ? "Texo" : "TexTeller",
    license: "AGPL-3.0",
    approximateBytes: 0,
    handwriting: "good",
    async load(): Promise<void> {},
    isLoaded: () => true,
    async recognize(): Promise<OcrResult> {
      const raw = reads[order[index++]!] ?? "";
      return { latex: normalizeLatex(raw), raw, ms: 1 };
    },
    dispose(): void {},
  };
}

function items(): CorpusItem[] {
  return [
    { file: "001.jpg", latex: "2x + 3 = 7", category: "printed", path: "/c/001.jpg", line: 1 },
    { file: "002.jpg", latex: "3x = 12", category: "handwritten", path: "/c/002.jpg", line: 2 },
    { file: "003.jpg", latex: "x + 1 = 5", category: "handwritten", path: "/c/003.jpg", line: 3 },
  ];
}

async function run(id: string, reads: Record<string, string>): Promise<ProviderRun> {
  let t = 0;
  return runProvider({
    provider: stubProvider(id, reads),
    items: items(),
    loadImage: async (): Promise<RasterImage> => createImage(32, 16),
    now: () => (t += 10),
  });
}

function results(runs: ProviderRun[], generatedAt = "2026-09-01T10:00:00.000Z"): BenchResults {
  return {
    schema: 1,
    generatedAt,
    corpus: { dir: "/c", images: 3, byCategory: { printed: 1, handwritten: 2 }, unscorable: 0 },
    runs,
  };
}

describe("the printed report", () => {
  it("leads with the answer-match column and breaks the run down by category", async () => {
    const report = formatResults(
      results([
        await run("texo", {
          "001.jpg": "2 \\cdot x + 3 = 7",
          "002.jpg": "3x = 12",
          "003.jpg": "x + 1 = 6",
        }),
      ]),
    );

    const header = report.split("\n").find((l) => l.includes("category"))!;
    expect(header.indexOf("answer")).toBeLessThan(header.indexOf("exact"));
    expect(report).toContain("printed");
    expect(report).toContain("handwritten");
    // Two of three answers right overall, one of two handwritten.
    expect(report).toContain("66.7%");
    expect(report).toContain("50.0%");
    expect(report).toContain("model load");
  });

  it("lists the photos that missed, with what was read instead", async () => {
    const report = formatResults(
      results([await run("texo", { "001.jpg": "2x + 3 = 7", "002.jpg": "3x = 12", "003.jpg": "" })]),
    );
    expect(report).toContain("misses (1)");
    expect(report).toContain("003.jpg");
    expect(report).toContain("(nothing)");
  });

  it("caps the list of misses", async () => {
    const report = formatResults(
      results([await run("texo", { "001.jpg": "", "002.jpg": "", "003.jpg": "" })]),
      { misses: 1 },
    );
    expect(report).toContain("... 2 more, see results.json");
  });

  it("names a provider that never ran", async () => {
    const withFailure: BenchResults = {
      ...results([]),
      failures: [{ provider: "texteller", error: "the weights would not download" }],
    };
    expect(formatResults(withFailure)).toContain("texteller  did not run");
  });
});

describe("comparing against a baseline", () => {
  it("reports which photos a change fixed and which it broke", async () => {
    const before = results([
      await run("texo", { "001.jpg": "2x + 3 = 7", "002.jpg": "3x = 1", "003.jpg": "x + 1 = 5" }),
    ]);
    const after = results(
      [await run("texo", { "001.jpg": "2x + 3 = 9", "002.jpg": "3x = 12", "003.jpg": "x + 1 = 5" })],
      "2026-09-08T10:00:00.000Z",
    );

    const diff = diffResults(before, after);
    expect(diff.fixed.map((c) => c.file)).toEqual(["002.jpg"]);
    expect(diff.regressed.map((c) => c.file)).toEqual(["001.jpg"]);
    expect(diff.regressed[0]!.before).toBe("2x + 3 = 7");
    expect(diff.regressed[0]!.after).toBe("2x + 3 = 9");

    const printed = formatDiff(diff, before);
    expect(printed).toContain("regressed (1)");
    expect(printed).toContain("fixed (1): 002.jpg");
    // Same number of hits, so the headline rate did not move.
    expect(printed).toContain("66.7% (0.0)");
  });

  it("shows the delta on every metric it can compare", async () => {
    const before = results([await run("texo", { "001.jpg": "", "002.jpg": "", "003.jpg": "" })]);
    const after = results([
      await run("texo", { "001.jpg": "2x + 3 = 7", "002.jpg": "3x = 12", "003.jpg": "x + 1 = 5" }),
    ]);

    const printed = formatDiff(diffResults(before, after), before);
    expect(printed).toContain("+100.0");
    expect(printed).toContain("texo");
    expect(printed).toContain("handwritten");
  });

  it("says when a provider is only in one of the two runs", async () => {
    const before = results([await run("texo", { "001.jpg": "2x + 3 = 7" })]);
    const after = results([await run("texteller", { "001.jpg": "2x + 3 = 7" })]);

    const diff = diffResults(before, after);
    expect(diff.newProviders).toEqual(["texteller"]);
    expect(diff.missingProviders).toEqual(["texo"]);
    const printed = formatDiff(diff, before);
    expect(printed).toContain("not in the baseline: texteller");
    expect(printed).toContain("in the baseline but not run: texo");
  });
});
