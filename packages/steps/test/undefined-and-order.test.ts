import { describe, expect, it } from "vitest";
import { parseLatex, toDebug } from "@openmath/math-core";
import { classify, trySolve } from "@openmath/steps";

describe("higher-order derivative notation", () => {
  it("reads d^2/dx^2 as two derivatives, not a fraction of a variable called d", () => {
    expect(toDebug(parseLatex("\\frac{d^{2}}{dx^{2}}(x^{4})"))).toBe("(diff (diff (^ x 4) x) x)");
  });

  it("differentiates twice", () => {
    const r = trySolve("\\frac{d^{2}}{dx^{2}}(x^{4})");
    if (!r.ok) throw new Error(r.message);
    expect(r.solution.answer).toBe("12 x^{2}");
  });

  it("handles a third derivative", () => {
    const r = trySolve("\\frac{d^{3}}{dx^{3}}(x^{5})");
    if (!r.ok) throw new Error(r.message);
    expect(r.solution.answer).toBe("60 x^{2}");
  });

  it("leaves mismatched orders as an ordinary fraction", () => {
    // d^2/dx^3 is not a derivative of any order, so inventing one would be a guess.
    expect(toDebug(parseLatex("\\frac{d^{2}}{dx^{3}}(x)"))).not.toContain("diff");
  });

  it("still declines Leibniz notation with an undefined function", () => {
    const r = trySolve("\\frac{d^{2}y}{dx^{2}}");
    expect(r.ok).toBe(false);
  });
});

describe("expressions with no value are declined, not answered", () => {
  for (const problem of ["\\frac{5}{0}", "\\frac{x}{0}", "\\frac{0}{0}"]) {
    it(`declines ${problem}`, () => {
      const r = trySolve(problem);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("divides by zero");
    });
  }

  it("declines a zero denominator that only appears after cancelling", () => {
    const r = trySolve("\\frac{1}{x-x}");
    expect(r.ok).toBe(false);
  });

  it("does not claim 0^0 is 1", () => {
    const r = trySolve("0^{0}");
    if (r.ok) expect(r.solution.answer).not.toBe("1");
  });

  it("leaves ordinary fractions alone", () => {
    const r = trySolve("\\frac{5}{2}");
    expect(r.ok).toBe(true);
  });
});

describe("a named constant is not an unknown", () => {
  it("does not solve for e or pi", () => {
    // 2e = 4 is simply false. Reading e as a variable answers "e = 2", which
    // redefines Euler's number rather than checking the claim.
    for (const problem of ["2e=4", "2\\pi=4"]) {
      const r = trySolve(problem);
      if (!r.ok) throw new Error(r.message);
      expect(r.solution.answer, problem).toBe("\\text{false}");
      expect(r.solution.variable, problem).toBeUndefined();
    }
  });

  it("still picks the real unknown standing next to one", () => {
    expect(classify(parseLatex("e^{x}=e^{2}")).variable).toBe("x");
    expect(classify(parseLatex("2x=\\pi")).variable).toBe("x");
  });
});

describe("a negative fraction shows the sign on the bar", () => {
  it("in a derivative result", () => {
    const r = trySolve("\\frac{d}{dx}(\\frac{1}{x})");
    if (!r.ok) throw new Error(r.message);
    expect(r.solution.answer).toBe("-\\frac{1}{x^{2}}");
  });

  it("in a plain fraction", () => {
    const r = trySolve("\\frac{-3}{4}");
    if (!r.ok) throw new Error(r.message);
    expect(r.solution.answer).toBe("-\\frac{3}{4}");
  });
});
