import { describe, expect, it } from "vitest";
import { parseLatex } from "@openmath/math-core";
import { detectOutOfScope, normalizeLatex, normalizeWithReport } from "@openmath/ocr";

const n = (s: string) => normalizeLatex(s);

describe("normalizeLatex", () => {
  it("strips math mode delimiters", () => {
    expect(n("$2x+3$")).toBe("2x + 3");
    expect(n("$$x^{2}$$")).toBe("x^{2}");
    expect(n("\\(x+1\\)")).toBe("x + 1");
    expect(n("\\[x+1\\]")).toBe("x + 1");
  });

  it("converts Unicode operators a photo introduces", () => {
    expect(n("2 × 3")).toBe("2 \\times 3");
    expect(n("6 ÷ 2")).toBe("6 \\div 2");
    expect(n("5 − 3")).toBe("5 - 3");
    expect(n("x ≤ 5")).toBe("x \\le 5");
    expect(n("x ≥ 5")).toBe("x \\ge 5");
  });

  it("converts Unicode symbols and superscripts", () => {
    expect(n("√9")).toBe("\\sqrt9");
    expect(n("π r²")).toBe("\\pi r^{2}");
    expect(n("x² + y³")).toBe("x^{2} + y^{3}");
    expect(n("x⁻¹")).toBe("x^{-1}");
    expect(n("½ + ¼")).toBe("\\frac{1}{2} + \\frac{1}{4}");
  });

  it("removes layout commands that carry no meaning", () => {
    expect(n("\\displaystyle 2x")).toBe("2x");
    expect(n("2\\,x")).toBe("2 x");
    expect(n("\\left( x + 1 \\right)")).toBe("( x + 1 )");
    expect(n("2\\quad x")).toBe("2 x");
  });

  it("unwraps text and font commands", () => {
    expect(n("\\mathrm{x} + 1")).toBe("x + 1");
    expect(n("\\text{x}^{2}")).toBe("x^{2}");
    // Unwrapped to a bare "sin", the parser reads s*i*n; the backslash is
    // restored so it stays a function.
    expect(n("\\operatorname{sin}")).toBe("\\sin");
    expect(n("\\mathbf{\\mathrm{y}}")).toBe("y");
  });

  it("adds the braces LaTeX shorthand leaves out", () => {
    expect(n("\\frac12")).toBe("\\frac{1}{2}");
    expect(n("\\frac{1}2")).toBe("\\frac{1}{2}");
    expect(n("\\frac1{2}")).toBe("\\frac{1}{2}");
    expect(n("x^2")).toBe("x^{2}");
  });

  it("repairs unbalanced braces rather than failing", () => {
    expect(n("\\frac{1}{2")).toBe("\\frac{1}{2}");
    const report = normalizeWithReport("x^{2");
    expect(report.latex).toBe("x^{2}");
    expect(report.notes.join(" ")).toContain("unmatched");
  });

  it("drops trailing punctuation picked up from the page", () => {
    expect(n("2x + 3 = 7.")).toBe("2x + 3 = 7");
    expect(n("x = 4,")).toBe("x = 4");
  });

  it("handles an empty or blank result", () => {
    expect(n("")).toBe("");
    expect(n("   ")).toBe("");
    expect(normalizeWithReport("").notes).toContain("empty result");
  });

  it("reports what it changed", () => {
    const report = normalizeWithReport("$\\displaystyle \\frac12 × x$");
    expect(report.notes.length).toBeGreaterThan(2);
    expect(report.latex).toBe("\\frac{1}{2} \\times x");
  });

  it("produces output the parser accepts", () => {
    const samples = [
      "$2x+3=7$", "\\displaystyle\\frac{x+1}{2}", "x² − 4 = 0",
      "\\left(x+1\\right)\\left(x-2\\right)", "\\frac12x = 3",
      "√16 + π", "\\mathrm{x}^{2}+2\\,x+1", "2 × 3 ÷ 4",
      "x^{2", "5x - 3 = 2x + 9.",
    ];
    for (const s of samples) {
      const latex = normalizeLatex(s);
      expect(() => parseLatex(latex), `${s} -> ${latex}`).not.toThrow();
    }
  });
});

describe("detectOutOfScope", () => {
  it("names the structure the solver cannot handle", () => {
    expect(detectOutOfScope("\\oint E dl")).toBe("contour integrals");
    expect(detectOutOfScope("\\sum_{i=1}^{n} i")).toBe("sums and products");
    expect(detectOutOfScope("\\begin{matrix}1&2\\end{matrix}")).toBe(
      "matrices and aligned environments",
    );
  });

  it("passes ordinary algebra through", () => {
    expect(detectOutOfScope("2x+3=7")).toBeNull();
    expect(detectOutOfScope("\\frac{x+1}{2}")).toBeNull();
    expect(detectOutOfScope("\\sqrt{x}")).toBeNull();
  });

  it("lets limits reach the solver now that it can take them", () => {
    expect(detectOutOfScope("\\lim_{x \\to 0} x")).toBeNull();
    expect(detectOutOfScope("\\lim_{x \\to \\infty} \\frac{1}{x}")).toBeNull();
    // The solver refuses the limits it cannot do, naming the expression, which
    // is a better message than a blanket "limits are out of scope".
    expect(detectOutOfScope("\\lim_{x \\to 0^+} \\ln(x)")).toBeNull();
  });

  it("lets calculus reach the solver now that it can take it", () => {
    expect(detectOutOfScope("\\frac{d}{dx}(x^2+3x)")).toBeNull();
    expect(detectOutOfScope("\\frac{dy}{dx}")).toBeNull();
    expect(detectOutOfScope("f'(x)")).toBeNull();
    expect(detectOutOfScope("\\int x^2 \\, dx")).toBeNull();
    expect(detectOutOfScope("\\int_{0}^{1} x \\, dx")).toBeNull();
    // An integral the solver cannot do is its refusal to make, with a reason
    // naming the integrand, not a blanket one from here.
    expect(detectOutOfScope("\\int e^{x^2} \\, dx")).toBeNull();
  });
});
