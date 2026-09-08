import { describe, expect, it } from "vitest";
import { problems } from "@openmath/corpus";
import { evaluateNumeric, parseLatex } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";
import { verifyEquivalent } from "@openmath/steps";

describe("corpus", () => {
  for (const p of problems) {
    it(`${p.unsupported ? "declines" : "solves"} ${p.latex}`, () => {
      const outcome = trySolve(p.latex);

      if (p.unsupported) {
        expect(outcome.ok, `expected ${p.latex} to be rejected`).toBe(false);
        if (!outcome.ok) expect(outcome.reason).toBe("unsupported");
        return;
      }

      if (!outcome.ok) throw new Error(`${p.latex}: ${outcome.reason} - ${outcome.message}`);
      const s = outcome.solution;

      expect(s.kind, "problem kind").toBe(p.kind);
      expect(s.verified, "every step verified").toBe(true);
      expect(s.incomplete ?? false, "engine settled").toBe(false);

      if (p.answer !== undefined) {
        expect(s.answer, "answer LaTeX").toBe(p.answer);
      }

      // Independent check: a simplification must not change the value.
      if (p.kind !== "solve" && p.answer) {
        expect(
          verifyEquivalent(parseLatex(p.latex), parseLatex(p.answer)),
          "answer is equivalent to the problem",
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
