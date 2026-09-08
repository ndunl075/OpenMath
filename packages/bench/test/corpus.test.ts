import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CorpusError, loadCorpus, parseManifest } from "@openmath/bench";

const GOOD = '{"file": "001.jpg", "latex": "2x + 3 = 7", "category": "printed"}';

describe("manifest parsing", () => {
  it("reads a labelled photo", () => {
    const { entries, problems } = parseManifest(GOOD);
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { line: 1, file: "001.jpg", latex: "2x + 3 = 7", category: "printed" },
    ]);
  });

  it("keeps the optional fields", () => {
    const line = JSON.stringify({
      file: "002.jpg",
      latex: "3x = 12",
      category: "handwritten",
      notes: "pencil, squared paper",
      lighting: "dim",
      skew: "slight",
      answer: "x = 4",
      crop: { x: 10, y: 20, width: 300, height: 90 },
    });
    const { entries, problems } = parseManifest(line);
    expect(problems).toEqual([]);
    expect(entries[0]!.lighting).toBe("dim");
    expect(entries[0]!.skew).toBe("slight");
    expect(entries[0]!.crop).toEqual({ x: 10, y: 20, width: 300, height: 90 });
  });

  it("skips blank lines and comments, and numbers the rest by their real line", () => {
    const { entries, problems } = parseManifest(`# twenty photos, 2026-09-08\n\n${GOOD}\n`);
    expect(problems).toEqual([]);
    expect(entries[0]!.line).toBe(3);
  });

  it("collects every problem instead of stopping at the first", () => {
    const text = [
      "not json at all",
      '{"file": "002.jpg", "category": "printed"}',
      '{"file": "003.jpg", "latex": "x = 1", "category": "polaroid"}',
    ].join("\n");
    const { entries, problems } = parseManifest(text);
    expect(entries).toEqual([]);
    expect(problems.map((p) => p.line)).toEqual([1, 2, 3]);
    expect(problems[1]!.message).toContain("latex");
    expect(problems[2]!.message).toContain("printed, handwritten, screen");
  });

  it("rejects a photo labelled twice, naming the earlier line", () => {
    const { problems } = parseManifest(`${GOOD}\n${GOOD}`);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.line).toBe(2);
    expect(problems[0]!.message).toContain("line 1");
  });

  it("rejects a misspelled field rather than silently ignoring it", () => {
    const { problems } = parseManifest(
      '{"file": "001.jpg", "latex": "x = 1", "category": "printed", "lighitng": "dim"}',
    );
    expect(problems[0]!.message).toContain('unknown field "lighitng"');
  });

  it("rejects a file path that escapes the corpus directory", () => {
    const { problems } = parseManifest(
      '{"file": "../../etc/passwd", "latex": "x = 1", "category": "printed"}',
    );
    expect(problems[0]!.message).toContain("relative to the corpus directory");
  });

  it("rejects a crop that is not four numbers", () => {
    const { problems } = parseManifest(
      '{"file": "001.jpg", "latex": "x = 1", "category": "printed", "crop": {"x": 0, "y": 0, "width": "wide", "height": 10}}',
    );
    expect(problems[0]!.message).toContain("crop.width");
  });
});

async function corpusDir(manifest: string, files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openmath-bench-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.jsonl"), manifest, "utf8");
  for (const file of files) await writeFile(join(dir, file), "not really a jpeg", "utf8");
  return dir;
}

describe("loading a corpus directory", () => {
  it("resolves each photo to a path on disk", async () => {
    const dir = await corpusDir(GOOD, ["001.jpg"]);
    const corpus = await loadCorpus(dir);
    expect(corpus.items).toHaveLength(1);
    expect(corpus.items[0]!.path).toBe(join(dir, "001.jpg"));
  });

  it("complains about a labelled photo that is not there", async () => {
    const dir = await corpusDir(GOOD, []);
    await expect(loadCorpus(dir)).rejects.toThrow(/001\.jpg is labelled but missing/);
  });

  it("says where the format is documented when there is no manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openmath-bench-"));
    await expect(loadCorpus(dir)).rejects.toThrow(/README/);
  });

  it("refuses an empty manifest", async () => {
    const dir = await corpusDir("# nothing yet\n", []);
    await expect(loadCorpus(dir)).rejects.toBeInstanceOf(CorpusError);
  });
});
