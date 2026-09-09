import { describe, expect, it } from "vitest";
import { trySolve } from "@openmath/steps";

/**
 * The two cancellations that let the ratio test be derived rather than
 * measured.
 *
 * Without them the ratio of one term to the next has to be *sampled*, and a
 * factorial passes the largest double at 171 — so the sampling runs out of
 * numbers before the ratio settles, and a convergence verdict ends up resting
 * on a numerical guess. With them the ratio simplifies to something the limit
 * engine reads exactly:
 *
 *     sum n/2^n    ratio (n+1)/(2n)  -> 1/2
 *     sum 1/n!     ratio 1/(n+1)     -> 0
 *     sum 2^n/n!   ratio 2/(n+1)     -> 0
 *
 * They are ordinary algebra, so they are worth having on their own account
 * too.
 */
describe("factorials cancel against each other", () => {
  const CASES: Array<[string, string]> = [
    ["\\frac{(n+1)!}{n!}", "n + 1"],
    ["\\frac{n!}{(n+1)!}", "\\frac{1}{n + 1}"],
    ["\\frac{(n+2)!}{n!}", "n^{2} + 3 n + 2"],
    ["\\frac{n!}{(n+2)!}", "\\frac{1}{n^{2} + 3 n + 2}"],
    // Inside a product, which is the shape the ratio test actually produces.
    ["\\frac{2 n!}{(n+1)!}", "\\frac{2}{n + 1}"],
    ["\\frac{(n+1)!}{2 n!}", "\\frac{n + 1}{2}"],
    ["\\frac{5!}{3!}", "20"],
  ];
  for (const [problem, answer] of CASES) {
    it(`${problem} = ${answer}`, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (r.ok) expect(r.solution.answer).toBe(answer);
    });
  }

  it("leaves a gap it cannot name alone", () => {
    // (2n)!/n! is a real question with no short answer, and guessing at one
    // would be worse than declining to simplify.
    const r = trySolve("\\frac{(2n)!}{n!}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.solution.answer).toContain("!");
  });
});

describe("powers of the same base cancel by subtracting exponents", () => {
  const CASES: Array<[string, string]> = [
    ["\\frac{2^{n+1}}{2^{n}}", "2"],
    ["\\frac{x^{n+1}}{x^{n}}", "x"],
    ["\\frac{3^{n}}{3^{n+2}}", "\\frac{1}{9}"],
    ["\\frac{2^{n}}{2^{n}}", "1"],
    ["\\frac{2^{n+1} n}{2^{n}(n+1)}", "\\frac{2 n}{n + 1}"],
    // Both exponents numeric is the older rule's job, and it still works.
    ["\\frac{x^{5}}{x^{2}}", "x^{3}"],
  ];
  for (const [problem, answer] of CASES) {
    it(`${problem} = ${answer}`, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (r.ok) expect(r.solution.answer).toBe(answer);
    });
  }
});

/**
 * The limits those cancellations unlock, taken by the rule engine rather than
 * by sampling. Each is the ratio test's L for a series in the suite.
 */
describe("the ratios those cancellations leave have exact limits", () => {
  const CASES: Array<[string, string]> = [
    ["\\lim_{n \\to \\infty} \\frac{n+1}{2n}", "\\frac{1}{2}"],
    ["\\lim_{n \\to \\infty} \\frac{1}{n+1}", "0"],
    ["\\lim_{n \\to \\infty} \\frac{2}{n+1}", "0"],
    ["\\lim_{n \\to \\infty} \\frac{n!}{(n+1)!}", "0"],
    ["\\lim_{n \\to \\infty} \\frac{n^{2}+2n+1}{3n^{2}}", "\\frac{1}{3}"],
  ];
  for (const [problem, answer] of CASES) {
    it(`${problem} = ${answer}`, () => {
      const r = trySolve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (r.ok) expect(r.solution.answer).toBe(answer);
    });
  }
});
