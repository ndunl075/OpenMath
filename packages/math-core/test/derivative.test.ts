import { describe, expect, it } from "vitest";
import {
  differentiateNumerically, evaluateNumeric, parseLatex, toDebug, toLatex,
} from "@openmath/math-core";

const d = (s: string) => toDebug(parseLatex(s));

describe("derivative notation", () => {
  it("reads the Leibniz operator instead of a fraction", () => {
    expect(d("\\frac{d}{dx}(x^2 + 3x)")).toBe("(diff (+ (^ x 2) (* 3 x)) x)");
    expect(d("\\frac{d}{dx} x^2")).toBe("(diff (^ x 2) x)");
    expect(d("\\frac{d}{dx}\\sin(2x)")).toBe("(diff (sin (* 2 x)) x)");
    expect(d("\\frac{d}{dt}(t^2)")).toBe("(diff (^ t 2) t)");
    expect(d("\\frac{d}{d\\theta}\\cos(\\theta)")).toBe("(diff (cos theta) theta)");
  });

  it("leaves a genuine fraction alone", () => {
    expect(d("\\frac{d}{2}")).toBe("(/ d 2)");
    expect(d("\\frac{1}{dx}")).toBe("(/ 1 (* d x))");
    expect(d("\\frac{x}{dx}")).toBe("(/ x (* d x))");
  });

  it("gives the operator the whole power, but stops at a closing bracket", () => {
    // The exponent belongs to the operand ...
    expect(d("\\frac{d}{dx}(x^2+1)^3")).toBe("(diff (^ (+ (^ x 2) 1) 3) x)");
    // ... a second bracket does not, or a product rule step would not read back.
    expect(d("\\frac{d}{dx}(x)(y)")).toBe("(* (diff x x) y)");
    // Without brackets the operand runs to the end of the term only.
    expect(d("\\frac{d}{dx}x^2+3x")).toBe("(+ (diff (^ x 2) x) (* 3 x))");
  });

  it("reads dy/dx as a derivative of y rather than a quotient", () => {
    expect(d("\\frac{dy}{dx}")).toBe("(diff y x)");
  });

  it("reads prime notation", () => {
    expect(d("(x^2+3x)'")).toBe("(diff (+ (^ x 2) (* 3 x)) x)");
    expect(d("(t^2)'")).toBe("(diff (^ t 2) t)");
    // f'(x): the bracket names the variable, it is not a factor to multiply by.
    expect(d("f'(x)")).toBe("(diff f x)");
    expect(d("y'")).toBe("(diff y x)");
    expect(d("(x^3)''")).toBe("(diff (diff (^ x 3) x) x)");
  });

  it("puts the prime outside the exponent, not on it", () => {
    // Reading this as a derivative of the exponent 3 would quietly turn the
    // whole expression into 1, and the arithmetic of that is impeccable.
    expect(d("(x^2+1)^3'")).toBe("(diff (^ (+ (^ x 2) 1) 3) x)");
    expect(d("x^{2}'")).toBe("(diff (^ x 2) x)");
  });

  it("round-trips through the serializer", () => {
    const cases = [
      "\\frac{d}{dx}(x^{2} + 3x)", "\\frac{d}{dx}\\sin(2x)", "(x^2+3x)'",
      "\\frac{d}{dx}(x^2+1)^3", "\\frac{d}{dt}\\sqrt{t^{2}+1}", "\\frac{dy}{dx}",
      "\\frac{d}{dx}(x)(y)", "\\frac{d}{d\\theta}\\cos(\\theta)",
    ];
    for (const c of cases) {
      const once = toLatex(parseLatex(c));
      expect(toDebug(parseLatex(once)), c).toBe(toDebug(parseLatex(c)));
      expect(toLatex(parseLatex(once)), c).toBe(once);
    }
  });

  it("serializes to readable LaTeX", () => {
    expect(toLatex(parseLatex("\\frac{d}{dx}(x^2+3x)")))
      .toBe("\\frac{d}{dx}\\left(x^{2} + 3 x\\right)");
    expect(toLatex(parseLatex("f'(x)"))).toBe("\\frac{d}{dx}\\left(f\\right)");
  });
});

describe("numeric differentiation", () => {
  it("matches the exact derivative closely enough to catch a wrong rule", () => {
    const cases: Array<[string, (x: number) => number, number]> = [
      ["x^{2}", (x) => 2 * x, 3],
      ["\\sin(2x)", (x) => 2 * Math.cos(2 * x), 0.5],
      ["\\sqrt{x^{2}+1}", (x) => x / Math.sqrt(x * x + 1), 2.25],
      ["e^{3x}", (x) => 3 * Math.exp(3 * x), 0.75],
      ["\\ln(x)", (x) => 1 / x, 4],
    ];
    for (const [latex, exact, at] of cases) {
      const f = parseLatex(latex);
      const got = differentiateNumerically((x) => evaluateNumeric(f, { x }), at);
      expect(Math.abs(got - exact(at)) / Math.max(1, Math.abs(exact(at))), latex)
        .toBeLessThan(1e-9);
    }
  });

  it("evaluates a diff node in place, so the verifier can sample it", () => {
    const n = parseLatex("\\frac{d}{dx}(x^{3})");
    expect(evaluateNumeric(n, { x: 2 })).toBeCloseTo(12, 8);
    expect(evaluateNumeric(n, {})).toBeNaN();
  });

  it("reports NaN rather than a wrong slope where it cannot resolve one", () => {
    // A hundredth of a radian from a pole of tan the difference quotient is
    // meaningless; saying so keeps the verifier from calling a correct rule wrong.
    const f = parseLatex("\\tan(x)");
    const nearPole = Math.PI / 2 - 0.005;
    expect(differentiateNumerically((x) => evaluateNumeric(f, { x }), nearPole)).toBeNaN();
    expect(differentiateNumerically((x) => evaluateNumeric(f, { x }), 0.5))
      .toBeCloseTo(1 / Math.cos(0.5) ** 2, 8);
  });

  it("knows e and pi are constants, not unknowns", () => {
    expect(evaluateNumeric(parseLatex("e"))).toBeCloseTo(Math.E, 12);
    expect(evaluateNumeric(parseLatex("e^{x}"), { x: 2 })).toBeCloseTo(Math.exp(2), 8);
  });
});
