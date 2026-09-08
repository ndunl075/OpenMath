import { describe, expect, it } from "vitest";
import { evaluateExact, evaluateNumeric, parseLatex } from "@openmath/math-core";

describe("evaluate", () => {
  it("evaluates numerically with an environment", () => {
    expect(evaluateNumeric(parseLatex("2x+1"), { x: 3 })).toBe(7);
    expect(evaluateNumeric(parseLatex("x^2"), { x: -3 })).toBe(9);
    expect(evaluateNumeric(parseLatex("\\frac{1}{x}"), { x: 0 })).toBeNaN();
    expect(evaluateNumeric(parseLatex("\\sqrt{x}"), { x: -1 })).toBeNaN();
  });

  it("evaluates exactly and refuses irrational results", () => {
    expect(evaluateExact(parseLatex("\\frac{1}{3}+\\frac{1}{6}"))!.toString()).toBe("1/2");
    expect(evaluateExact(parseLatex("\\sqrt{9}"))!.toString()).toBe("3");
    expect(evaluateExact(parseLatex("\\sqrt{2}"))).toBeNull();
    expect(evaluateExact(parseLatex("2^{10}"))!.toString()).toBe("1024");
    expect(evaluateExact(parseLatex("x+1"))).toBeNull();
  });
});
