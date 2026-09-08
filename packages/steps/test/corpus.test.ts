import { describe, expect, it } from "vitest";
import { problems } from "@openmath/corpus";
import { asIntegral, evaluateNumeric, parseLatex } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";
import {
  verifyAntiderivative, verifyDifferByConstant, verifyEquivalent, verifyLimit,
} from "@openmath/steps";

describe("corpus", () => {
  for (const p of problems) {
    it(`${p.unsupported ? "declines" : "solves"} ${p.latex}`, () => {
      const outcome = trySolve(p.latex);

      if (p.unsupported) {
        expect(outcome.ok, `expected ${p.latex} to be rejected`).toBe(false);
        if (!outcome.ok) expect(outcome.reason).toBe(p.declineReason ?? "unsupported");
        return;
      }

      if (!outcome.ok) throw new Error(`${p.latex}: ${outcome.reason} - ${outcome.message}`);
      const s = outcome.solution;

      expect(s.kind, "problem kind").toBe(p.kind);
      expect(s.verified, "every step verified").toBe(true);
      expect(s.incomplete ?? false, "engine settled").toBe(false);

      // An antiderivative is one of a whole family, so pinning its exact LaTeX
      // would be pinning an arbitrary member of it.
      if (p.answer !== undefined && !p.upToConstant) {
        expect(s.answer, "answer LaTeX").toBe(p.answer);
      }

      // Independent check, and for an integral it is the differentiation that
      // does the work: the answer written by hand has to differentiate back to
      // the integrand, and the solver's answer has to sit a constant away from
      // it. Everything else, a definite integral included, has to keep the value
      // it started with — the sampler works a definite integral out by numeric
      // quadrature, which never sees the antiderivative at all.
      if (p.upToConstant && p.answer) {
        const parts = asIntegral(parseLatex(p.latex));
        if (!parts) throw new Error(`${p.latex}: upToConstant is for integrals`);
        expect(
          verifyAntiderivative(parseLatex(p.answer), parts.body, parts.variable),
          "the answer written here differentiates back to the integrand",
        ).toBe("ok");
        expect(
          verifyDifferByConstant(parseLatex(s.answer), parseLatex(p.answer)),
          "the solver's answer is the same antiderivative up to a constant",
        ).toBe("ok");
      } else if (p.kind !== "solve" && p.kind !== "limit" && p.answer) {
        // A simplification must not change the value. A limit is exempt: it
        // equals its answer at no point at all, only in the limit.
        expect(
          verifyEquivalent(parseLatex(p.latex), parseLatex(p.answer)),
          "answer is equivalent to the problem",
        ).toBe("ok");
      }

      // Independent check for a limit. Sampling for equality is the wrong
      // question here — the expression equals its limit at no point at all —
      // so the original is walked in towards the point instead and compared
      // with the hand-written answer.
      if (p.kind === "limit" && p.answer && !p.answer.startsWith("\\text")) {
        expect(
          verifyLimit(parseLatex(p.latex), parseLatex(p.answer)),
          "the expression really approaches the answer",
        ).toBe("ok");
      }

      // Independent check: substitute each root back into the original equation.
      if (p.roots) {
        const original = parseLatex(p.latex);
        if (original.type !== "rel") throw new Error("expected an equation");
        const variable = s.variable!;
        expect(s.answers.length, "number of solutions").toBe(p.roots.length);
        for (const root of p.roots) {
          const l = evaluateNumeric(original.lhs, { [variable]: root });
          const r = evaluateNumeric(original.rhs, { [variable]: root });
          expect(Math.abs(l - r), `root ${root} satisfies ${p.latex}`).toBeLessThan(1e-9);
        }
      }
    });
  }

  it("every step renders a before and an after", () => {
    for (const p of problems) {
      if (p.unsupported) continue;
      const outcome = trySolve(p.latex);
      if (!outcome.ok) continue;
      for (const step of outcome.solution.steps) {
        expect(step.before.length, `${p.latex} / ${step.ruleId}`).toBeGreaterThan(0);
        expect(step.after.length, `${p.latex} / ${step.ruleId}`).toBeGreaterThan(0);
        expect(step.title.length, `${p.latex} / ${step.ruleId}`).toBeGreaterThan(0);
        expect(step.before).not.toBe(step.after);
      }
    }
  });

  it("non-display steps produce parseable LaTeX", () => {
    for (const p of problems) {
      if (p.unsupported) continue;
      const outcome = trySolve(p.latex);
      if (!outcome.ok) continue;
      for (const step of outcome.solution.steps) {
        if (step.display) continue;
        expect(() => parseLatex(step.before), `${p.latex}: ${step.before}`).not.toThrow();
        expect(() => parseLatex(step.after), `${p.latex}: ${step.after}`).not.toThrow();
      }
    }
  });
});
