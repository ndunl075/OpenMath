import { describe, expect, it } from "vitest";
import { problems } from "@openmath/corpus";
import { parseLatex, Rational, toLatex } from "@openmath/math-core";
import {
  classify, everyRule, explanationKeys, isFactoringProblem, polyCoefficients,
  rationalRootCandidates, syntheticDivision, trySolve,
} from "@openmath/steps";
import type { Solution, Step } from "@openmath/steps";

function solved(latex: string): Solution {
  const outcome = trySolve(latex);
  if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
  return outcome.solution;
}

function ruleIds(steps: Step[]): string[] {
  return steps.map((s) => s.ruleId);
}

describe("factoring or expanding, decided once", () => {
  it("expands a product and factors a sum, and does not chase its own tail", () => {
    // These two are each other's answer. The classifier is what stops them
    // ping-ponging: the shape of the input picks the direction.
    expect(solved("(x+1)(x+2)").answer).toBe("x^{2} + 3 x + 2");
    expect(solved("x^{2}+3x+2").answer).toBe("\\left(x + 1\\right) \\left(x + 2\\right)");
    expect(solved("(x+1)(x+2)").kind).toBe("simplify");
    expect(solved("x^{2}+3x+2").kind).toBe("factor");
  });

  it("only reads a collected, single-variable sum as a factoring problem", () => {
    const factors = (s: string) => isFactoringProblem(parseLatex(s));
    expect(factors("x^{2}-9")).toBe(true);
    expect(factors("2x^{2}+4x")).toBe(true);
    // Like terms not yet collected: simplifying comes first.
    expect(factors("2x+3x")).toBe(false);
    expect(factors("2x+3+4x+5")).toBe(false);
    // Already a product, or a bracket to multiply out.
    expect(factors("(x+1)(x+2)")).toBe(false);
    expect(factors("2(x+3)")).toBe(false);
    expect(factors("2(x+1)+3(x-2)")).toBe(false);
    // Two variables, and a fraction: neither is a factoring exercise.
    expect(factors("2x+3y+4x")).toBe(false);
    expect(factors("\\frac{x}{2}+\\frac{x}{3}")).toBe(false);
  });

  it("leaves an expression that does not factor exactly as it was", () => {
    const s = solved("x^{2}+1");
    expect(s.answer).toBe("x^{2} + 1");
    expect(s.kind).toBe("simplify");
    expect(s.steps).toHaveLength(0);
  });

  it("takes the common factor out before anything else", () => {
    expect(ruleIds(solved("3x^{2}-12").steps)).toEqual([
      "FACTOR_COMMON_FACTOR",
      "FACTOR_DIFFERENCE_OF_SQUARES",
    ]);
  });

  it("groups four terms into a shared bracket", () => {
    const steps = solved("x^{3}+3x^{2}-4x-12").steps;
    expect(steps[0]!.ruleId).toBe("FACTOR_BY_GROUPING");
    expect(steps[0]!.after).toBe("x^{2} \\left(x + 3\\right) - 4 \\left(x + 3\\right)");
  });

  it("classifies a bare polynomial as a factoring problem", () => {
    expect(classify(parseLatex("x^{2}-9")).kind).toBe("factor");
    expect(classify(parseLatex("(x-3)(x+3)")).kind).toBe("simplify");
  });
});

describe("the rational root theorem", () => {
  it("lists factors of the constant over factors of the leading coefficient", () => {
    const coeffs = polyCoefficients(
      new Map([
        [0, Rational.of(2)],
        [1, Rational.of(-3)],
        [2, Rational.of(-3)],
        [3, Rational.of(2)],
      ]),
    );
    const candidates = rationalRootCandidates(coeffs)!.map((c) => c.toString());
    expect(candidates).toEqual(["1", "-1", "2", "-2", "1/2", "-1/2"]);
  });

  it("divides a found root out exactly", () => {
    const coeffs = [Rational.of(-6), Rational.of(11), Rational.of(-6), Rational.of(1)];
    const { quotient, remainder } = syntheticDivision(coeffs, Rational.of(1));
    expect(remainder.toString()).toBe("0");
    expect(quotient.map((c) => c.toString())).toEqual(["6", "-5", "1"]);
  });

  it("shows the candidates, the division and the zero product", () => {
    expect(ruleIds(solved("x^{3}-6x^{2}+11x-6=0").steps)).toEqual([
      "RATIONAL_ROOT_CANDIDATES",
      "SYNTHETIC_DIVISION",
      "FACTOR_QUADRATIC",
      "ZERO_PRODUCT",
    ]);
  });

  it("finds x = 0 by taking the variable out, which the theorem cannot see", () => {
    const s = solved("x^{3}-x=0");
    expect(s.steps[0]!.ruleId).toBe("FACTOR_OUT_VARIABLE");
    expect(s.answers).toEqual(["x = -1", "x = 0", "x = 1"]);
  });

  it("declines a cubic with no rational root instead of approximating", () => {
    const outcome = trySolve("x^{3}-2=0");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe("unsupported");
      expect(outcome.message).toContain("no rational root");
    }
  });
});

