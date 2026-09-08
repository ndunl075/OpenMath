import type { Rect } from "@openmath/ocr";
import type { SolutionKind } from "@openmath/steps";

/**
 * Every shape the bench reads or writes. Kept in one file because results.json
 * is a file format: a run recorded today is compared against a run recorded
 * after a model swap or a fine-tune, possibly by a different version of this
 * package, so the fields have to be easy to see all at once.
 */

export type Category = "printed" | "handwritten" | "screen";
export type Lighting = "good" | "dim" | "glare" | "shadow";
export type Skew = "none" | "slight" | "strong";

export const CATEGORIES: readonly Category[] = ["printed", "handwritten", "screen"];
export const LIGHTINGS: readonly Lighting[] = ["good", "dim", "glare", "shadow"];
export const SKEWS: readonly Skew[] = ["none", "slight", "strong"];

/** One line of manifest.jsonl. */
export interface ManifestEntry {
  file: string;
  /** Ground-truth LaTeX, written by a human looking at the photo. */
  latex: string;
  category: Category;
  notes?: string;
  /**
   * `lighting` and `skew` exist because "handwriting is weak" and "photos taken
   * in bad light are weak" have different fixes: one is a fine-tune, the other
   * is preprocessing. Without these the bench can only say that something is
   * wrong.
   */
  lighting?: Lighting;
  skew?: Skew;
  /** Viewfinder rectangle in source pixels, for a photo that holds more than one problem. */
  crop?: Rect;
  /** Hand-written answer, cross-checked against the solver rather than used for scoring. */
  answer?: string;
}

export interface CorpusItem extends ManifestEntry {
  /** Absolute path to the image file. */
  path: string;
  /** 1-based manifest line, so every complaint points at a line to fix. */
  line: number;
}

export interface Corpus {
  dir: string;
  items: CorpusItem[];
}

/** Why the pipeline could not turn a LaTeX string into an answer. */
export type SolveFailure = "empty" | "out-of-scope" | "parse" | "unsupported" | "error";

/** What the shipped pipeline makes of one LaTeX string. */
export interface Reading {
  /** After normalizeLatex. */
  latex: string;
  solved: boolean;
  /** Mirrors the solver rather than restating it, so a new problem kind does not break the bench. */
  kind?: SolutionKind;
  variable?: string;
  /** The answer as the UI would render it. */
  answer?: string;
  /** One entry per solution; empty for an identity such as 5 = 5. */
  answers: string[];
  failure?: SolveFailure;
  failureMessage?: string;
}

export interface ItemScore {
  /** Ground truth, normalised. */
  expected: string;
  /** Model output, normalised. */
  predicted: string;
  exactMatch: boolean;
  editDistance: number;
  /** Code points in the ground truth, the denominator of `cer`. */
  referenceLength: number;
  cer: number;
  solvable: boolean;
  failure?: SolveFailure;
  /** True when the ground truth itself solves, i.e. answer match means something here. */
  scorable: boolean;
  /** Why the ground truth does not solve, when it does not. */
  unscorableReason?: SolveFailure;
  answerMatch: boolean;
  expectedAnswer?: string;
  predictedAnswer?: string;
}

export interface ItemResult extends ItemScore {
  file: string;
  category: Category;
  lighting?: Lighting;
  skew?: Skew;
  /** Exactly what the model emitted, before normalisation. */
  raw: string;
  /** Inference, measured by the harness so every provider is timed the same way. */
  ms: number;
  preprocessMs: number;
  /** Set when recognition threw rather than returning a bad read. */
  error?: string;
}

export interface Metrics {
  n: number;
  exactMatch: number;
  exactMatchRate: number;
  /** Total edits over total reference characters, not the mean of per-image rates. */
  cer: number;
  /** Mean of per-image rates, which short expressions dominate. Reported for reference. */
  meanCer: number;
  solvable: number;
  solvableRate: number;
  /** Images whose ground truth solves; the denominator of answerMatchRate. */
  scorable: number;
  answerMatch: number;
  answerMatchRate: number;
  /** Images where recognition threw. */
  errors: number;
  medianMs: number;
  p90Ms: number;
  failures: Partial<Record<SolveFailure, number>>;
}

export interface ProviderRun {
  provider: string;
  label: string;
  license: string;
  modelId?: string;
  device?: string;
  /** Weights download plus session creation. Never mixed into per-image latency. */
  loadMs: number;
  overall: Metrics;
  byCategory: Partial<Record<Category, Metrics>>;
  items: ItemResult[];
}

export interface ProviderFailure {
  provider: string;
  error: string;
}

export interface BenchResults {
  schema: 1;
  generatedAt: string;
  corpus: {
    dir: string;
    images: number;
    byCategory: Partial<Record<Category, number>>;
    /** Ground truths the solver itself cannot answer; excluded from answer match. */
    unscorable: number;
  };
  runs: ProviderRun[];
  /** Providers that never got as far as a result, e.g. the weights would not load. */
  failures?: ProviderFailure[];
}
