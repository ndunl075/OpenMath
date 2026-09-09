import { describe, expect, it } from "vitest";
import { detectOutOfScope, normalizeLatex } from "@openmath/ocr";
import { trySolve } from "@openmath/steps";

/**
 * The seam where recognition output meets the solver.
 *
 * Every case here was a *wrong answer* before the normalizer learned to repair
 * it, not a parse error — which is the dangerous kind. Recognition models
 * tokenise digit by digit and often drop the backslash off a function name, so
 * "123 + 456" arrived as "1 2 3 + 4 5 6" and was solved as 1*2*3 + 4*5*6 = 126,
 * and "cos(0)" arrived bare and was solved as c*o*s*0 = 0. Both came back with
 * a full, confident set of working.
 */
const ANSWERS: Array<[string, string]> = [
  // Digits the model split apart.
  ["1 2 3 + 4 5 6", "579"],
  ["$$2 x + 3 = 1 1$$", "x = 4"],
  ["\\sqrt { 1 6 }", "4"],
  ["4 2 - 1 7", "25"],
  ["1 0 0 \\div 4", "25"],
  ["x ^ { 1 2 } \\cdot x ^ { 3 }", "x^{15}"],
  // Function names that lost their backslash.
  ["cos(0)", "1"],
  ["log(100)", "2"],
  ["ln(e)", "1"],
  ["sqrt(16)", "4"],
  ["\\operatorname{sin}(0)", "0"],
  ["\\mathrm{cos}(0)", "1"],
  ["\\frac{d}{dx}(sin(x))", "\\cos\\left(x\\right)"],
  // Spacing and display markup the model adds.
  ["x ^ { 2 } - 5 x + 6 = 0", "x = 2 \\quad \\text{or} \\quad x = 3"],
  ["\\dfrac { 1 } { 2 } + \\dfrac { 1 } { 3 }", "\\frac{5}{6}"],
  ["\\lim _ { x \\rightarrow 0 } \\frac { \\sin x } { x }", "1"],
  // Sigma notation, with the bounds split into digits the way a model emits
  // them. \sum used to be refused by the scope check outright.
  ["\\sum _ { n = 1 } ^ { 1 0 } n", "55"],
  ["\\sum _ { n = 1 } ^ { \\infty } \\frac { 1 } { 2 ^ { n } }", "1"],
  ["5 !", "120"],
];

describe("scans that used to give confidently wrong answers", () => {
  for (const [raw, expected] of ANSWERS) {
    it(`${raw} -> ${expected}`, () => {
      const r = trySolve(normalizeLatex(raw));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.solution.answer).toBe(expected);
    });
  }
});

/**
 * Notation we would rather refuse than guess at. Routed the way app.tsx routes
 * it: normalize, then the scope check, then the solver.
 */
const REFUSED = ["\\mathrm{d}y/\\mathrm{d}x", "dy/dx"];

describe("ambiguous notation is refused, not guessed", () => {
  for (const raw of REFUSED) {
    it(raw, () => {
      const latex = normalizeLatex(raw);
      const scope = detectOutOfScope(latex);
      expect(scope).not.toBeNull();
    });
  }
});

describe("the parser refuses juxtaposed numerals outright", () => {
  it("is a backstop for anything the normalizer misses", () => {
    // Not routed through normalizeLatex on purpose.
    const r = trySolve("1 2 3 + 4 5 6");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse");
  });
});
