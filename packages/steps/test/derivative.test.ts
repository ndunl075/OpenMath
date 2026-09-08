import { describe, expect, it } from "vitest";
import {
  collectIds, evaluateNumeric, parseLatex, toLatex,
} from "@openmath/math-core";
import {
  differentiationRules, normalize, run, solve, trySolve, verifyDerivative,
} from "@openmath/steps";

const answerOf = (latex: string): string => {
  const outcome = trySolve(latex);
  if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
  return outcome.solution.answer;
};

const declineOf = (latex: string): string => {
  const outcome = trySolve(latex);
  if (outcome.ok) throw new Error(`${latex} was answered "${outcome.solution.answer}"`);
  expect(outcome.reason, latex).toBe("unsupported");
  return outcome.message;
};

/** The derivative, worked out numerically, against a hand-written formula. */
function agreesWith(latex: string, exact: (x: number) => number): void {
  const answer = parseLatex(answerOf(latex));
  for (const x of [0.3, 0.7, 1.4, 2.2, 3.9]) {
    const claimed = evaluateNumeric(answer, { x });
    const wanted = exact(x);
    if (!Number.isFinite(wanted)) continue;
    expect(claimed, `${latex} at x=${x}`).toBeCloseTo(wanted, 8);
  }
}

describe("differentiation", () => {
  it("classifies a derivative as its own kind of problem", () => {
    const s = solve("\\frac{d}{dx}(x^{2})");
    expect(s.kind).toBe("differentiate");
    expect(s.variable).toBe("x");
    expect(s.verified).toBe(true);
  });

  it("takes the standard derivatives", () => {
    expect(answerOf("\\frac{d}{dx}(7)")).toBe("0");
    expect(answerOf("\\frac{d}{dx}(x)")).toBe("1");
    expect(answerOf("\\frac{d}{dx}(x^{5})")).toBe("5 x^{4}");
    expect(answerOf("\\frac{d}{dx}\\sin(x)")).toBe("\\cos\\left(x\\right)");
    expect(answerOf("\\frac{d}{dx}\\cos(x)")).toBe("-\\sin\\left(x\\right)");
    expect(answerOf("\\frac{d}{dx}\\tan(x)")).toBe("\\sec\\left(x\\right)^{2}");
    expect(answerOf("\\frac{d}{dx}\\ln(x)")).toBe("\\frac{1}{x}");
    expect(answerOf("\\frac{d}{dx}\\sqrt{x}")).toBe("\\frac{1}{2 \\sqrt{x}}");
    expect(answerOf("\\frac{d}{dx}\\exp(x)")).toBe("\\exp\\left(x\\right)");
  });

  it("differentiates term by term instead of jumping to the answer", () => {
    const s = solve("\\frac{d}{dx}(x^{2}+3x)");
    expect(s.steps[0]!.ruleId).toBe("DIFF_SUM");
    // The sum rule leaves both derivatives standing; they are taken separately.
    expect(s.steps[0]!.after).toContain("\\frac{d}{dx}");
    const ids = s.steps.map((step) => step.ruleId);
    expect(ids).toContain("DIFF_POWER");
    expect(ids).toContain("DIFF_CONSTANT_MULTIPLE");
    expect(s.steps.length).toBeGreaterThan(3);
    expect(s.answer).toBe("2 x + 3");
  });

  it("uses the product rule when both factors move", () => {
    const s = solve("\\frac{d}{dx}(x\\sin(x))");
    expect(s.steps[0]!.ruleId).toBe("DIFF_PRODUCT");
    expect(s.answer).toBe("\\sin\\left(x\\right) + x \\cos\\left(x\\right)");
    // A constant factor is lifted out rather than dragged through the product rule.
    expect(solve("\\frac{d}{dx}(5x^{4})").steps[0]!.ruleId).toBe("DIFF_CONSTANT_MULTIPLE");
  });

  it("uses the quotient rule, and not for a constant denominator", () => {
    const s = solve("\\frac{d}{dx}\\frac{\\sin(x)}{x}");
    expect(s.steps[0]!.ruleId).toBe("DIFF_QUOTIENT");
    expect(s.answer).toBe("\\frac{\\cos\\left(x\\right) x - \\sin\\left(x\\right)}{x^{2}}");
    expect(solve("\\frac{d}{dx}\\frac{x^{2}}{3}").steps[0]!.ruleId)
      .toBe("DIFF_CONSTANT_MULTIPLE");
  });
});

