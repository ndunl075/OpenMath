import { describe, expect, it } from "vitest";
import { ParseError, parseLatex, toDebug, toLatex } from "@openmath/math-core";

const d = (s: string) => toDebug(parseLatex(s));

describe("parser", () => {
  it("parses arithmetic with precedence", () => {
    expect(d("1+2*3")).toBe("(+ 1 (* 2 3))");
    expect(d("(1+2)*3")).toBe("(* (+ 1 2) 3)");
    expect(d("1-2-3")).toBe("(+ 1 (- 2) (- 3))");
  });

  it("treats adjacency as multiplication", () => {
    expect(d("2x")).toBe("(* 2 x)");
    expect(d("xy")).toBe("(* x y)");
    expect(d("2(x+1)")).toBe("(* 2 (+ x 1))");
    expect(d("(x+1)(x-2)")).toBe("(* (+ x 1) (+ x (- 2)))");
  });

  it("binds powers tighter than multiplication and right-associates", () => {
    expect(d("2x^2")).toBe("(* 2 (^ x 2))");
    expect(d("2^3^2")).toBe("(^ 2 (^ 3 2))");
    expect(d("-x^2")).toBe("(- (^ x 2))");
    expect(d("x^{-1}")).toBe("(^ x (- 1))");
  });

  it("handles fractions, roots and functions", () => {
    expect(d("\\frac{1}{2}")).toBe("(/ 1 2)");
    expect(d("\\frac{x+1}{2}")).toBe("(/ (+ x 1) 2)");
    expect(d("\\sqrt{9}")).toBe("(sqrt 9)");
    expect(d("\\sqrt[3]{8}")).toBe("(root 8 3)");
    expect(d("\\sin x")).toBe("(sin x)");
    expect(d("\\sin(2x)")).toBe("(sin (* 2 x))");
    expect(d("\\sin 2x")).toBe("(sin (* 2 x))");
    expect(d("|x|")).toBe("(abs x)");
  });

  it("parses equations and inequalities", () => {
    expect(d("2x+3=7")).toBe("(= (+ (* 2 x) 3) 7)");
    expect(d("x \\le 5")).toBe("(<= x 5)");
  });

  it("ignores layout commands and \\left \\right", () => {
    expect(d("\\left(x+1\\right)")).toBe("(+ x 1)");
    expect(d("\\displaystyle 2x")).toBe("(* 2 x)");
    expect(d("2 \\cdot 3")).toBe("(* 2 3)");
    expect(d("6 \\div 2")).toBe("(/ 6 2)");
  });

  it("supports subscripted variables", () => {
    expect(d("x_1+x_{12}")).toBe("(+ x_1 x_12)");
  });

  it("reports the position of a syntax error", () => {
    expect(() => parseLatex("2x+")).toThrow(ParseError);
    expect(() => parseLatex("\\foo{2}")).toThrow(/unsupported command/);
    try {
      parseLatex("(1+2");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).pos).toBe(4);
    }
  });

  it("round-trips through the serializer", () => {
    const cases = [
      "2x + 3", "\\frac{x + 1}{2}", "x^{2} - 4", "2x = 7",
      "\\sqrt{x + 1}", "-3x^{2} + x", "\\frac{1}{2}x",
    ];
    for (const c of cases) {
      const once = toLatex(parseLatex(c));
      const twice = toLatex(parseLatex(once));
      expect(twice).toBe(once);
    }
  });
});
