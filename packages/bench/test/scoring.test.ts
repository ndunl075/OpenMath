import { describe, expect, it } from "vitest";
import { aggregate, median, percentile, read, scoreItem } from "@openmath/bench";
import type { ItemResult } from "@openmath/bench";

/** Everything here is what a stub provider would have returned: canned strings. */
describe("scoring one read", () => {
  it("counts an identical read as an exact match", () => {
    const score = scoreItem("2x + 3 = 7", "2x + 3 = 7");
    expect(score.exactMatch).toBe(true);
    expect(score.cer).toBe(0);
    expect(score.solvable).toBe(true);
    expect(score.answerMatch).toBe(true);
  });

  it("counts formatting the normaliser removes as an exact match", () => {
    // The model wrapped the result in display math and \left \right.
    const score = scoreItem("2x + 3 = 7", "$$2x + 3 = 7$$");
    expect(score.exactMatch).toBe(true);
    expect(score.editDistance).toBe(0);
  });

  it("accepts a different but mathematically identical read", () => {
    const score = scoreItem("2x + 3 = 7", "2 \\cdot x + 3 = 7");
    // Character by character it is a miss, which is exactly why exact match
    // and CER are the wrong headline for this product.
    expect(score.exactMatch).toBe(false);
    expect(score.cer).toBeGreaterThan(0);
    // Same answer, so the student sees the right thing.
    expect(score.answerMatch).toBe(true);
    expect(score.expectedAnswer).toBe("x = 2");
    expect(score.predictedAnswer).toBe("x = 2");
  });

  it("rejects a read that is one digit wrong", () => {
    const score = scoreItem("2x + 3 = 7", "2x + 3 = 9");
    expect(score.cer).toBeLessThan(0.2);
    expect(score.solvable).toBe(true);
    // Nearly identical text, completely wrong answer: the case CER hides.
    expect(score.answerMatch).toBe(false);
    expect(score.predictedAnswer).toBe("x = 3");
  });

  it("rejects a read that changed the variable", () => {
    const score = scoreItem("2y + 3 = 7", "2x + 3 = 7");
    expect(score.answerMatch).toBe(false);
  });

  it("rejects an unparseable read even when it looks close", () => {
    const score = scoreItem("2x + 3 = 7", "2x + 3 = ?");
    expect(score.cer).toBeLessThan(0.2);
    expect(score.solvable).toBe(false);
    expect(score.failure).toBe("parse");
    expect(score.answerMatch).toBe(false);
  });

  it("rejects an empty read", () => {
    const score = scoreItem("2x + 3 = 7", "");
    expect(score.predicted).toBe("");
    expect(score.cer).toBe(1);
    expect(score.solvable).toBe(false);
    expect(score.failure).toBe("empty");
    expect(score.answerMatch).toBe(false);
  });

  it("marks a read the solver refuses as out of scope, not as a parse error", () => {
    const score = scoreItem("2x + 3 = 7", "\\sum_{i=1}^{n} i = 7");
    expect(score.failure).toBe("out-of-scope");
    expect(score.answerMatch).toBe(false);
  });

  it("does not score answers for a ground truth the solver cannot answer", () => {
    const score = scoreItem("\\lim_{x \\to 0} x", "\\lim_{x \\to 0} x");
    expect(score.exactMatch).toBe(true);
    expect(score.scorable).toBe(false);
    expect(score.unscorableReason).toBe("out-of-scope");
    expect(score.answerMatch).toBe(false);
  });

  it("matches quadratic roots found in the other order", () => {
    const score = scoreItem("x^{2} - 5x + 6 = 0", "(x-3)(x-2) = 0");
    expect(score.exactMatch).toBe(false);
    expect(score.answerMatch).toBe(true);
  });

  it("matches an equivalent simplification", () => {
    const score = scoreItem("\\frac{1}{2} + \\frac{1}{3}", "0.5 + \\frac{1}{3}");
    expect(score.answerMatch).toBe(true);
  });

  it("rejects a read that turned an equation into an expression", () => {
    const score = scoreItem("2x + 3 = 7", "2x + 3 - 7");
    expect(score.solvable).toBe(true);
    expect(score.answerMatch).toBe(false);
  });
});

describe("reading a latex string the way the app does", () => {
  it("reports the answer the UI would show", () => {
    const reading = read("3x = 12");
    expect(reading.solved).toBe(true);
    expect(reading.kind).toBe("solve");
    expect(reading.variable).toBe("x");
    expect(reading.answers).toEqual(["x = 4"]);
  });

  it("reports why a string produced no answer", () => {
    expect(read("").failure).toBe("empty");
    expect(read("2x + ").failure).toBe("parse");
    expect(read("\\sum x").failure).toBe("out-of-scope");
    expect(read("x^{3} + x = 1").failure).toBe("unsupported");
  });
});

function itemResult(over: Partial<ItemResult>): ItemResult {
  return {
    file: "001.jpg",
    category: "printed",
    raw: "",
    expected: "",
    predicted: "",
    exactMatch: false,
    editDistance: 0,
    referenceLength: 0,
    cer: 0,
    solvable: false,
    scorable: true,
    answerMatch: false,
    ms: 100,
    preprocessMs: 1,
    ...over,
  };
}

describe("aggregating", () => {
  it("pools edits rather than averaging per-image rates", () => {
    const items = [
      itemResult({ editDistance: 1, referenceLength: 1, cer: 1 }),
      itemResult({ editDistance: 1, referenceLength: 99, cer: 1 / 99 }),
    ];
    const metrics = aggregate(items);
    // Corpus CER: 2 edits over 100 characters. The mean of the two rates is
    // 0.505, which one very short expression would otherwise dictate.
    expect(metrics.cer).toBeCloseTo(0.02, 10);
    expect(metrics.meanCer).toBeCloseTo(0.505, 3);
  });

  it("scores answer match over the scorable images only", () => {
    const metrics = aggregate([
      itemResult({ scorable: true, answerMatch: true }),
      itemResult({ scorable: true, answerMatch: false }),
      itemResult({ scorable: false, answerMatch: false }),
    ]);
    expect(metrics.n).toBe(3);
    expect(metrics.scorable).toBe(2);
    expect(metrics.answerMatchRate).toBe(0.5);
  });

  it("counts failures by reason", () => {
    const metrics = aggregate([
      itemResult({ failure: "parse" }),
      itemResult({ failure: "parse" }),
      itemResult({ failure: "empty" }),
      itemResult({ solvable: true }),
    ]);
    expect(metrics.failures).toEqual({ parse: 2, empty: 1 });
    expect(metrics.solvableRate).toBe(0.25);
  });

  it("has no rates to report for an empty run", () => {
    const metrics = aggregate([]);
    expect(metrics.n).toBe(0);
    expect(metrics.answerMatchRate).toBe(0);
    expect(metrics.medianMs).toBe(0);
  });
});

describe("latency statistics", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("reports a measured value for p90, not an interpolated one", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.9)).toBe(9);
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile([42], 0.9)).toBe(42);
  });
});
