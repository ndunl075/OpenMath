import { describe, expect, it } from "vitest";
import {
  asLimit, containsInfinity, evaluateNumeric, INFINITY, isInfinity,
  limitNumerically, ParseError, parseLatex, sequenceLimit, toDebug, toLatex,
} from "@openmath/math-core";

const d = (s: string) => toDebug(parseLatex(s));

describe("parsing limits", () => {
  it("reads the expression, the variable and the point", () => {
    expect(d("\\lim_{x \\to 0} \\frac{\\sin(x)}{x}")).toBe("(lim (/ (sin x) x) x 0 0)");
    const l = asLimit(parseLatex("\\lim_{t \\to 2} t^{2}"))!;
    expect(l.variable).toBe("t");
    expect(toLatex(l.point)).toBe("2");
    expect(l.side).toBe("both");
    expect(toLatex(l.body)).toBe("t^{2}");
  });

  it("reads infinity as the point", () => {
    const l = asLimit(parseLatex("\\lim_{x \\to \\infty} \\frac{1}{x}"))!;
    expect(l.point.type).toBe("sym");
    expect(isInfinity(l.point)).toBe(true);
    const negative = asLimit(parseLatex("\\lim_{x \\to -\\infty} \\frac{1}{x}"))!;
    expect(isInfinity(negative.point)).toBe(true);
    expect(evaluateNumeric(negative.point)).toBe(-Infinity);
  });

  it("reads the side a one-sided limit approaches from", () => {
    for (const [latex, side] of [
      ["\\lim_{x \\to 0^+} \\frac{1}{x}", "right"],
      ["\\lim_{x \\to 0^{+}} \\frac{1}{x}", "right"],
      ["\\lim_{x \\to 0^-} \\frac{1}{x}", "left"],
      ["\\lim_{x \\to 0^{-}} \\frac{1}{x}", "left"],
      ["\\lim_{x \\to 2} \\frac{1}{x}", "both"],
    ] as const) {
      expect(asLimit(parseLatex(latex))!.side, latex).toBe(side);
    }
  });

  it("stops the body at a bracket, as the derivative operator does", () => {
    // Otherwise a factor written after the limit would be swallowed into it and
    // the printed step would not read back as the same expression.
    expect(d("\\lim_{x \\to 1}(x)(y)")).toBe("(* (lim x x 1 0) y)");
  });

  it("takes \\rightarrow and \\limits as well", () => {
    expect(d("\\lim\\limits_{x \\rightarrow 0} x")).toBe("(lim x x 0 0)");
  });

  it("refuses a limit that does not say what approaches what", () => {
    expect(() => parseLatex("\\lim f(x)")).toThrow(ParseError);
    expect(() => parseLatex("\\lim_{x} x")).toThrow(/\\to/);
    expect(() => parseLatex("\\lim_{x \\to} x")).toThrow(ParseError);
  });

  it("round-trips through the serializer", () => {
    for (const c of [
      "\\lim_{x \\to 0}\\left(\\frac{\\sin\\left(x\\right)}{x}\\right)",
      "\\lim_{x \\to \\infty}\\left(\\frac{1}{x}\\right)",
      "\\lim_{x \\to 0^{+}}\\left(\\sqrt{x}\\right)",
      "\\lim_{x \\to -\\infty}\\left(x^{2}\\right)",
    ]) {
      expect(toLatex(parseLatex(c))).toBe(c);
    }
  });
});

describe("infinity", () => {
  it("is a reserved constant, not a variable", () => {
    const n = parseLatex("\\infty");
    expect(n.type === "sym" && n.name === INFINITY).toBe(true);
    expect(evaluateNumeric(n)).toBe(Infinity);
    expect(evaluateNumeric(parseLatex("-\\infty"))).toBe(-Infinity);
    expect(containsInfinity(parseLatex("\\lim_{x \\to \\infty} x"))).toBe(true);
    expect(containsInfinity(parseLatex("2x+1"))).toBe(false);
  });
});

describe("the numeric limit", () => {
  it("finds where a sequence of samples is heading", () => {
    // Linear convergence towards 4, the shape the sampling ladder produces.
    expect(sequenceLimit([4.2, 4.02, 4.002, 4.0002, 4.00002])).toBeCloseTo(4, 9);
    expect(sequenceLimit([0.1, 0.01, 0.001, 0.0001])).toBeCloseTo(0, 9);
  });

  it("returns NaN rather than guessing at a sequence that never settles", () => {
    expect(sequenceLimit([10, 100, 1000, 10000])).toBeNaN();
    expect(sequenceLimit([1, -1, 1, -1])).toBeNaN();
    expect(sequenceLimit([1, 2])).toBeNaN();
    expect(sequenceLimit([1, 2, NaN])).toBeNaN();
  });

  it("measures a limit by walking in towards the point", () => {
    const at = (latex: string) => evaluateNumeric(parseLatex(latex));
    expect(at("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}")).toBeCloseTo(1, 8);
    expect(at("\\lim_{x \\to 2}\\frac{x^{2}-4}{x-2}")).toBeCloseTo(4, 8);
    expect(at("\\lim_{x \\to \\infty}\\frac{2x^{2}+1}{x^{2}+3}")).toBeCloseTo(2, 8);
    expect(at("\\lim_{x \\to 0^{+}}\\sqrt{x}")).toBeCloseTo(0, 8);
  });

  it("reports no limit where the two sides disagree or nothing settles", () => {
    const at = (latex: string) => evaluateNumeric(parseLatex(latex));
    expect(at("\\lim_{x \\to 0}\\frac{1}{x}")).toBeNaN();
    expect(at("\\lim_{x \\to 0}\\frac{\\left|x\\right|}{x}")).toBeNaN();
    expect(at("\\lim_{x \\to \\infty}x^{2}")).toBeNaN();
    // Undefined to the left of zero, so the two-sided limit is not there.
    expect(at("\\lim_{x \\to 0}\\sqrt{x}")).toBeNaN();
  });

  it("keeps away from the point far enough to survive cancellation", () => {
    // (x^2 - 4)/(x - 2) is a difference of two nearly equal numbers near 2.
    // Sampling at 1e-15 would return rounding noise; this stays accurate.
    const f = (x: number) => (x * x - 4) / (x - 2);
    expect(limitNumerically(f, 2, "both")).toBeCloseTo(4, 8);
    expect(limitNumerically(f, 2, "left")).toBeCloseTo(4, 8);
    expect(limitNumerically(f, 2, "right")).toBeCloseTo(4, 8);
  });

  it("takes each side separately when asked for one", () => {
    const f = (x: number) => Math.abs(x) / x;
    expect(limitNumerically(f, 0, "right")).toBeCloseTo(1, 9);
    expect(limitNumerically(f, 0, "left")).toBeCloseTo(-1, 9);
    expect(limitNumerically(f, 0, "both")).toBeNaN();
  });
});
