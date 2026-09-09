import { describe, expect, it } from "vitest";
import { evaluateNumeric, parseLatex } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";

/**
 * Series, against verdicts written by hand from the standard tests.
 *
 * Convergence is the one thing in this repo that cannot be checked by
 * measurement: adding a lot of terms of sum 1/n gives a number that looks
 * perfectly settled, and the series diverges. So the ground truth here is
 * written out, one problem at a time, the way it would be marked.
 */

const CONVERGES = [
  // Geometric, |r| < 1.
  "\\sum_{n=1}^{\\infty} \\frac{1}{2^{n}}",
  "\\sum_{n=1}^{\\infty} \\left(\\frac{2}{3}\\right)^{n}",
  // p-series, p > 1.
  "\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}}",
  "\\sum_{n=1}^{\\infty} \\frac{1}{n^{3}}",
  // Ratio test.
  "\\sum_{n=1}^{\\infty} \\frac{n}{2^{n}}",
  "\\sum_{n=1}^{\\infty} \\frac{1}{n!}",
  "\\sum_{n=1}^{\\infty} \\frac{2^{n}}{n!}",
  "\\sum_{n=1}^{\\infty} \\frac{n^{2}}{3^{n}}",
  "\\sum_{n=1}^{\\infty} n e^{-n}",
  // Alternating, terms shrinking to zero.
  "\\sum_{n=1}^{\\infty} \\frac{(-1)^{n}}{n}",
  "\\sum_{n=1}^{\\infty} \\frac{(-1)^{n}}{n^{2}}",
  // Limit comparison against a p-series.
  "\\sum_{n=1}^{\\infty} \\frac{1}{n(n+1)}",
  "\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}+1}",
  "\\sum_{n=1}^{\\infty} \\frac{2n}{n^{3}+1}",
];

const DIVERGES = [
  // The harmonic series and its relatives: p <= 1.
  "\\sum_{n=1}^{\\infty} \\frac{1}{n}",
  "\\sum_{n=1}^{\\infty} \\frac{1}{\\sqrt{n}}",
  // Terms that do not approach zero.
  "\\sum_{n=1}^{\\infty} \\frac{n}{n+1}",
  "\\sum_{n=1}^{\\infty} \\frac{n+1}{n}",
  "\\sum_{n=1}^{\\infty} \\frac{n^{2}}{n^{2}+1}",
  // Geometric with |r| >= 1, and a factorial that outruns its denominator.
  "\\sum_{n=1}^{\\infty} 2^{n}",
  "\\sum_{n=1}^{\\infty} \\frac{n!}{2^{n}}",
  // The integral test's own examples.
  "\\sum_{n=2}^{\\infty} \\frac{1}{n\\ln(n)}",
  "\\sum_{n=1}^{\\infty} \\frac{\\ln(n)}{n}",
];

describe("series that converge", () => {
  for (const problem of CONVERGES) {
    it(problem, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (!r.ok) return;
      // Either a value, or the word. A value is itself a claim of convergence.
      const answer = r.solution.answer;
      expect(answer.includes("diverge"), `said: ${answer}`).toBe(false);
    });
  }
});

describe("series that diverge", () => {
  for (const problem of DIVERGES) {
    it(problem, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (!r.ok) return;
      expect(r.solution.answer, "should say it diverges").toContain("diverges");
    });
  }
});

/** Sums with an exact value, worked by hand. */
describe("sums with a value", () => {
  const CASES: Array<[string, number]> = [
    // Finite.
    ["\\sum_{n=1}^{10} n", 55],
    ["\\sum_{n=1}^{5} n^{2}", 55],
    ["\\sum_{n=1}^{4} 3", 12],
    ["\\sum_{n=1}^{100} n", 5050],
    // Geometric: first term over one minus the ratio.
    ["\\sum_{n=1}^{\\infty} \\frac{1}{2^{n}}", 1],
    ["\\sum_{n=0}^{\\infty} \\frac{1}{3^{n}}", 1.5],
    ["\\sum_{n=1}^{\\infty} \\frac{3}{4^{n}}", 1],
    ["\\sum_{n=1}^{\\infty} \\left(\\frac{2}{3}\\right)^{n}", 2],
    ["\\sum_{n=1}^{\\infty} \\frac{1}{5^{n}}", 0.25],
    // Factorials.
    ["5!", 120],
    ["0!", 1],
    ["3!+4!", 30],
  ];
  for (const [problem, want] of CASES) {
    it(`${problem} = ${want}`, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (!r.ok) return;
      const got = evaluateNumeric(parseLatex(r.solution.answer));
      expect(Math.abs(got - want), `got ${r.solution.answer} = ${got}`).toBeLessThan(1e-9);
      expect(r.solution.verified, "verified").toBe(true);
    });
  }
});

