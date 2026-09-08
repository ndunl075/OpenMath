import { describe, expect, it } from "vitest";
import { evaluateNumeric, parseLatex } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";

/**
 * Independent check: compare each produced derivative against a hand-written
 * expected derivative, evaluated numerically. Deliberately does NOT use the
 * solver's own verifier, so a bug in the verifier cannot hide a bug in a rule.
 */
const CASES: Array<[string, string]> = [
  ["\\frac{d}{dx}(\\sin(2x))", "2\\cos(2x)"],
  ["\\frac{d}{dx}((x^2+1)^3)", "6x(x^2+1)^2"],
  ["\\frac{d}{dx}(\\sqrt{x^2+1})", "\\frac{x}{\\sqrt{x^2+1}}"],
  ["\\frac{d}{dx}(x\\sin(x))", "\\sin(x)+x\\cos(x)"],
  ["\\frac{d}{dx}(\\frac{x}{x+1})", "\\frac{1}{(x+1)^2}"],
  ["\\frac{d}{dx}(\\tan(x))", "\\frac{1}{\\cos(x)^2}"],
  ["\\frac{d}{dx}(\\ln(x^2))", "\\frac{2}{x}"],
  ["\\frac{d}{dx}(x^5)", "5x^4"],
  ["\\frac{d}{dx}(3x^2-4x+7)", "6x-4"],
  ["\\frac{d}{dx}(\\cos(x^2))", "-2x\\sin(x^2)"],
  ["\\frac{d}{dx}(\\frac{\\sin(x)}{x})", "\\frac{x\\cos(x)-\\sin(x)}{x^2}"],
  ["\\frac{d}{dx}(\\sqrt{x})", "\\frac{1}{2\\sqrt{x}}"],
];

describe("derivatives, checked against hand-written answers", () => {
  for (const [problem, expected] of CASES) {
    it(`${problem} = ${expected}`, () => {
      const outcome = trySolve(problem);
      if (!outcome.ok) throw new Error(`${problem}: ${outcome.message}`);
      const got = parseLatex(outcome.solution.answer);
      const want = parseLatex(expected);
      let compared = 0;
      for (const x of [0.37, 1.24, 2.61, 3.93, -1.42, 0.82]) {
        const a = evaluateNumeric(got, { x });
        const b = evaluateNumeric(want, { x });
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        compared++;
        expect(Math.abs(a - b), `at x=${x}: got ${a}, want ${b} (${outcome.solution.answer})`)
          .toBeLessThan(1e-7 * Math.max(1, Math.abs(b)));
      }
      expect(compared, "had comparable sample points").toBeGreaterThan(2);
      expect(outcome.solution.verified, "solver reported verified").toBe(true);
    });
  }
});
