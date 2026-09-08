import { describe, expect, it } from "vitest";
import { trySolve } from "@openmath/steps";

/** Values written from the unit circle by hand, not from the implementation. */
const EXACT: Array<[string, string]> = [
  ["\\sin(0)", "0"], ["\\cos(0)", "1"], ["\\tan(0)", "0"],
  ["\\sin(\\frac{\\pi}{6})", "\\frac{1}{2}"],
  ["\\cos(\\frac{\\pi}{6})", "\\frac{\\sqrt{3}}{2}"],
  ["\\tan(\\frac{\\pi}{6})", "\\frac{\\sqrt{3}}{3}"],
  ["\\sin(\\frac{\\pi}{4})", "\\frac{\\sqrt{2}}{2}"],
  ["\\tan(\\frac{\\pi}{4})", "1"],
  ["\\sin(\\frac{\\pi}{3})", "\\frac{\\sqrt{3}}{2}"],
  ["\\cos(\\frac{\\pi}{3})", "\\frac{1}{2}"],
  ["\\sin(\\frac{\\pi}{2})", "1"], ["\\cos(\\frac{\\pi}{2})", "0"],
  ["\\sin(\\frac{2\\pi}{3})", "\\frac{\\sqrt{3}}{2}"],
  ["\\cos(\\frac{2\\pi}{3})", "-\\frac{1}{2}"],
  ["\\sin(\\pi)", "0"], ["\\cos(\\pi)", "-1"],
  ["\\sin(\\frac{7\\pi}{6})", "-\\frac{1}{2}"],
  ["\\cos(\\frac{5\\pi}{4})", "-\\frac{\\sqrt{2}}{2}"],
  ["\\sin(\\frac{3\\pi}{2})", "-1"],
  ["\\sin(\\frac{11\\pi}{6})", "-\\frac{1}{2}"],
  ["\\cos(2\\pi)", "1"],
  ["\\log_{2}(8)", "3"], ["\\log(100)", "2"], ["\\ln(e)", "1"], ["\\ln(1)", "0"],
  ["\\log_{3}(81)", "4"], ["\\log_{2}(\\frac{1}{4})", "-2"],
];

const LIMITS: Array<[string, string]> = [
  ["\\lim_{x\\to0}\\frac{\\sin(x)}{x}", "1"],
  ["\\lim_{x\\to2}\\frac{x^{2}-4}{x-2}", "4"],
  ["\\lim_{x\\to0}\\frac{1-\\cos(x)}{x^{2}}", "\\frac{1}{2}"],
  ["\\lim_{x\\to3}(x^{2}+1)", "10"],
  ["\\lim_{x\\to\\infty}\\frac{1}{x}", "0"],
  ["\\lim_{x\\to\\infty}\\frac{2x^{2}+1}{x^{2}-3}", "2"],
  ["\\lim_{x\\to\\infty}\\frac{x}{x^{2}+1}", "0"],
  ["\\lim_{x\\to1}\\frac{x^{3}-1}{x-1}", "3"],
];

describe("exact values, checked against the unit circle by hand", () => {
  for (const [p, want] of EXACT) {
    it(`${p} = ${want}`, () => {
      const r = trySolve(p);
      if (!r.ok) throw new Error(`${p}: ${r.message}`);
      expect(r.solution.answer).toBe(want);
      expect(r.solution.verified).toBe(true);
    });
  }
});

describe("limits, checked against hand-written answers", () => {
  for (const [p, want] of LIMITS) {
    it(`${p} = ${want}`, () => {
      const r = trySolve(p);
      if (!r.ok) throw new Error(`${p}: ${r.message}`);
      expect(r.solution.answer).toBe(want);
    });
  }
});

describe("undefined values are refused", () => {
  for (const p of ["\\tan(\\frac{\\pi}{2})", "\\ln(0)", "\\log(-100)", "\\arcsin(2)"]) {
    it(`refuses ${p}`, () => expect(trySolve(p).ok).toBe(false));
  }
});

describe("e is a constant, not an unknown", () => {
  it("does not solve 2e = 4 by redefining e", () => {
    const r = trySolve("2e=4");
    if (r.ok) expect(r.solution.answer).not.toContain("e = 2");
  });
});
