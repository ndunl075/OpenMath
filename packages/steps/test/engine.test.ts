import { describe, expect, it } from "vitest";
import { parseLatex, toLatex } from "@openmath/math-core";
import {
  allRules, explain, explanationKeys, expressionRules, normalize, run,
  verifyEquationEquivalent, verifyEquivalent,
} from "@openmath/steps";
import type { Rule } from "@openmath/steps";

const simplify = (s: string) => toLatex(run(parseLatex(s), expressionRules, {}).node);

describe("engine", () => {
  it("normalises without emitting steps", () => {
    expect(toLatex(normalize(parseLatex("--x")))).toBe("x");
    expect(toLatex(normalize(parseLatex("2\\cdot(3\\cdot x)")))).toBe("2 \\cdot 3 x");
    // An even number of minus signs cancels; folding the numbers is a visible step.
    expect(toLatex(normalize(parseLatex("(-x)(-y)")))).toBe("x y");
    expect(simplify("(-2)(-3)x")).toBe("6 x");
  });

  it("stops instead of looping when rules disagree", () => {
    const flipFlop: Rule = {
      id: "ADD_NUMBERS",
      apply: (n) => (n.type === "add" ? { node: parseLatex("1+2"), changes: [] } : null),
    };
    const result = run(parseLatex("3+4"), [flipFlop], {}, { verify: false, maxSteps: 10 });
    expect(result.steps.length).toBeLessThanOrEqual(1);
    expect(result.incomplete).toBe(false);
  });

  it("never emits a step whose before and after are identical", () => {
    const noop: Rule = {
      id: "ADD_NUMBERS",
      apply: (n) => (n.type === "add" ? { node: n, changes: [] } : null),
    };
    const result = run(parseLatex("x+1"), [noop], {}, { verify: false });
    expect(result.steps).toHaveLength(0);
  });

  it("respects the step ceiling", () => {
    const result = run(parseLatex("(x+1)^{4}"), expressionRules, {}, { maxSteps: 3 });
    expect(result.incomplete).toBe(true);
    expect(result.steps).toHaveLength(3);
  });

  it("simplifies nested structures", () => {
    expect(simplify("2(3(x+1))")).toBe("6 x + 6");
    expect(simplify("\\frac{2}{4}x")).toBe("\\frac{1}{2} x");
  });
});

describe("verifier", () => {
  it("accepts a correct rewrite", () => {
    expect(verifyEquivalent(parseLatex("2(x+3)"), parseLatex("2x+6"))).toBe("ok");
    expect(verifyEquivalent(parseLatex("x^2-4"), parseLatex("(x+2)(x-2)"))).toBe("ok");
  });

  it("rejects a wrong rewrite", () => {
    expect(verifyEquivalent(parseLatex("2(x+3)"), parseLatex("2x+3"))).toBe("mismatch");
    expect(verifyEquivalent(parseLatex("(x+1)^2"), parseLatex("x^2+1"))).toBe("mismatch");
    expect(verifyEquivalent(parseLatex("5x-3x"), parseLatex("8x"))).toBe("mismatch");
  });

  it("accepts equations scaled by a constant", () => {
    expect(verifyEquationEquivalent(parseLatex("x/2=3"), parseLatex("x=6"))).toBe("ok");
    expect(verifyEquationEquivalent(parseLatex("2x+3=7"), parseLatex("2x=4"))).toBe("ok");
  });

  it("rejects an equation with a dropped term", () => {
    expect(verifyEquationEquivalent(parseLatex("2x+3=7"), parseLatex("2x=7"))).toBe("mismatch");
    expect(verifyEquationEquivalent(parseLatex("5x-3=2x+9"), parseLatex("3x-3=9"))).toBe("ok");
    expect(verifyEquationEquivalent(parseLatex("5x-3=2x+9"), parseLatex("7x-3=9"))).toBe("mismatch");
  });

  it("marks a bad rule's step as unverified rather than showing it as correct", () => {
    let fired = false;
    const wrong: Rule = {
      id: "DISTRIBUTE",
      apply: (n) => {
        if (fired || n.type !== "mul") return null;
        fired = true;
        return { node: parseLatex("2x+3"), changes: [] };
      },
    };
    const result = run(parseLatex("2(x+3)"), [wrong], {});
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.unverified).toBe(true);
  });
});

describe("explanations", () => {
  it("covers every rule id", () => {
    const keys = new Set(explanationKeys("en"));
    const missing = allRules.map((r) => r.id).filter((id) => !keys.has(id));
    expect(missing, "rules without an explanation").toEqual([]);
  });

  it("substitutes template variables", () => {
    const e = explain("DIVIDE_BOTH_SIDES", { by: "3" });
    expect(e.title).toBe("Divide both sides by 3");
    expect(e.text).toContain("3");
  });

  it("leaves no unfilled placeholders in real solutions", () => {
    const result = run(parseLatex("2x+3=7"), allRules, { variable: "x" });
    for (const s of result.steps) {
      expect(s.title, s.ruleId).not.toMatch(/\{[a-z]+\}/);
      expect(s.explanation, s.ruleId).not.toMatch(/\{[a-z]+\}/);
    }
  });
});
