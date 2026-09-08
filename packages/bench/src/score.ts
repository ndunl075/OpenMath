import { characterErrorRate, editDistance } from "./distance.js";
import { answersMatch, read } from "./reading.js";
import type { Category, ItemResult, ItemScore, Metrics, SolveFailure } from "./types.js";

/**
 * Score one read against its ground truth. Everything here is pure string in,
 * numbers out, so the whole scoring layer is testable with canned model output
 * and no photos and no models.
 */
export function scoreItem(expectedLatex: string, rawPrediction: string): ItemScore {
  const expected = read(expectedLatex);
  const actual = read(rawPrediction);

  // Both sides are normalised before comparison, so `x^2` and `x^{2}` are not
  // counted as a misread when the model simply braces differently.
  const distance = editDistance(expected.latex, actual.latex);
  const scorable = expected.solved;

  return {
    expected: expected.latex,
    predicted: actual.latex,
    exactMatch: expected.latex === actual.latex,
    editDistance: distance,
    referenceLength: [...expected.latex].length,
    cer: characterErrorRate(expected.latex, actual.latex),
    solvable: actual.solved,
    ...(actual.failure ? { failure: actual.failure } : {}),
    scorable,
    ...(scorable ? {} : { unscorableReason: expected.failure ?? "error" }),
    answerMatch: scorable && answersMatch(expected, actual),
    ...(expected.answer !== undefined ? { expectedAnswer: expected.answer } : {}),
    ...(actual.answer !== undefined ? { predictedAnswer: actual.answer } : {}),
  };
}

/** Middle value, or the mean of the middle two. Empty input scores 0. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Nearest-rank percentile: with 20 images p90 is the 18th slowest, an actual measurement. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

export function aggregate(items: readonly ItemResult[]): Metrics {
  const failures: Partial<Record<SolveFailure, number>> = {};
  let exactMatch = 0;
  let solvable = 0;
  let scorable = 0;
  let answerMatch = 0;
  let errors = 0;
  let edits = 0;
  let referenceChars = 0;
  let cerSum = 0;
  const times: number[] = [];

  for (const item of items) {
    if (item.exactMatch) exactMatch++;
    if (item.solvable) solvable++;
    if (item.scorable) scorable++;
    if (item.answerMatch) answerMatch++;
    if (item.error) errors++;
    if (item.failure) failures[item.failure] = (failures[item.failure] ?? 0) + 1;
    edits += item.editDistance;
    referenceChars += item.referenceLength;
    cerSum += item.cer;
    times.push(item.ms);
  }

  return {
    n: items.length,
    exactMatch,
    exactMatchRate: rate(exactMatch, items.length),
    // Corpus CER pools the edits rather than averaging ratios, so one short
    // expression read badly cannot outweigh a page of long ones read well.
    cer: rate(edits, referenceChars),
    meanCer: rate(cerSum, items.length),
    solvable,
    solvableRate: rate(solvable, items.length),
    scorable,
    answerMatch,
    // Over the images the solver can answer at all: an equation out of the
    // solver's scope is a coverage gap, not a recognition failure.
    answerMatchRate: rate(answerMatch, scorable),
    errors,
    medianMs: median(times),
    p90Ms: percentile(times, 0.9),
    failures,
  };
}

export function aggregateByCategory(
  items: readonly ItemResult[],
): Partial<Record<Category, Metrics>> {
  const groups = new Map<Category, ItemResult[]>();
  for (const item of items) {
    const bucket = groups.get(item.category);
    if (bucket) bucket.push(item);
    else groups.set(item.category, [item]);
  }
  const out: Partial<Record<Category, Metrics>> = {};
  for (const [category, bucket] of groups) out[category] = aggregate(bucket);
  return out;
}
