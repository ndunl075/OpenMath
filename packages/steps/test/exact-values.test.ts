import { describe, expect, it } from "vitest";
import { evaluateNumeric, parseLatex } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";

function solved(latex: string) {
  const outcome = trySolve(latex);
  if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
  return outcome.solution;
}

const answer = (latex: string) => solved(latex).answer;

describe("trigonometry at the named angles", () => {
  it("answers with a number instead of the question", () => {
    expect(answer("\\sin(0)")).toBe("0");
    expect(answer("\\cos(0)")).toBe("1");
    expect(answer("\\sin(\\pi)")).toBe("0");
    expect(answer("\\sin(\\frac{\\pi}{6})")).toBe("\\frac{1}{2}");
    expect(answer("\\tan(\\frac{\\pi}{3})")).toBe("\\sqrt{3}");
    expect(answer("\\sin(\\frac{7\\pi}{6})")).toBe("-\\frac{1}{2}");
  });

  it("keeps the answer exact rather than decimal", () => {
    const exact = answer("\\cos(\\frac{\\pi}{4})");
    expect(exact).toBe("\\frac{\\sqrt{2}}{2}");
    expect(exact).not.toMatch(/0\.7/);
    expect(evaluateNumeric(parseLatex(exact))).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("takes an angle round the circle, in either direction", () => {
    expect(answer("\\cos(\\frac{13\\pi}{6})")).toBe(answer("\\cos(\\frac{\\pi}{6})"));
    expect(answer("\\sin(-\\frac{\\pi}{6})")).toBe("-\\frac{1}{2}");
    expect(answer("\\sin(\\frac{25\\pi}{6})")).toBe("\\frac{1}{2}");
  });

  it("shows the reading as a step, not as a silent rewrite", () => {
    const s = solved("\\sin(\\frac{\\pi}{6})");
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0]!.ruleId).toBe("EVALUATE_TRIG");
    expect(s.steps[0]!.title).toContain("exact value");
  });

  it("leaves an angle with no closed form exactly as it was", () => {
    expect(answer("\\sin(\\frac{\\pi}{5})")).toBe("\\sin\\left(\\frac{\\pi}{5}\\right)");
    expect(solved("\\sin(\\frac{\\pi}{5})").steps).toHaveLength(0);
  });

  it("declines an angle where the function has no value", () => {
    for (const latex of ["\\tan(\\frac{\\pi}{2})", "\\tan(\\frac{3\\pi}{2})", "\\cot(0)"]) {
      const outcome = trySolve(latex);
      expect(outcome.ok, latex).toBe(false);
      if (!outcome.ok) expect(outcome.message).toMatch(/asymptote/);
    }
  });

  it("reads the inverse functions back to an angle", () => {
    expect(answer("\\arcsin(1)")).toBe("\\frac{\\pi}{2}");
    expect(answer("\\arctan(1)")).toBe("\\frac{\\pi}{4}");
    expect(answer("\\arccos(-1)")).toBe("\\pi");
  });

  it("uses the Pythagorean identity", () => {
    expect(answer("\\sin(x)^{2}+\\cos(x)^{2}")).toBe("1");
    expect(answer("\\sin(2x)^{2}+\\cos(2x)^{2}")).toBe("1");
    // Different angles are not the identity, so nothing should fire.
    expect(answer("\\sin(x)^{2}+\\cos(y)^{2}")).toBe(
      "\\sin\\left(x\\right)^{2} + \\cos\\left(y\\right)^{2}",
    );
  });
});

describe("logarithms", () => {
  it("works out the ones with an exact answer", () => {
    expect(answer("\\log_{2}(8)")).toBe("3");
    expect(answer("\\log(100)")).toBe("2");
    expect(answer("\\ln(e)")).toBe("1");
    expect(answer("\\ln(1)")).toBe("0");
    expect(answer("\\ln(e^{5})")).toBe("5");
    expect(answer("\\log_{2}(\\frac{1}{8})")).toBe("-3");
  });

  it("leaves one with no exact answer alone rather than approximating it", () => {
    expect(answer("\\log_{2}(10)")).toBe("\\log_{2}\\left(10\\right)");
    expect(answer("\\log_{2}(10)")).not.toMatch(/3\.3/);
    expect(solved("\\log_{2}(10)").steps).toHaveLength(0);
  });

  it("declines a logarithm that has no value", () => {
    for (const latex of ["\\ln(0)", "\\log(-100)", "\\log_{2}(0)"]) {
      const outcome = trySolve(latex);
      expect(outcome.ok, latex).toBe(false);
      if (!outcome.ok) expect(outcome.message).toMatch(/positive/);
    }
  });

  it("shows the log laws as steps", () => {
    expect(answer("\\ln(x)+\\ln(y)")).toBe("\\ln\\left(x y\\right)");
    expect(answer("\\ln(x)-\\ln(y)")).toBe("\\ln\\left(\\frac{x}{y}\\right)");
    expect(answer("\\ln(x^{3})")).toBe("3 \\ln\\left(x\\right)");
    expect(solved("\\ln(x)+\\ln(y)").steps[0]!.ruleId).toBe("LOG_PRODUCT");
    expect(solved("\\ln(x)-\\ln(y)").steps[0]!.ruleId).toBe("LOG_QUOTIENT");
    expect(solved("\\ln(x^{3})").steps[0]!.ruleId).toBe("LOG_POWER");
  });

  it("keeps the bases apart", () => {
    // Logs over different bases do not combine; claiming they do would be wrong.
    expect(answer("\\ln(x)+\\log(y)")).toBe(
      "\\ln\\left(x\\right) + \\log\\left(y\\right)",
    );
    expect(answer("\\log_{2}(x)+\\log_{2}(y)")).toBe("\\log_{2}\\left(x y\\right)");
  });
});
