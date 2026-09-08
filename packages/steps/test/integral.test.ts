import { describe, expect, it } from "vitest";
import { asIntegral, parseLatex } from "@openmath/math-core";
import {
  classify, trySolve, verifyAntiderivative, verifyDifferByConstant,
  verifyIntegrationStep,
} from "@openmath/steps";
import type { Solution } from "@openmath/steps";

function solved(latex: string): Solution {
  const outcome = trySolve(latex);
  if (!outcome.ok) throw new Error(`${latex}: ${outcome.reason} - ${outcome.message}`);
  return outcome.solution;
}

const ruleIds = (latex: string): string[] => solved(latex).steps.map((s) => s.ruleId);

const refusal = (latex: string): string => {
  const outcome = trySolve(latex);
  if (outcome.ok) throw new Error(`${latex} was answered: ${outcome.solution.answer}`);
  return outcome.message;
};

describe("classifying", () => {
  it("routes anything containing an integral to integration", () => {
    expect(classify(parseLatex("\\int x \\, dx")).kind).toBe("integrate");
    expect(classify(parseLatex("\\int_{0}^{1} x \\, dx")).kind).toBe("integrate");
    expect(classify(parseLatex("\\int t \\, dt")).variable).toBe("t");
  });
});

describe("the working an integral shows", () => {
  it("splits a sum before integrating the pieces", () => {
    expect(ruleIds("\\int (x^{2}+3x) \\, dx")).toContain("INT_SUM");
  });

  it("takes a constant factor outside first", () => {
    expect(ruleIds("\\int 5x^{4} \\, dx")).toContain("INT_CONSTANT_MULTIPLE");
  });

  it("names the technique it used", () => {
    expect(ruleIds("\\int 2x(x^{2}+1)^{3} \\, dx")).toContain("INT_SUBSTITUTION");
    expect(ruleIds("\\int x\\sin(x) \\, dx")).toContain("INT_BY_PARTS");
    expect(ruleIds("\\int \\frac{5x-3}{x^{2}-2x-3} \\, dx")).toContain("INT_PARTIAL_FRACTIONS");
    expect(ruleIds("\\int \\frac{x^{2}}{x+1} \\, dx")).toContain("INT_LONG_DIVISION");
  });

  it("adds the constant of integration once, at the end", () => {
    const solution = solved("\\int (x^{2}+3x) \\, dx");
    const ids = solution.steps.map((s) => s.ruleId);
    expect(ids.filter((id) => id === "INT_ADD_CONSTANT")).toHaveLength(1);
    expect(ids[ids.length - 1]).toBe("INT_ADD_CONSTANT");
    // No intermediate step carries it around.
    for (const step of solution.steps.slice(0, -1)) expect(step.after).not.toContain("C");
    expect(solution.answer.endsWith("+ C")).toBe(true);
  });

  it("carries a variable that is not x", () => {
    const solution = solved("\\int t^{2} \\, dt");
    expect(solution.variable).toBe("t");
    expect(solution.answer).toContain("t");
  });

  it("reports every step as verified", () => {
    for (const latex of [
      "\\int x^{2} \\, dx", "\\int 2x(x^{2}+1)^{3} \\, dx", "\\int x^{2}e^{x} \\, dx",
      "\\int \\frac{1}{x^{2}-1} \\, dx", "\\int_{0}^{1} e^{x} \\, dx",
    ]) {
      const solution = solved(latex);
      expect(solution.verified, latex).toBe(true);
      expect(solution.incomplete ?? false, latex).toBe(false);
      expect(solution.steps.every((s) => !s.unverified), latex).toBe(true);
    }
  });
});

describe("definite integrals", () => {
  it("evaluates at the limits in a step of its own", () => {
    const solution = solved("\\int_{0}^{1} x^{2} \\, dx");
    const evaluate = solution.steps.find((s) => s.ruleId === "INT_EVALUATE_LIMITS");
    expect(evaluate).toBeDefined();
    expect(evaluate!.before).toBe("\\frac{x^{3}}{3}");
    expect(evaluate!.after).toBe("\\frac{1^{3}}{3} - \\frac{0^{3}}{3}");
    expect(solution.answer).toBe("\\frac{1}{3}");
  });

  it("sets the limits aside while the antiderivative is found", () => {
    const ids = ruleIds("\\int_{1}^{3} 2x \\, dx");
    expect(ids[0]).toBe("INT_DEFINITE_SETUP");
    expect(ids).toContain("INT_EVALUATE_LIMITS");
  });

  it("does not put a constant of integration on a number", () => {
    expect(solved("\\int_{1}^{3} 2x \\, dx").answer).toBe("8");
  });

  it("declines a pole between the limits rather than returning a number", () => {
    expect(refusal("\\int_{-1}^{1} \\frac{1}{x} \\, dx")).toMatch(/improper/);
    expect(refusal("\\int_{0}^{1} \\frac{1}{x} \\, dx")).toMatch(/improper/);
    expect(refusal("\\int_{-2}^{2} \\frac{1}{x^{2}-1} \\, dx")).toMatch(/improper/);
  });
});

