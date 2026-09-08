import { describe, expect, it } from "vitest";
import {
  differentiateNumerically, evaluateNumeric, parseLatex,
} from "@openmath/math-core";
import { differentiate, resolveDerivatives } from "../src/symbolic-diff.js";

/**
 * The verifier decides whether a step is shown, so a differentiator it trusts
 * has to be right. Checked against math-core's five-point finite difference,
 * which is an entirely separate implementation — a shared mistake would have to
 * be made twice, in two different ways.
 */
const FUNCTIONS = [
  "x^{5}", "3x^{2} - 4x + 7", "x^{-2}", "x^{\\frac{1}{3}}",
  "\\sin(x)", "\\cos(x)", "\\tan(x)", "\\sec(x)", "\\csc(x)", "\\cot(x)",
  "\\sin(2x)", "\\cos(x^{2})", "\\sin(\\cos(x^{2}))",
  "\\ln(x)", "\\ln(x^{2})", "\\ln(\\sin(x))", "\\log(x)", "\\exp(x)",
  "e^{x}", "e^{x^{2}}", "2^{x}", "x^{x}",
  "x\\sin(x)", "\\frac{x}{x+1}", "\\frac{\\sin(x)}{x^{2}+1}",
  "\\sqrt{x}", "\\sqrt{x^{2}+1}", "\\sqrt{\\tan(x)}",
  "\\arcsin(x)", "\\arccos(x)", "\\arctan(x)",
  "\\sinh(x)", "\\cosh(x)", "\\tanh(x)",
  "e^{x}\\ln(x)", "x^{2}e^{x}",
];

/** Points chosen to sit inside every domain above. */
const POINTS = [0.3, 0.7, 1.4, 2.1];

describe("the verifier's differentiator agrees with a finite difference", () => {
  for (const f of FUNCTIONS) {
    it(f, () => {
      const node = parseLatex(f);
      const d = differentiate(node, "x");
      expect(d, `no derivative produced for ${f}`).not.toBeNull();
      let compared = 0;
      for (const x of POINTS) {
        const exact = evaluateNumeric(d!, { x });
        const approx = differentiateNumerically((t) => evaluateNumeric(node, { x: t }), x);
        if (!Number.isFinite(exact) || !Number.isFinite(approx)) continue;
        compared++;
        const scale = Math.max(1, Math.abs(exact), Math.abs(approx));
        expect(Math.abs(exact - approx) / scale, `at x=${x} for ${f}`).toBeLessThan(1e-5);
      }
      expect(compared, `no usable sample points for ${f}`).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("nested derivatives resolve exactly", () => {
  const CASES: Array<[string, number, number]> = [
    // [latex, x, expected value]
    ["\\frac{d^{2}}{dx^{2}}(x^{5})", 2, 20 * 8],       // 20x^3
    ["\\frac{d^{3}}{dx^{3}}(x^{5})", 2, 60 * 4],       // 60x^2
    ["\\frac{d^{2}}{dx^{2}}(\\sin(x))", 1, -Math.sin(1)],
    ["\\frac{d^{4}}{dx^{4}}(\\sin(x))", 1, Math.sin(1)],
    ["\\frac{d^{2}}{dx^{2}}(e^{x})", 1, Math.E],
  ];
  for (const [latex, x, expected] of CASES) {
    it(latex, () => {
      const resolved = resolveDerivatives(parseLatex(latex));
      expect(resolved).not.toBeNull();
      expect(evaluateNumeric(resolved!, { x })).toBeCloseTo(expected, 9);
    });
  }
});

describe("it declines what it does not know rather than guessing", () => {
  it("returns null for an integral", () => {
    expect(differentiate(parseLatex("\\int x \\, dx"), "x")).toBeNull();
  });
  it("returns null for a limit", () => {
    expect(differentiate(parseLatex("\\lim_{t \\to 0} \\frac{\\sin(t)}{t}"), "x")).toBeNull();
  });
});
