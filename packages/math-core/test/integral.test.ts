import { describe, expect, it } from "vitest";
import {
  asIntegral, evaluateNumeric, parseLatex, ParseError, toDebug, toLatex,
} from "../src/index.js";

const debug = (s: string) => toDebug(parseLatex(s));

describe("reading an integral", () => {
  it("takes the d-variable as the end of the integrand", () => {
    expect(debug("\\int x^2 dx")).toBe("(integral (^ x 2) x)");
    expect(debug("\\int x^{2} \\, dx")).toBe("(integral (^ x 2) x)");
    expect(debug("\\int (x^2 + 1) dx")).toBe("(integral (+ (^ x 2) 1) x)");
  });

  it("does not let a fraction swallow the dx", () => {
    // The trap: \frac takes two groups and then implicit multiplication would
    // happily read `dx` as two more factors, giving one over x squared, times
    // d, times x — an expression with three variables in it.
    expect(debug("\\int \\frac{1}{x^2} dx")).toBe("(integral (/ 1 (^ x 2)) x)");
    expect(debug("\\int \\frac{2x+3}{x^2+3x+2} dx")).toBe(
      "(integral (/ (+ (* 2 x) 3) (+ (^ x 2) (* 3 x) 2)) x)",
    );
  });

  it("reads a function argument the way the rest of the grammar does", () => {
    expect(debug("\\int \\sin 2x \\, dx")).toBe("(integral (sin (* 2 x)) x)");
    expect(debug("\\int \\sin(x) dx")).toBe("(integral (sin x) x)");
  });

  it("names the variable from the d, not from the integrand", () => {
    const parts = asIntegral(parseLatex("\\int t^{2} \\, dt"));
    expect(parts?.variable).toBe("t");
    expect(parts?.bounds).toBeUndefined();
  });

  it("carries the limits of a definite integral", () => {
    expect(debug("\\int_{0}^{1} x \\, dx")).toBe("(integral x x 0 1)");
    expect(debug("\\int_0^1 x^2 dx")).toBe("(integral (^ x 2) x 0 1)");
    const parts = asIntegral(parseLatex("\\int_{2}^{5} x \\, dx"));
    expect(parts?.bounds && toLatex(parts.bounds.lower)).toBe("2");
    expect(parts?.bounds && toLatex(parts.bounds.upper)).toBe("5");
  });

  it("keeps two integrals in a sum apart", () => {
    expect(debug("\\int x \\, dx + \\int y \\, dy")).toBe(
      "(+ (integral x x) (integral y y))",
    );
    expect(debug("2\\int x\\,dx")).toBe("(* 2 (integral x x))");
  });

  it("round-trips through the serializer", () => {
    const samples = [
      "\\int x^{2} \\, dx", "\\int \\left(x^{2} + 1\\right) \\, dx",
      "\\int \\frac{1}{x} \\, dx", "\\int_{0}^{1} x \\, dx",
      "\\int e^{3 x} \\, dx", "\\int \\sin\\left(2 x\\right) \\, dx",
      "2 \\int x \\, dx", "-\\int x \\, dx",
    ];
    for (const s of samples) expect(toLatex(parseLatex(s))).toBe(s);
  });

  it("refuses an integral it cannot find the end of", () => {
    expect(() => parseLatex("\\int x")).toThrow(ParseError);
    // A dx under a fraction bar is not the end of anything.
    expect(() => parseLatex("\\int \\frac{dx}{x}")).toThrow(ParseError);
    expect(() => parseLatex("\\int_{0} x \\, dx")).toThrow(/both limits or neither/);
  });

  it("reads an infinite bound, leaving the improper case to the solver", () => {
    // The parser used to refuse these. @openmath/steps answers them now, by
    // rewriting the integral as a limit of a proper one, so the notation has
    // to survive being read.
    expect(toDebug(parseLatex("\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx")))
      .toContain("infinity");
    expect(toDebug(parseLatex("\\int_{-\\infty}^{0} e^{x} \\, dx"))).toContain("infinity");
  });
});

describe("evaluating an integral numerically", () => {
  it("works a definite integral out by quadrature", () => {
    expect(evaluateNumeric(parseLatex("\\int_{0}^{1} x^{2} \\, dx"))).toBeCloseTo(1 / 3, 10);
    expect(evaluateNumeric(parseLatex("\\int_{0}^{\\pi} \\sin(x) \\, dx"))).toBeCloseTo(2, 10);
    expect(evaluateNumeric(parseLatex("\\int_{1}^{2} \\frac{1}{x} \\, dx"))).toBeCloseTo(
      Math.LN2, 10,
    );
  });

  it("reverses sign when the limits are the other way round", () => {
    expect(evaluateNumeric(parseLatex("\\int_{1}^{0} x^{2} \\, dx"))).toBeCloseTo(-1 / 3, 10);
  });

  it("has no value for an indefinite integral", () => {
    // It stands for a family of functions, not a number, and saying so is what
    // stops the sampling verifier comparing two members of that family.
    expect(evaluateNumeric(parseLatex("\\int x \\, dx"))).toBeNaN();
  });

  it("gives up rather than guessing across a pole", () => {
    expect(evaluateNumeric(parseLatex("\\int_{-1}^{1} \\frac{1}{x} \\, dx"))).toBeNaN();
  });
});
