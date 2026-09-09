import { describe, expect, it } from "vitest";
import { diff, div, fn, num, parseLatex, sym } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";
import { verifyLimitEquivalent } from "../src/verify.js";

/**
 * Answers that were correct but reported unchecked, which made the UI hide
 * their working. Both came from the verifier finite-differencing something it
 * should have differentiated exactly.
 */
describe("correct answers are no longer reported unchecked", () => {
  const CASES: Array<[string, string]> = [
    ["\\frac{d^{2}}{dx^{2}}(x^{5})", "20 x^{3}"],
    ["\\frac{d^{3}}{dx^{3}}(x^{5})", "60 x^{2}"],
    ["\\frac{d^{2}}{dx^{2}}(\\sin(x))", "-\\sin\\left(x\\right)"],
    ["\\lim_{x \\to 0} \\frac{1-\\cos(x)}{x^{2}}", "\\frac{1}{2}"],
  ];
  for (const [problem, answer] of CASES) {
    it(problem, () => {
      const r = trySolve(problem);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.solution.answer).toBe(answer);
      expect(r.solution.verified).toBe(true);
      expect(r.solution.steps.some((s) => s.unverified)).toBe(false);
    });
  }
});

/**
 * l'Hopital steps are checked by structure rather than by measurement, so the
 * check has to refuse the two ways that could go wrong: differentiating
 * something other than the quotient in hand, and applying the rule at all to a
 * quotient that is not indeterminate.
 */
describe("the l'Hopital check refuses misuse", () => {
  const limit = (body: ReturnType<typeof div>, point: number) =>
    fn("lim", [body, sym("x"), num(point), num(0)]);

  it("accepts a genuine 0/0 step", () => {
    const before = limit(div(fn("sin", [sym("x")]), sym("x")), 0);
    const after = limit(div(diff(fn("sin", [sym("x")]), sym("x")), diff(sym("x"), sym("x"))), 0);
    expect(verifyLimitEquivalent(before, after)).toBe("ok");
  });

  it("rejects the rule applied to a quotient that is not indeterminate", () => {
    // lim x->0 (x+1)/(x+2) is 1/2. Differentiating top and bottom gives 1.
    const f = parseLatex("x+1");
    const g = parseLatex("x+2");
    const before = limit(div(f, g), 0);
    const after = limit(div(diff(f, sym("x")), diff(g, sym("x"))), 0);
    expect(verifyLimitEquivalent(before, after)).toBe("mismatch");
  });

  it("rejects differentiating a different expression than the one in hand", () => {
    const before = limit(div(fn("sin", [sym("x")]), sym("x")), 0);
    // Numerator swapped for tan(x) on the way through.
    const after = limit(div(diff(fn("tan", [sym("x")]), sym("x")), diff(sym("x"), sym("x"))), 0);
    expect(verifyLimitEquivalent(before, after)).toBe("mismatch");
  });
});