describe("the chain rule", () => {
  it("scales the outside derivative by the inside one", () => {
    agreesWith("\\frac{d}{dx}\\sin(2x)", (x) => 2 * Math.cos(2 * x));
    agreesWith("\\frac{d}{dx}(x^{2}+1)^{3}", (x) => 6 * x * (x * x + 1) ** 2);
    agreesWith("\\frac{d}{dx}\\sqrt{x^{2}+1}", (x) => x / Math.sqrt(x * x + 1));
    agreesWith("\\frac{d}{dx}\\cos(3x)", (x) => -3 * Math.sin(3 * x));
    agreesWith("\\frac{d}{dx}\\ln(x^{2}+1)", (x) => (2 * x) / (x * x + 1));
    agreesWith("\\frac{d}{dx}e^{3x}", (x) => 3 * Math.exp(3 * x));
    agreesWith("\\frac{d}{dx}\\tan(x^{2})", (x) => (2 * x) / Math.cos(x * x) ** 2);
    agreesWith("\\frac{d}{dx}(3x+1)^{4}", (x) => 12 * (3 * x + 1) ** 3);
  });

  it("keeps going through nested layers", () => {
    agreesWith(
      "\\frac{d}{dx}\\sin(\\cos(x))",
      (x) => Math.cos(Math.cos(x)) * -Math.sin(x),
    );
    agreesWith(
      "\\frac{d}{dx}\\sin(\\sin(\\sin(x)))",
      (x) => Math.cos(Math.sin(Math.sin(x))) * Math.cos(Math.sin(x)) * Math.cos(x),
    );
    agreesWith(
      "\\frac{d}{dx}\\sqrt{\\sin(x)}",
      (x) => Math.cos(x) / (2 * Math.sqrt(Math.sin(x))),
    );
    agreesWith(
      "\\frac{d}{dx}\\sin(\\sqrt{x})",
      (x) => Math.cos(Math.sqrt(x)) / (2 * Math.sqrt(x)),
    );
  });

  it("survives a chain inside a quotient", () => {
    agreesWith(
      "\\frac{d}{dx}\\frac{\\sin(2x)}{x}",
      (x) => (2 * x * Math.cos(2 * x) - Math.sin(2 * x)) / (x * x),
    );
    agreesWith(
      "\\frac{d}{dx}\\frac{x}{\\sqrt{x^{2}+1}}",
      (x) => 1 / (x * x + 1) ** 1.5,
    );
  });

  it("does not expand the inside function away", () => {
    // 6x(x^2+1)^2 is the recognisable answer; multiplying it out is not an
    // improvement, and for a fifth power it exhausts the step budget.
    expect(answerOf("\\frac{d}{dx}(3x+1)^{4}")).toBe("12 \\left(3 x + 1\\right)^{3}");
    expect(answerOf("\\frac{d}{dx}\\frac{x}{x+1}")).toBe("\\frac{1}{\\left(x + 1\\right)^{2}}");
    const s = solve("\\frac{d}{dx}(x^{2}+3x)^{5}");
    expect(s.incomplete ?? false).toBe(false);
    expect(s.verified).toBe(true);
  });

  it("takes a second derivative one layer at a time", () => {
    expect(answerOf("(x^{3})''")).toBe("6 x");
    expect(answerOf("(x^{4})''")).toBe("12 x^{2}");
  });
});

describe("verification", () => {
  it("catches the classic dropped chain factor", () => {
    const problem = parseLatex("\\frac{d}{dx}\\sin(2x)");
    expect(verifyDerivative(problem, parseLatex("2\\cos(2x)"), "x")).toBe("ok");
    expect(verifyDerivative(problem, parseLatex("\\cos(2x)"), "x")).toBe("mismatch");
  });

  it("catches the chain rule applied to the wrong layer", () => {
    const problem = parseLatex("\\frac{d}{dx}(x^{2}+1)^{3}");
    expect(verifyDerivative(problem, parseLatex("6x(x^{2}+1)^{2}"), "x")).toBe("ok");
    // Inside derivative taken twice, and outside derivative of the wrong power.
    expect(verifyDerivative(problem, parseLatex("3(x^{2}+1)^{2}"), "x")).toBe("mismatch");
    expect(verifyDerivative(problem, parseLatex("6x(x^{2}+1)^{3}"), "x")).toBe("mismatch");
  });

  it("marks the solution unverified when a rule gets it wrong", () => {
    const wrong = {
      id: "DIFF_SIN",
      apply: (n: ReturnType<typeof parseLatex>) =>
        n.type === "fn" && n.name === "diff"
          ? { node: parseLatex("\\cos(2x)"), changes: [] }
          : null,
    };
    const result = run(parseLatex("\\frac{d}{dx}\\sin(2x)"), [wrong]);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.unverified).toBe(true);
  });

  it("checks every corpus derivative against a finite difference", () => {
    for (const latex of [
      "\\frac{d}{dx}(x^{2}-4x+7)", "\\frac{d}{dx}2^{x}", "\\frac{d}{dx}(x\\ln(x))",
      "\\frac{d}{dx}\\frac{1}{x}", "\\frac{d}{dx}(x^{-2})", "\\frac{d}{dx}(-x^{2})",
    ]) {
      const answer = parseLatex(answerOf(latex));
      expect(verifyDerivative(parseLatex(latex), answer, "x"), latex).toBe("ok");
    }
  });
});

