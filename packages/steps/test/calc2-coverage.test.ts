import { describe, expect, it } from "vitest";
import { trySolve } from "@openmath/steps";

const TOPICS: Record<string, string[]> = {
  "u-substitution": ["\\int 2x(x^{2}+1)^{3} \\, dx", "\\int \\sin(3x) \\, dx", "\\int \\frac{\\ln(x)}{x} \\, dx", "\\int x\\sqrt{x+1} \\, dx", "\\int \\frac{x}{\\sqrt{x+1}} \\, dx"],
  "by parts": ["\\int x e^{x} \\, dx", "\\int x^{2}e^{x} \\, dx", "\\int \\ln(x) \\, dx", "\\int x\\ln(x) \\, dx", "\\int x^{2}\\sin(x) \\, dx"],
  "cyclic parts": ["\\int e^{x}\\sin(x) \\, dx", "\\int e^{2x}\\cos(3x) \\, dx"],
  "trig integrals": ["\\int \\sin(x)^{2} \\, dx", "\\int \\cos(x)^{3} \\, dx", "\\int \\sin(x)^{5} \\, dx", "\\int \\tan(x) \\, dx", "\\int \\sec(x) \\, dx", "\\int \\sec(x)^{3} \\, dx"],
  "trig substitution": ["\\int \\sqrt{1-x^{2}} \\, dx", "\\int \\sqrt{x^{2}+1} \\, dx", "\\int \\frac{x^{2}}{\\sqrt{1-x^{2}}} \\, dx", "\\int \\frac{1}{x^{2}\\sqrt{1-x^{2}}} \\, dx", "\\int \\frac{1}{\\sqrt{x^{2}-1}} \\, dx"],
  "partial fractions": ["\\int \\frac{1}{x^{2}-1} \\, dx", "\\int \\frac{3x+1}{x^{2}-x-2} \\, dx", "\\int \\frac{x^{2}}{x+1} \\, dx", "\\int \\frac{1}{x^{2}+2x+5} \\, dx"],
  "improper integrals": ["\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx", "\\int_{0}^{\\infty} e^{-x} \\, dx", "\\int_{-\\infty}^{0} e^{x} \\, dx"],
  "applications": ["\\int_{0}^{1} \\sqrt{1+4x^{2}} \\, dx", "\\int_{0}^{1} \\pi x^{4} \\, dx", "\\int_{0}^{2} 2\\pi x(4-x^{2}) \\, dx", "\\int_{0}^{1} 2\\pi x\\sqrt{1+4x^{2}} \\, dx"],
  "finite sums": ["\\sum_{n=1}^{10} n", "\\sum_{n=1}^{5} n^{2}", "\\sum_{n=1}^{100} n", "5!"],
  "series tests": ["\\sum_{n=1}^{\\infty} \\frac{1}{n}", "\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}}", "\\sum_{n=1}^{\\infty} \\frac{1}{n!}", "\\sum_{n=1}^{\\infty} \\frac{n!}{2^{n}}", "\\sum_{n=1}^{\\infty} \\frac{(-1)^{n}}{n}", "\\sum_{n=1}^{\\infty} \\frac{2n}{n^{3}+1}", "\\sum_{n=2}^{\\infty} \\frac{1}{n\\ln(n)}", "\\sum_{n=1}^{\\infty} \\frac{n}{n+1}"],
  "geometric series": ["\\sum_{n=1}^{\\infty} \\frac{1}{2^{n}}", "\\sum_{n=0}^{\\infty} \\left(\\frac{2}{3}\\right)^{n}", "\\sum_{n=1}^{\\infty} 2^{n}"],
  "power series": ["\\sum_{n=0}^{\\infty} x^{n}", "\\sum_{n=1}^{\\infty} \\frac{x^{n}}{n}", "\\sum_{n=1}^{\\infty} \\frac{x^{n}}{n 3^{n}}", "\\sum_{n=0}^{\\infty} n! x^{n}", "\\sum_{n=1}^{\\infty} \\frac{(x-3)^{n}}{n}"],
  "taylor generation": ["\\maclaurin(e^{x}, 4)", "\\maclaurin(\\sin(x), 5)", "\\maclaurin(\\ln(1+x), 4)", "\\maclaurin(\\sqrt{1+x}, 3)", "\\taylor(e^{x}, 1, 3)", "\\taylor(x^{3}+2x, 1, 3)"],
  "maclaurin": ["\\sum_{n=0}^{\\infty} \\frac{x^{n}}{n!}", "\\sum_{n=0}^{\\infty} \\frac{(-1)^{n} x^{2n+1}}{(2n+1)!}", "\\sum_{n=0}^{\\infty} \\frac{(-1)^{n} x^{2n}}{(2n)!}"],
};

/**
 * One problem of each shape a Calc 2 course sets, and all of them have to be
 * answered *and* verified. This is the guard that notices a topic quietly
 * regressing: an individual rule can be broken in a way that still passes its
 * own test while taking a whole technique down with it, and a list organised
 * by topic says which one.
 *
 * A refusal here is a failure, unlike in accuracy-sweep.test.ts. That file
 * asks whether the answers given are right; this one asks whether the answers
 * are given at all.
 */
describe("every Calc 2 topic still answers", () => {
  for (const [topic, problems] of Object.entries(TOPICS)) {
    describe(topic, () => {
      for (const problem of problems) {
        it(problem, () => {
          const r = trySolve(problem);
          expect(r.ok, `declined: ${r.ok ? "" : r.message}`).toBe(true);
          if (!r.ok) return;
          expect(r.solution.verified, `answered "${r.solution.answer}" but unverified`).toBe(true);
        });
      }
    });
  }
});