describe("what it declines", () => {
  it("refuses an integrand with no elementary antiderivative", () => {
    expect(refusal("\\int e^{x^{2}} \\, dx")).toMatch(/not supported yet/);
    expect(refusal("\\int \\sin(x^{2}) \\, dx")).toMatch(/not supported yet/);
    expect(refusal("\\int \\frac{1}{\\ln(x)} \\, dx")).toMatch(/not supported yet/);
  });

  it("names the piece it got stuck on", () => {
    expect(refusal("\\int e^{x^{2}} \\, dx")).toContain("e^{x^{2}}");
  });

  it("refuses a second letter rather than guessing what it stands for", () => {
    expect(refusal("\\int ax \\, dx")).toMatch(/could be a constant/);
  });

  it("refuses an equation containing an integral", () => {
    expect(refusal("\\int x \\, dx = 5")).toMatch(/equations/);
  });

  it("refuses a definite integral buried in a larger expression", () => {
    expect(refusal("\\int_{0}^{1} x \\, dx + 5")).toMatch(/whole problem/);
  });
});

describe("the differentiate-back check", () => {
  it("accepts a correct antiderivative", () => {
    const body = asIntegral(parseLatex("\\int x^{2} \\, dx"))!.body;
    expect(verifyAntiderivative(parseLatex("\\frac{x^{3}}{3}"), body, "x")).toBe("ok");
    // Any member of the family, not just the one the engine happens to pick.
    expect(verifyAntiderivative(parseLatex("\\frac{x^{3}}{3} + 7"), body, "x")).toBe("ok");
  });

  it("catches an answer that is a different function", () => {
    const body = asIntegral(parseLatex("\\int x^{2} \\, dx"))!.body;
    expect(verifyAntiderivative(parseLatex("\\frac{x^{3}}{2}"), body, "x")).toBe("mismatch");
    expect(verifyAntiderivative(parseLatex("3x^{2}"), body, "x")).toBe("mismatch");
    // The classic chain-rule slip: the inside derivative left off.
    const chained = asIntegral(parseLatex("\\int \\sin(3x) \\, dx"))!.body;
    expect(verifyAntiderivative(parseLatex("-\\cos(3x)"), chained, "x")).toBe("mismatch");
    expect(verifyAntiderivative(parseLatex("-\\frac{\\cos(3x)}{3}"), chained, "x")).toBe("ok");
  });

  it("treats two antiderivatives a constant apart as the same answer", () => {
    expect(
      verifyDifferByConstant(parseLatex("\\frac{x^{2}}{2}"), parseLatex("\\frac{x^{2}+1}{2}")),
    ).toBe("ok");
    expect(
      verifyDifferByConstant(parseLatex("\\frac{x^{2}}{2}"), parseLatex("\\frac{x^{2}}{3}")),
    ).toBe("mismatch");
  });

  it("checks a step that still contains an integral by differentiating it", () => {
    const before = parseLatex("\\int (x^{2}+3x) \\, dx");
    expect(
      verifyIntegrationStep(before, parseLatex("\\int x^{2} \\, dx + \\int 3x \\, dx"), "x"),
    ).toBe("ok");
    // A term dropped on the way through the sum rule.
    expect(
      verifyIntegrationStep(before, parseLatex("\\int x^{2} \\, dx + \\int x \\, dx"), "x"),
    ).toBe("mismatch");
    // And a constant pulled out with the wrong value.
    expect(
      verifyIntegrationStep(parseLatex("\\int 5x \\, dx"), parseLatex("2\\int x \\, dx"), "x"),
    ).toBe("mismatch");
  });

  it("says it does not know rather than passing an unreadable step", () => {
    const before = parseLatex("\\int x \\, dx");
    expect(verifyIntegrationStep(before, parseLatex("x"), undefined)).toBe("unknown");
    // An integral in another variable is not something these rules produce.
    expect(verifyIntegrationStep(before, parseLatex("\\int u \\, du"), "x")).toBe("unknown");
  });

  it("is what the solver's verified flag is set from", () => {
    const solution = solved("\\int 2x(x^{2}+1)^{3} \\, dx");
    const body = asIntegral(parseLatex("\\int 2x(x^{2}+1)^{3} \\, dx"))!.body;
    expect(solution.verified).toBe(true);
    expect(verifyAntiderivative(parseLatex(solution.answer), body, "x")).toBe("ok");
  });
});
