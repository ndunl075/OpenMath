import { describe, expect, it } from "vitest";
import { parseLatex } from "@openmath/math-core";
import { classify, limitLHopital, trySolve, verifyLimit } from "@openmath/steps";

function solved(latex: string) {
  const outcome = trySolve(latex);
  if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
  return outcome.solution;
}

const ruleIds = (latex: string) => solved(latex).steps.map((s) => s.ruleId);

describe("classifying a limit", () => {
  it("is its own kind of problem", () => {
    const c = classify(parseLatex("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}"));
    expect(c.kind).toBe("limit");
    expect(c.variable).toBe("x");
    expect(solved("\\lim_{x \\to 3}(x^{2})").kind).toBe("limit");
  });
});

describe("direct substitution", () => {
  it("is tried first, and shown", () => {
    expect(ruleIds("\\lim_{x \\to 3}(x^{2}+1)")).toEqual([
      "LIMIT_SUBSTITUTE",
      "EVALUATE_POWER",
      "ADD_NUMBERS",
    ]);
    expect(solved("\\lim_{x \\to 3}(x^{2}+1)").answer).toBe("10");
  });

  it("says so when the expression does not depend on the variable", () => {
    const s = solved("\\lim_{x \\to 5}7");
    expect(s.answer).toBe("7");
    expect(s.steps[0]!.title).toContain("does not depend");
  });

  it("refuses to substitute where the function is not continuous", () => {
    // sqrt is undefined to the left of zero, so there is no two-sided limit to
    // substitute into, even though putting 0 in would give a perfectly good 0.
    expect(trySolve("\\lim_{x \\to 0}\\sqrt{x}").ok).toBe(false);
    expect(solved("\\lim_{x \\to 0^{+}}\\sqrt{x}").answer).toBe("0");
  });
});

describe("indeterminate forms", () => {
  it("names the form as a step of its own", () => {
    const s = solved("\\lim_{x \\to 2}\\frac{x^{2}-4}{x-2}");
    const first = s.steps[0]!;
    expect(first.ruleId).toBe("LIMIT_INDETERMINATE");
    expect(first.after).toBe("\\frac{0}{0}");
    expect(first.title).toContain("\\frac{0}{0}");
  });

  it("names the infinite form at infinity", () => {
    const s = solved("\\lim_{x \\to \\infty}\\frac{2x^{2}+1}{x^{2}+3}");
    expect(s.steps[0]!.ruleId).toBe("LIMIT_INDETERMINATE");
    expect(s.steps[0]!.after).toBe("\\frac{\\infty}{\\infty}");
  });

  it("says nothing where substitution simply works", () => {
    expect(ruleIds("\\lim_{x \\to 0}\\frac{x^{2}-4}{x-2}")).not.toContain("LIMIT_INDETERMINATE");
  });
});

describe("factor and cancel", () => {
  it("factors, cancels, then substitutes, as three separate steps", () => {
    expect(ruleIds("\\lim_{x \\to 2}\\frac{x^{2}-4}{x-2}")).toEqual([
      "LIMIT_INDETERMINATE",
      "LIMIT_FACTOR",
      "CANCEL_FRACTION_FACTORS",
      "LIMIT_SUBSTITUTE",
      "ADD_NUMBERS",
    ]);
  });

  it("writes the common factor into both halves", () => {
    const factor = solved("\\lim_{x \\to 2}\\frac{x^{2}-4}{x-2}").steps
      .find((s) => s.ruleId === "LIMIT_FACTOR")!;
    expect(factor.after).toBe(
      "\\lim_{x \\to 2}\\left(\\frac{\\left(x - 2\\right) \\left(x + 2\\right)}{x - 2}\\right)",
    );
  });

  it("works when the factor is the variable itself", () => {
    expect(solved("\\lim_{x \\to 0}\\frac{x^{2}+x}{x}").answer).toBe("1");
  });
});

describe("l'Hopital's rule", () => {
  it("differentiates top and bottom, then takes each derivative in the open", () => {
    const ids = ruleIds("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}");
    expect(ids[0]).toBe("LIMIT_INDETERMINATE");
    expect(ids[1]).toBe("LIMIT_LHOPITAL");
    expect(ids).toContain("DIFF_SIN");
    expect(ids).toContain("DIFF_VARIABLE");
    expect(solved("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}").answer).toBe("1");
  });

  it("stops once its budget is spent, rather than differentiating forever", () => {
    const node = parseLatex("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}");
    expect(limitLHopital.apply(node, { variable: "x", lhopital: { used: 0, max: 4 } })).not.toBeNull();
    expect(limitLHopital.apply(node, { variable: "x", lhopital: { used: 4, max: 4 } })).toBeNull();
  });

  it("declines a limit it cannot finish instead of returning half of one", () => {
    const outcome = trySolve("\\lim_{x \\to \\infty}\\frac{e^{x}}{x}");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsupported");
  });

  it("does not leave a derivative it cannot take in the answer", () => {
    const outcome = trySolve("\\lim_{x \\to 0}\\frac{\\left|x\\right|}{x}");
    expect(outcome.ok).toBe(false);
  });
});