describe("radical equations check their answers", () => {
  it("throws out the root that squaring invented", () => {
    const s = solved("\\sqrt{2x+3}=x");
    expect(s.answers).toEqual(["x = 3"]);
    const check = s.steps.at(-1)!;
    expect(check.ruleId).toBe("CHECK_EXTRANEOUS");
    expect(check.before).toBe("\\sqrt{2 x + 3} = x");
    expect(check.explanation).toContain("x = -1");
    expect(s.note).toContain("extraneous");
  });

  it("still shows the check when nothing is extraneous", () => {
    const s = solved("\\sqrt{x+1}=4");
    expect(s.steps.at(-1)!.ruleId).toBe("CHECK_NO_EXTRANEOUS");
  });

  it("reports no solution when every candidate fails the original", () => {
    const s = solved("\\sqrt{x}=-2");
    expect(s.answers).toEqual([]);
    expect(s.answer).toBe("\\text{no solution}");
  });

  it("isolates the radical before squaring", () => {
    expect(ruleIds(solved("\\sqrt{x}+2=5").steps)).toEqual([
      "ISOLATE_RADICAL",
      "ADD_NUMBERS",
      "SQUARE_BOTH_SIDES",
      "EVALUATE_POWER",
      "CHECK_NO_EXTRANEOUS",
    ]);
  });
});

describe("exponential and logarithmic equations", () => {
  it("matches the bases when it can, and takes a logarithm when it cannot", () => {
    expect(ruleIds(solved("2^{x}=8").steps)).toEqual(["MATCH_BASES", "EQUATE_EXPONENTS"]);
    expect(ruleIds(solved("e^{x}=5").steps)).toEqual(["TAKE_LOGARITHM"]);
  });

  it("keeps an irrational answer exact rather than rounding it", () => {
    expect(solved("\\ln(x)=2").answer).toBe("x = e^{2}");
    expect(solved("e^{x}=5").answer).toBe("x = \\ln\\left(5\\right)");
  });

  it("rejects a candidate that would take the log of a negative number", () => {
    const s = solved("\\log(x)+\\log(x-3)=1");
    expect(s.answers).toEqual(["x = 5"]);
    const check = s.steps.at(-1)!;
    expect(check.ruleId).toBe("REJECT_LOG_DOMAIN");
    expect(check.explanation).toContain("x = -2");
  });

  it("has no solution when an exponential is asked to be negative", () => {
    const s = solved("2^{x}=-4");
    expect(s.answer).toBe("\\text{no solution}");
    expect(s.steps.at(-1)!.ruleId).toBe("EXPONENTIAL_ALWAYS_POSITIVE");
  });
});

describe("interval answers", () => {
  it("gives one interval for a bounded solution set", () => {
    const s = solved("\\left|x-2\\right|<5");
    expect(s.answer).toBe("-3 < x < 7");
    expect(s.intervals).toHaveLength(1);
    const [only] = s.intervals!;
    expect(toLatex(only!.lower!.value)).toBe("-3");
    expect(toLatex(only!.upper!.value)).toBe("7");
    expect(only!.lower!.closed).toBe(false);
  });

  it("gives two intervals for a union, each open at one end only", () => {
    const s = solved("x^{2}>4");
    expect(s.answer).toBe("x < -2 \\quad \\text{or} \\quad x > 2");
    expect(s.intervals).toHaveLength(2);
    const [below, above] = s.intervals!;
    expect(below!.lower).toBeUndefined();
    expect(toLatex(below!.upper!.value)).toBe("-2");
    expect(toLatex(above!.lower!.value)).toBe("2");
    expect(above!.upper).toBeUndefined();
  });

  it("records a closed bound for a non-strict inequality", () => {
    const s = solved("x^{2}\\le9");
    expect(s.intervals![0]!.lower!.closed).toBe(true);
    expect(s.answer).toBe("-3 \\le x \\le 3");
  });

  it("keeps an irrational boundary as a radical", () => {
    expect(solved("x^{2}>2").answer).toBe(
      "x < -\\sqrt{2} \\quad \\text{or} \\quad x > \\sqrt{2}",
    );
  });

  it("describes a linear inequality as a half-line too", () => {
    const s = solved("3x+1\\le7");
    expect(s.answer).toBe("x \\le 2");
    expect(s.intervals).toHaveLength(1);
    expect(s.intervals![0]!.upper!.closed).toBe(true);
  });

  it("turns the inequality round when the leading coefficient is negative", () => {
    const s = solved("-x^{2}+4>0");
    expect(s.steps[0]!.ruleId).toBe("MULTIPLY_BY_NEGATIVE");
    expect(s.answer).toBe("-2 < x < 2");
  });
});

describe("explanations", () => {
  it("covers every rule in every pipeline", () => {
    const keys = new Set(explanationKeys("en"));
    const missing = everyRule.map((r) => r.id).filter((id) => !keys.has(id));
    expect(missing, "rules without an explanation").toEqual([]);
  });

  it("covers every step the corpus actually produces, display steps included", () => {
    const keys = new Set(explanationKeys("en"));
    const missing = new Set<string>();
    for (const p of problems) {
      const outcome = trySolve(p.latex);
      if (!outcome.ok) continue;
      for (const step of outcome.solution.steps) {
        if (!keys.has(step.ruleId)) missing.add(step.ruleId);
      }
    }
    expect([...missing], "step ids without an explanation").toEqual([]);
  });

  it("leaves no unfilled placeholder anywhere in the corpus", () => {
    // A placeholder whose value was never supplied renders as an empty string,
    // never as "{name}", so the gap it leaves is the only evidence: a doubled
    // space, or a space before punctuation. Matching braces instead would flag
    // legitimate LaTeX values such as e^{x}.
    for (const p of problems) {
      const outcome = trySolve(p.latex);
      if (!outcome.ok) continue;
      for (const step of outcome.solution.steps) {
        const where = `${p.latex} / ${step.ruleId}`;
        expect(step.title.trim(), where).not.toBe("");
        expect(step.explanation.trim(), where).not.toBe("");
        expect(step.title, where).not.toMatch(/ {2}|\s[.,]/);
        expect(step.explanation, where).not.toMatch(/ {2}|\s[.,]/);
      }
    }
  });
});