/**
 * A power series: one letter besides the index, so the question is where it
 * converges rather than what it adds up to. Intervals written by hand.
 */
describe("power series", () => {
  const CASES: Array<[string, string]> = [
    // p = 2 at both ends, so both are included. No closed form, so the
    // interval is the answer; the ones that do have a closed form are
    // checked below, where the interval moves into the note.
    ["\\sum_{n=1}^{\\infty} \\frac{x^{n}}{n^{2}}", "\\left[-1, 1\\right]"],
    ["\\sum_{n=0}^{\\infty} \\frac{x^{n}}{2^{n}}", "\\left(-2, 2\\right)"],
    ["\\sum_{n=1}^{\\infty} \\frac{x^{n}}{n 3^{n}}", "\\left[-3, 3\\right)"],
    // Centred at 3 rather than 0.
    ["\\sum_{n=1}^{\\infty} \\frac{(x-3)^{n}}{n}", "\\left[2, 4\\right)"],
  ];
  for (const [problem, interval] of CASES) {
    it(problem, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (!r.ok) return;
      expect(r.solution.answer).toBe(interval);
    });
  }

  it("converges everywhere when the ratio dies away", () => {
    const r = trySolve("\\sum_{n=0}^{\\infty} \\frac{x^{n}}{n!}");
    expect(r.ok).toBe(true);
    // It is e^x, and the note carries the reach.
    if (r.ok) expect(r.solution.note).toContain("every x");
  });

  it("gives the sum and the interval together", () => {
    const cases: Array<[string, string, string]> = [
      ["\\sum_{n=0}^{\\infty} x^{n}", "\\frac{1}{1 - x}", "\\left(-1, 1\\right)"],
      ["\\sum_{n=1}^{\\infty} \\frac{x^{n}}{n}", "-\\ln\\left(1 - x\\right)", "\\left[-1, 1\\right)"],
    ];
    for (const [problem, sum, interval] of cases) {
      const r = trySolve(problem);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.solution.answer).toBe(sum);
      expect(r.solution.note).toContain(interval);
    }
  });

  it("converges only at the centre when the ratio runs away", () => {
    const r = trySolve("\\sum_{n=0}^{\\infty} n! x^{n}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.solution.answer).toBe("x = 0");
  });
});

/**
 * The standard Maclaurin series, recognised by what they sum to. Written out
 * by hand from the ones a Calc 2 course expects to be memorised.
 */
describe("series a course expects you to recognise", () => {
  const CASES: Array<[string, string]> = [
    ["\\sum_{n=0}^{\\infty} \\frac{x^{n}}{n!}", "e^{x}"],
    ["\\sum_{n=0}^{\\infty} x^{n}", "\\frac{1}{1 - x}"],
    ["\\sum_{n=1}^{\\infty} \\frac{x^{n}}{n}", "-\\ln\\left(1 - x\\right)"],
    ["\\sum_{n=0}^{\\infty} \\frac{(-1)^{n} x^{2n+1}}{(2n+1)!}", "\\sin\\left(x\\right)"],
    ["\\sum_{n=0}^{\\infty} \\frac{(-1)^{n} x^{2n}}{(2n)!}", "\\cos\\left(x\\right)"],
    ["\\sum_{n=0}^{\\infty} \\frac{(-1)^{n}x^{2n+1}}{2n+1}", "\\arctan\\left(x\\right)"],
  ];
  for (const [problem, sum] of CASES) {
    it(`${problem} = ${sum}`, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (r.ok) expect(r.solution.answer).toBe(sum);
    });
  }

  it("carries the letter the series was written in", () => {
    const r = trySolve("\\sum_{n=0}^{\\infty} \\frac{t^{n}}{n!}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.solution.answer).toBe("e^{t}");
  });

  it("falls back to the interval when there is no closed form", () => {
    // sum x^n/n^2 has no elementary sum, so the interval is the answer.
    const r = trySolve("\\sum_{n=1}^{\\infty} \\frac{x^{n}}{n^{2}}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.solution.answer).toBe("\\left[-1, 1\\right]");
  });
});

describe("what it will not guess at", () => {
  it("refuses a sum carrying two unknowns", () => {
    const r = trySolve("\\sum_{n=1}^{\\infty} \\frac{x^{n} y}{n}");
    expect(r.ok).toBe(false);
  });
});