describe("limits at infinity", () => {
  it("compares the degrees", () => {
    expect(solved("\\lim_{x \\to \\infty}\\frac{1}{x}").answer).toBe("0");
    expect(solved("\\lim_{x \\to \\infty}\\frac{2x^{2}+1}{x^{2}+3}").answer).toBe("2");
    expect(solved("\\lim_{x \\to -\\infty}\\frac{x+1}{x}").answer).toBe("1");
    expect(ruleIds("\\lim_{x \\to \\infty}\\frac{1}{x}")).toEqual(["LIMIT_AT_INFINITY"]);
  });

  it("declines rather than calling a runaway numerator an answer", () => {
    expect(trySolve("\\lim_{x \\to \\infty}\\frac{x^{2}}{x}").ok).toBe(false);
    expect(trySolve("\\lim_{x \\to \\infty}\\frac{x^{3}+1}{x^{2}}").ok).toBe(false);
  });
});

describe("one-sided limits", () => {
  it("keeps the side through the working", () => {
    expect(solved("\\lim_{x \\to 2^{-}}(x^{2})").answer).toBe("4");
    expect(solved("\\lim_{x \\to 0^{+}}\\sqrt{x}").answer).toBe("0");
  });

  it("reports a limit that does not exist rather than inventing a value", () => {
    const s = solved("\\lim_{x \\to 0}\\frac{1}{x}");
    expect(s.answer).toBe("\\text{does not exist}");
    expect(s.answers).toEqual([]);
    expect(s.note).toContain("two sides disagree");
    expect(s.steps.at(-1)!.ruleId).toBe("LIMIT_DOES_NOT_EXIST");
  });

  it("distinguishes sides that disagree from a two-sided blow-up", () => {
    expect(solved("\\lim_{x \\to 1}\\frac{1}{(x-1)^{2}}").note).toContain("both sides");
    expect(solved("\\lim_{x \\to 0^{+}}\\frac{1}{x}").note).toContain("grows without bound");
  });
});

describe("what a limit problem is refused for", () => {
  const declines = (latex: string, pattern: RegExp) => {
    const outcome = trySolve(latex);
    expect(outcome.ok, latex).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(pattern);
  };

  it("names the reason", () => {
    declines("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}=1", /equation/);
    declines("\\lim_{x \\to 0}(a x)", /not supported yet/);
    declines("2+\\infty", /infinity/);
  });
});

describe("verifying a limit numerically", () => {
  it("accepts an answer the expression really approaches", () => {
    expect(verifyLimit(
      parseLatex("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}"),
      parseLatex("1"),
    )).toBe("ok");
    expect(verifyLimit(
      parseLatex("\\lim_{x \\to 2}\\frac{x^{2}-4}{x-2}"),
      parseLatex("4"),
    )).toBe("ok");
  });

  it("rejects an answer it does not approach", () => {
    expect(verifyLimit(
      parseLatex("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}"),
      parseLatex("0"),
    )).toBe("mismatch");
    expect(verifyLimit(
      parseLatex("\\lim_{x \\to 2}\\frac{x^{2}-4}{x-2}"),
      parseLatex("2"),
    )).toBe("mismatch");
  });

  it("says it does not know rather than passing something unmeasurable", () => {
    // No finite limit to measure, so there is nothing to confirm the claim with.
    expect(verifyLimit(
      parseLatex("\\lim_{x \\to 0}\\frac{1}{x}"),
      parseLatex("0"),
    )).toBe("unknown");
  });

  it("every limit in the corpus comes with checked steps", () => {
    for (const latex of [
      "\\lim_{x \\to 0}\\frac{\\sin(x)}{x}",
      "\\lim_{x \\to 2}\\frac{x^{2}-4}{x-2}",
      "\\lim_{x \\to \\infty}\\frac{\\ln(x)}{x}",
      "\\lim_{x \\to 0}\\frac{e^{x}-1}{x}",
    ]) {
      const s = solved(latex);
      expect(s.verified, latex).toBe(true);
      expect(s.steps.every((st) => !st.unverified), latex).toBe(true);
    }
  });
});
