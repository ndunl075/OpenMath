import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { Rect } from "@openmath/ocr";
import { CATEGORIES, LIGHTINGS, SKEWS } from "./types.js";
import type { Category, Corpus, CorpusItem, Lighting, ManifestEntry, Skew } from "./types.js";

export const MANIFEST_NAME = "manifest.jsonl";

/** A manifest line that survived validation, still tied to where it came from. */
export interface LabelledEntry extends ManifestEntry {
  /** 1-based line in manifest.jsonl. */
  line: number;
}

export interface ManifestProblem {
  /** 1-based line in manifest.jsonl, or 0 for a problem with the file as a whole. */
  line: number;
  message: string;
}

export class CorpusError extends Error {
  readonly problems: ManifestProblem[];
  constructor(dir: string, problems: ManifestProblem[]) {
    const detail = problems
      .map((p) => (p.line > 0 ? `  line ${p.line}: ${p.message}` : `  ${p.message}`))
      .join("\n");
    super(`${problems.length} problem${problems.length === 1 ? "" : "s"} in ${dir}:\n${detail}`);
    this.name = "CorpusError";
    this.problems = problems;
  }
}

const KNOWN_KEYS = new Set(["file", "latex", "category", "notes", "lighting", "skew", "crop", "answer"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCrop(value: unknown, report: (message: string) => void): Rect | null {
  if (!isRecord(value)) {
    report('"crop" must be an object with x, y, width and height in source pixels');
    return null;
  }
  const numbers: Record<string, number> = {};
  for (const key of ["x", "y", "width", "height"]) {
    const n = value[key];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      report(`"crop.${key}" must be a number`);
      return null;
    }
    numbers[key] = n;
  }
  const rect = numbers as unknown as Rect;
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) {
    report('"crop" must have non-negative x and y and positive width and height');
    return null;
  }
  return rect;
}

/**
 * Parse manifest.jsonl without touching the disk, collecting every problem
 * rather than stopping at the first. Someone labelling twenty photos wants one
 * list of what to fix, not twenty runs.
 */
export function parseManifest(text: string): {
  entries: LabelledEntry[];
  problems: ManifestProblem[];
} {
  const entries: LabelledEntry[] = [];
  const problems: ManifestProblem[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();
    // Blank lines and # comments: this file is written by hand, one line per photo.
    if (!trimmed || trimmed.startsWith("#")) return;

    const report = (message: string): void => {
      problems.push({ line, message });
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      report(`not valid JSON (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    if (!isRecord(parsed)) {
      report("each line must be a JSON object");
      return;
    }

    for (const key of Object.keys(parsed)) {
      if (!KNOWN_KEYS.has(key)) {
        report(`unknown field "${key}"; expected one of ${[...KNOWN_KEYS].join(", ")}`);
      }
    }

    const file = parsed["file"];
    const latex = parsed["latex"];
    const category = parsed["category"];
    let ok = true;

    if (typeof file !== "string" || !file.trim()) {
      report('"file" must be the image filename');
      ok = false;
    } else if (isAbsolute(file) || file.split(/[\\/]/).includes("..")) {
      report('"file" must be relative to the corpus directory');
      ok = false;
    } else {
      const first = seen.get(file);
      if (first !== undefined) {
        report(`"${file}" is already labelled on line ${first}`);
        ok = false;
      }
      seen.set(file, line);
    }

    if (typeof latex !== "string" || !latex.trim()) {
      report('"latex" must be the ground-truth LaTeX for the photo');
      ok = false;
    }

    if (typeof category !== "string" || !CATEGORIES.includes(category as Category)) {
      report(`"category" must be one of ${CATEGORIES.join(", ")}`);
      ok = false;
    }

    for (const key of ["notes", "answer"] as const) {
      if (parsed[key] !== undefined && typeof parsed[key] !== "string") {
        report(`"${key}" must be a string`);
        ok = false;
      }
    }

    const lighting = parsed["lighting"];
    if (lighting !== undefined && !LIGHTINGS.includes(lighting as Lighting)) {
      report(`"lighting" must be one of ${LIGHTINGS.join(", ")}`);
      ok = false;
    }

    const skew = parsed["skew"];
    if (skew !== undefined && !SKEWS.includes(skew as Skew)) {
      report(`"skew" must be one of ${SKEWS.join(", ")}`);
      ok = false;
    }

    let crop: Rect | null = null;
    if (parsed["crop"] !== undefined) {
      crop = readCrop(parsed["crop"], report);
      if (!crop) ok = false;
    }

    if (!ok) return;

    entries.push({
      line,
      file: file as string,
      latex: latex as string,
      category: category as Category,
      ...(typeof parsed["notes"] === "string" ? { notes: parsed["notes"] } : {}),
      ...(typeof parsed["answer"] === "string" ? { answer: parsed["answer"] } : {}),
      ...(lighting !== undefined ? { lighting: lighting as Lighting } : {}),
      ...(skew !== undefined ? { skew: skew as Skew } : {}),
      ...(crop ? { crop } : {}),
    });
  });

  return { entries, problems };
}

/** Read a corpus directory, checking every labelled photo is actually there. */
export async function loadCorpus(dir: string): Promise<Corpus> {
  const root = resolve(dir);
  const manifestPath = join(root, MANIFEST_NAME);

  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    throw new CorpusError(root, [
      { line: 0, message: `no ${MANIFEST_NAME} here. See packages/bench/README.md for the format.` },
    ]);
  }

  const { entries, problems } = parseManifest(text);
  const items: CorpusItem[] = [];

  for (const entry of entries) {
    const path = join(root, entry.file);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("not a file");
    } catch {
      problems.push({ line: entry.line, message: `${entry.file} is labelled but missing from ${root}` });
      continue;
    }
    items.push({ ...entry, path });
  }

  if (problems.length > 0) throw new CorpusError(root, problems);
  if (items.length === 0) {
    throw new CorpusError(root, [{ line: 0, message: `${MANIFEST_NAME} has no entries` }]);
  }

  return { dir: root, items };
}
