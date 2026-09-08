import { describe, expect, it } from "vitest";
import { diff, evaluateNumeric, parseLatex, sym } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";

/**
 * Independent check: differentiate the produced antiderivative and compare it
 * to the integrand at sampled points. Does not use the solver's own verifier.
 */
const INDEFINITE = [
  "\\int x^{2} \\, dx", "\\int \\sin(x) \\, dx", "\\int e^{x} \\, dx",
  "\\int \\frac{1}{x} \\, dx", "\\int 2x(x^{2}+1)^{3} \\, dx",
  "\\int x e^{x} \\, dx", "\\int \\ln(x) \\, dx", "\\int x\\cos(x) \\, dx",
  "\\int \\frac{1}{x^{2}+1} \\, dx", "\\int (2x+1)^{5} \\, dx",
  "\\int \\sin(3x) \\, dx", "\\int x^{2}e^{x} \\, dx",
  // The Calc 2 trig family.
  "\\int \\tan(x) \\, dx", "\\int \\cot(x) \\, dx",
  "\\int \\sin(x)^{2} \\, dx", "\\int \\cos(x)^{2} \\, dx",
  "\\int \\sin(2x)^{2} \\, dx",
  "\\int \\sin(x)^{3} \\, dx", "\\int \\cos(x)^{3} \\, dx",
  "\\int \\sin(x)^{5} \\, dx",
  // Inverse tangent away from a = 1.
  "\\int \\frac{1}{x^{2}+4} \\, dx", "\\int \\frac{1}{x^{2}+9} \\, dx",
  // Fractional powers.
  "\\int x^{\\frac{1}{2}} \\, dx", "\\int x^{-2} \\, dx",
];

describe("every antiderivative differentiates back to its integrand", () => {
  for (const problem of INDEFINITE) {
    it(problem, () => {
      const r = trySolve(problem);
      if (!r.ok) throw new Error(`${problem}: ${r.message}`);
      const integrand = parseLatex(problem.replace(/\\int\s*/, "").replace(/\s*\\,\s*dx/, ""));
      // Strip the constant of integration before differentiating.
      const answer = parseLatex(r.solution.answer.replace(/\s*\+\s*C$/, ""));
      const back = diff(answer, sym("x"));
      let compared = 0;
      for (const x of [0.43, 1.17, 2.28, -0.61, 3.05]) {
        const a = evaluateNumeric(back, { x });
        const b = evaluateNumeric(integrand, { x });
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        compared++;
        expect(Math.abs(a - b), `at x=${x}: got ${a}, integrand ${b} (${r.solution.answer})`)
          .toBeLessThan(1e-4 * Math.max(1, Math.abs(b)));
      }
      expect(compared, "had comparable points").toBeGreaterThan(2);
    });
  }
});

describe("definite integrals, against values worked by hand", () => {
  const CASES: Array<[string, number]> = [
    ["\\int_{0}^{1} x^{2} \\, dx", 1 / 3],
    ["\\int_{0}^{2} x \\, dx", 2],
    ["\\int_{1}^{2} \\frac{1}{x} \\, dx", Math.LN2],
    ["\\int_{0}^{1} e^{x} \\, dx", Math.E - 1],
    ["\\int_{0}^{\\pi} \\sin(x) \\, dx", 2],
    // Half of pi: the average of sin^2 over a full arch is 1/2.
    ["\\int_{0}^{\\pi} \\sin(x)^{2} \\, dx", Math.PI / 2],
    ["\\int_{0}^{\\pi} \\cos(x)^{2} \\, dx", Math.PI / 2],
    // ln(e) is 1, and the answer should say so rather than leaving ln|e|.
    ["\\int_{1}^{e} \\frac{1}{x} \\, dx", 1],
    ["\\int_{0}^{1} \\frac{1}{x^{2}+1} \\, dx", Math.PI / 4],
  ];
  for (const [problem, want] of CASES) {
    it(`${problem} = ${want.toFixed(4)}`, () => {
      const r = trySolve(problem);
      if (!r.ok) throw new Error(`${problem}: ${r.message}`);
      const got = evaluateNumeric(parseLatex(r.solution.answer));
      expect(Math.abs(got - want), `got ${r.solution.answer} = ${got}`).toBeLessThan(1e-6);
    });
  }
});

/**
 * Improper integrals, against values worked by hand. Not in the corpus,
 * because every corpus answer is checked by measuring the problem and
 * quadrature cannot measure an area that runs out to infinity.
 */
describe("improper integrals", () => {
  const CONVERGENT: Array<[string, number]> = [
    ["\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx", 1],
    ["\\int_{1}^{\\infty} \\frac{1}{x^{3}} \\, dx", 1 / 2],
    ["\\int_{2}^{\\infty} \\frac{1}{x^{2}} \\, dx", 1 / 2],
    ["\\int_{0}^{\\infty} e^{-x} \\, dx", 1],
    ["\\int_{-\\infty}^{0} e^{x} \\, dx", 1],
  ];
  for (const [problem, want] of CONVERGENT) {
    it(`${problem} = ${want}`, () => {
      const r = trySolve(problem);
      if (!r.ok) throw new Error(`${problem}: ${r.message}`);
      const got = evaluateNumeric(parseLatex(r.solution.answer));
      expect(Math.abs(got - want), `got ${r.solution.answer} = ${got}`).toBeLessThan(1e-9);
      expect(r.solution.verified, "verified").toBe(true);
    });
  }

  // Divergent: there is no number, and saying so is the answer.
  for (const problem of [
    "\\int_{1}^{\\infty} \\frac{1}{x} \\, dx",
    "\\int_{1}^{\\infty} x \\, dx",
  ]) {
    it(`${problem} diverges`, () => {
      const r = trySolve(problem);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("diverges");
    });
  }
});

describe("declines rather than inventing an antiderivative", () => {
  for (const problem of ["\\int e^{x^{2}} \\, dx", "\\int \\frac{1}{\\ln(x)} \\, dx"]) {
    it(`refuses ${problem}`, () => expect(trySolve(problem).ok).toBe(false));
  }
});