describe("refusals", () => {
  it("declines implicit differentiation rather than guessing what y is", () => {
    expect(declineOf("\\frac{dy}{dx}")).toContain("implicit");
    expect(declineOf("\\frac{d}{dx}(y^{2})")).toContain("implicit");
    expect(declineOf("\\frac{d}{dx}(a x^{2})")).toContain("implicit");
  });

  it("declines a prime on a function it has no definition for", () => {
    expect(declineOf("f'(x)")).toContain("f");
  });

  it("declines rather than leaving a derivative in the answer", () => {
    expect(declineOf("\\frac{d}{dx}\\arctan(x)")).toContain("not supported yet");
    expect(declineOf("\\frac{d}{dx}\\left|x\\right|")).toContain("not supported yet");
    // The part it can do is not reported as if it were the whole answer.
    expect(declineOf("\\frac{d}{dx}(x^{2}+\\arcsin(x))")).toContain("not supported yet");
  });

  it("declines an equation containing a derivative", () => {
    expect(declineOf("\\frac{d}{dx}(x^{2})=2x")).toContain("equations");
  });
});

describe("step data", () => {
  it("reuses the node of a sub-expression that survives the step", () => {
    const start = parseLatex("\\frac{d}{dx}(x\\sin(x))");
    const { steps } = run(start, differentiationRules, { variable: "x" });
    const product = steps[0]!;
    expect(product.ruleId).toBe("DIFF_PRODUCT");
    // Each factor is carried into the other term as the same node object, so the
    // animation slides it across instead of fading it out and back in.
    const before = new Set(collectIds(product.beforeNode));
    const survivors = collectIds(product.afterNode!).filter((id) => before.has(id));
    expect(survivors.length).toBeGreaterThan(2);
  });

  it("names the new sub-expressions so the animation can fade them in", () => {
    const s = solve("\\frac{d}{dx}(x^{2}+3x)");
    for (const step of s.steps) {
      expect(step.changes.length, step.ruleId).toBeGreaterThan(0);
      const named = step.changes.flatMap((c) => [...c.fromIds, ...c.toIds]);
      expect(named.length, step.ruleId).toBeGreaterThan(0);
    }
  });

  it("gives every step wording with nothing left unfilled", () => {
    for (const latex of [
      "\\frac{d}{dx}(x^{2}-4x+7)", "\\frac{d}{dx}(x\\sin(x))",
      "\\frac{d}{dx}\\frac{\\sin(2x)}{x}", "\\frac{d}{dx}\\sqrt{x^{2}+1}",
      "\\frac{d}{dx}2^{x}", "\\frac{d}{dx}e^{3x}", "\\frac{d}{dx}\\frac{x^{2}}{3}",
      "\\frac{d}{dx}\\tan(x^{2})", "\\frac{d}{dx}\\ln(x^{2}+1)", "\\frac{d}{dx}(-x^{2})",
      "\\frac{d}{dx}\\cos(3x)", "\\frac{d}{dx}(x^{2}+1)^{3}", "\\frac{d}{dx}\\exp(x)",
    ]) {
      for (const step of solve(latex).steps) {
        expect(step.title, `${latex} / ${step.ruleId}`).not.toMatch(/\{[a-z]+\}/);
        expect(step.explanation, `${latex} / ${step.ruleId}`).not.toMatch(/\{[a-z]+\}/);
        expect(step.explanation.length, `${latex} / ${step.ruleId}`).toBeGreaterThan(0);
      }
    }
  });

  it("every step reads back as the expression it printed", () => {
    // Re-read through normalize, because that is what the engine does with an
    // expression: the parser binds a leading minus to the first factor, and
    // normalize floats it back out to the front of the product.
    const reread = (latex: string) => toLatex(normalize(parseLatex(latex)));
    for (const latex of [
      "\\frac{d}{dx}(x^{2}+3x)", "\\frac{d}{dx}(x\\sin(x))", "\\frac{d}{dx}(x^{2}+1)^{3}",
      "\\frac{d}{dx}\\frac{\\sin(2x)}{x}", "\\frac{d}{dx}\\sin(\\cos(x))",
      "\\frac{d}{dx}(x)(x+1)", "\\frac{d}{dx}\\sqrt{x^{2}+1}",
    ]) {
      for (const step of solve(latex).steps) {
        if (step.display) continue;
        expect(reread(step.before), `${latex}: ${step.before}`).toBe(step.before);
        expect(reread(step.after), `${latex}: ${step.after}`).toBe(step.after);
      }
    }
  });
});
