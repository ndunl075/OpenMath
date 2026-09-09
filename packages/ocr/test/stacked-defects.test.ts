import { describe, expect, it } from "vitest";
import { detectOutOfScope, normalizeLatex } from "@openmath/ocr";
import { trySolve } from "@openmath/steps";

/**
 * Every repair the normalizer makes has been tested on its own. A photograph
 * does not produce defects one at a time: one line of a worksheet comes back
 * wrapped in a layout environment, with its digits split, its function names
 * stripped of backslashes and display markup sprinkled through it, all at once.
 * Repairs that each work alone can still be ordered wrongly with respect to
 * each other, and that ordering is invisible until they are stacked.
 *
 * It is a real constraint of this project that these are written rather than
 * photographed. The recogniser cannot be reached from CI, so this measures
 * everything downstream of the model and nothing about the model itself. A
 * corpus of real photos is still the missing piece; this is the half that can
 * be tested without one, and it is the half that has broken twice.
 */

/**
 * Answers are compared with whitespace collapsed. `3 x` and `3x` are the same
 * expression and render identically, since maths mode ignores the space, so
 * pinning the exact spacing would fail on a difference no reader can see.
 */
const same = (a: string, b: string) => a.replace(/\s+/g, "") === b.replace(/\s+/g, "");

/* What a recogniser emits for one photographed line: several defects at once. */
const STACKED: Array<[string, string]> = [
  ["\\begin{aligned} \\operatorname{cos} ( 0 ) + 1 2 \\end{aligned}", "13"],
  ["\\begin{aligned} 2 x + 3 &= 1 1 \\end{aligned}", "x = 4"],
  ["$$\\begin{aligned}\\displaystyle \\dfrac { 1 } { 2 } + \\dfrac { 1 } { 3 }\\end{aligned}$$", "\\frac{5}{6}"],
  ["\\begin{array}{l} \\mathrm{sqrt} ( 1 6 ) \\end{array}", "4"],
  ["\\begin{aligned} x ^ { 2 } - 5 x + 6 &= 0 \\end{aligned}", "x = 2 \\quad \\text{or} \\quad x = 3"],
  ["\\begin{gathered} \\left( x + 1 \\right) \\left( x + 2 \\right) \\end{gathered}", "x^{2} + 3x + 2"],
  ["\\begin{aligned} \\lim _ { x \\rightarrow 0 } \\frac { \\operatorname{sin} x } { x } \\end{aligned}", "1"],
  ["\\begin{aligned} \\frac{d}{dx} ( \\mathrm{sin} ( x ) ) \\end{aligned}", "\\cos\\left(x\\right)"],
];

describe("several recognition defects at once, as a real photo produces", () => {
  for (const [raw, expected] of STACKED) {
    it(`${raw.slice(0, 55)}... -> ${expected}`, () => {
      const latex = normalizeLatex(raw);
      expect(detectOutOfScope(latex), `refused: ${latex}`).toBeNull();
      const r = trySolve(latex);
      expect(r.ok, r.ok ? "" : `${latex} -> ${r.message}`).toBe(true);
      if (!r.ok) return;
      expect(
        same(r.solution.answer, expected),
        `${latex} -> ${r.solution.answer}, wanted ${expected}`,
      ).toBe(true);
    });
  }
});
