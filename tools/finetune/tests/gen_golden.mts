/**
 * Regenerate golden_normalize.json from the TypeScript normalizer.
 *
 * The Python port in openmath_finetune/normalize.py has to agree with
 * packages/ocr/src/normalize.ts or training labels drift from what the app
 * feeds its parser. This dumps the TS answers so the Python test can diff.
 *
 *   node --experimental-strip-types tools/finetune/tests/gen_golden.mts \
 *     > tools/finetune/tests/golden_normalize.json
 *
 * Cases are hand-written on purpose. Real dataset labels are not embedded here:
 * MathWriting is CC BY-NC-SA and this repository is MIT.
 */
import { normalizeLatex } from "../../../packages/ocr/src/normalize.ts";

const cases: string[] = [
  "",
  "   ",
  "x",
  "$$ x^2 + 3x - 4 = 0 $$",
  "$x+1$",
  "\\( a - b \\)",
  "\\[ a - b \\]",
  "\\left( x + 1 \\right) \\left( x - 2 \\right)",
  "\\left\\{ x \\right\\}",
  "\\left. \\frac{a}{b} \\right.",
  "\\frac12 + \\frac{3}4",
  "\\frac\\alpha2",
  "\\frac { 1 } { 2 } + \\sqrt { 9 }",
  "\\dfrac{1}{2} - \\tfrac{3}{4}",
  "\\binom{n}{2}",
  "3 × 4 ÷ 2",
  "a · b − c",
  "x² + y³",
  "x⁻¹",
  "2 ≤ x ≥ 1 ≠ 0",
  "√{4} + ∛{8}",
  "½ + ¼ + ⅛",
  "α + β + π",
  "∞",
  "5 ± 3",
  "a b",
  "\\alpha + \\beta",
  "\\displaystyle \\frac{a}{b} \\, + \\; c",
  "\\quad x \\qquad y",
  "\\bigl( x \\bigr)",
  "a \\! b \\: c \\> d",
  "50\\%",
  "a ~ b",
  "\\mathrm{d}x + \\text{hello}",
  "\\operatorname{sin}(x)",
  "\\mathbf{\\mathit{x}}",
  "\\textrm{ab}\\mbox{cd}",
  "x^2 = 4.",
  "y = 3;",
  "{ x + 1 ) }",
  "{{x}",
  "x}}",
  "\\{x\\}",
  "x^{10} + x^2",
  "x^a b",
  "x_1 + x_{12}",
  "-\\frac{b}{2a}",
  "\\sqrt[3]{x}",
  "2\\pi r",
  "\\log \\frac{a}{b}",
  "\\sin x + \\cos x",
  "\\begin{matrix} a \\\\ b \\end{matrix}",
  "\\int_0^1 x dx",
  "\\sum_{i=1}^{n} i",
  "\\lim_{x \\to 0} x",
  "x^{ - 2 }",
  "{ -3 }",
  "a<=b",
  "3x^{2}-2x+1=0",
  "\\frac{\\frac{1}{2}}{3}",
];

const out = cases.map((input) => ({ input, output: normalizeLatex(input) }));
console.log(JSON.stringify(out, null, 2));
