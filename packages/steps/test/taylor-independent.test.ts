import { describe, expect, it } from "vitest";
import { evaluateNumeric, parseLatex } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";

/**
 * Taylor polynomials, against expansions written out by hand.
 *
 * The string comparison is the strict check; the numeric one underneath it is
 * the honest one, since a polynomial can be right and printed a different way.
 * Neither reuses the differentiation that produced the answer.
 */
/**
 * The command form, which is what the parser reads. A student types the bare
 * word and the normalizer puts the backslash on; that half is tested in
 * @openmath/ocr, which is the package that does it.
 */
const solve = (s: string) => trySolve(`\\${s}`);

describe("Maclaurin expansions match the ones in the book", () => {
  const CASES: Array<[string, string]> = [
    ["maclaurin(e^{x}, 4)", "1 + x + \\frac{1}{2} x^{2} + \\frac{1}{6} x^{3} + \\frac{1}{24} x^{4}"],
    ["maclaurin(\\sin(x), 5)", "x - \\frac{1}{6} x^{3} + \\frac{1}{120} x^{5}"],
    ["maclaurin(\\cos(x), 4)", "1 - \\frac{1}{2} x^{2} + \\frac{1}{24} x^{4}"],
    ["maclaurin(\\frac{1}{1-x}, 4)", "1 + x + x^{2} + x^{3} + x^{4}"],
    ["maclaurin(\\ln(1+x), 4)", "x - \\frac{1}{2} x^{2} + \\frac{1}{3} x^{3} - \\frac{1}{4} x^{4}"],
    ["maclaurin(\\arctan(x), 5)", "x - \\frac{1}{3} x^{3} + \\frac{1}{5} x^{5}"],
    // The binomial series.
    ["maclaurin(\\sqrt{1+x}, 3)",
      "1 + \\frac{1}{2} x - \\frac{1}{8} x^{2} + \\frac{1}{16} x^{3}"],
    ["maclaurin(\\frac{1}{1+x}, 4)", "1 - x + x^{2} - x^{3} + x^{4}"],
  ];
  for (const [problem, expansion] of CASES) {
    it(problem, () => {
      const r = solve(problem);
      expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
      if (!r.ok) return;
      expect(r.solution.answer).toBe(expansion);
      expect(r.solution.verified).toBe(true);
    });
  }
});

describe("Taylor expansions away from zero", () => {
  it("keeps an irrational coefficient rather than refusing the problem", () => {
    // Every derivative of e^x at 1 is e, which has no exact decimal.
    const r = solve("taylor(e^{x}, 1, 3)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solution.answer).toContain("e");
    expect(r.solution.answer).toContain("x - 1");
    expect(r.solution.verified).toBe(true);
  });

  it("rewrites a polynomial in powers of the new centre", () => {
    // x^3 + 2x about 1: f=3, f'=5, f''/2!=3, f'''/3!=1.
    const r = solve("taylor(x^{3}+2x, 1, 3)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solution.answer).toBe(
      "3 + 5 \\left(x - 1\\right) + 3 \\left(x - 1\\right)^{2} + \\left(x - 1\\right)^{3}",
    );
  });
});

/**
 * The defining property, checked numerically: a Taylor polynomial tracks its
 * function near the centre, and the gap has to shrink as the order rises.
 */
describe("the polynomial really does approximate the function", () => {
  const CASES: Array<[string, string, number]> = [
    ["maclaurin(e^{x}, 6)", "e^{x}", 0],
    ["maclaurin(\\sin(x), 7)", "\\sin(x)", 0],
    ["maclaurin(\\cos(x), 6)", "\\cos(x)", 0],
    ["taylor(e^{x}, 1, 5)", "e^{x}", 1],
    ["maclaurin(\\ln(1+x), 6)", "\\ln(1+x)", 0],
  ];
  for (const [problem, original, centre] of CASES) {
    it(`${problem} tracks ${original} near ${centre}`, () => {
      const r = solve(problem);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const approx = parseLatex(r.solution.answer);
      const exact = parseLatex(original);
      for (const h of [0.05, 0.1, 0.2]) {
        const x = centre + h;
        const a = evaluateNumeric(approx, { x });
        const b = evaluateNumeric(exact, { x });
        expect(Math.abs(a - b), `at x=${x}`).toBeLessThan(1e-4);
      }
    });
  }

  it("gets closer as more terms are taken", () => {
    const at = 0.7;
    const exact = Math.exp(at);
    let previous = Infinity;
    for (const order of [2, 4, 6, 8]) {
      const r = solve(`maclaurin(e^{x}, ${order})`);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const gap = Math.abs(evaluateNumeric(parseLatex(r.solution.answer), { x: at }) - exact);
      expect(gap, `order ${order} should beat the one before`).toBeLessThan(previous);
      previous = gap;
    }
  });
});

describe("what it refuses", () => {
  it("declines a function it cannot differentiate that many times", () => {
    const r = solve("maclaurin(\\left|x\\right|, 3)");
    expect(r.ok).toBe(false);
  });

  it("declines an unreasonable number of terms", () => {
    const r = solve("maclaurin(e^{x}, 40)");
    expect(r.ok).toBe(false);
  });
});
