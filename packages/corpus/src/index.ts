/**
 * The regression corpus. Every entry is a problem a student could photograph,
 * with the answer written by hand rather than captured from the engine, so a
 * wrong rewrite fails the build instead of being baked in as expected output.
 *
 * `answer` is exact LaTeX as the serializer emits it, which also pins the
 * formatting the UI renders. Adding a rule means adding entries here.
 */
export interface CorpusProblem {
  latex: string;
  kind: "simplify" | "evaluate" | "solve";
  /** Exact expected answer LaTeX. */
  answer?: string;
  /** Numeric value of each solution, checked by substitution. */
  roots?: number[];
  /** Expected to be rejected rather than answered. */
  unsupported?: true;
  tags: string[];
}

export const problems: CorpusProblem[] = [
  // ---- arithmetic
  { latex: "2+3", kind: "evaluate", answer: "5", tags: ["arithmetic"] },
  { latex: "2+3\\cdot4", kind: "evaluate", answer: "14", tags: ["arithmetic", "precedence"] },
  { latex: "(2+3)\\cdot4", kind: "evaluate", answer: "20", tags: ["arithmetic", "precedence"] },
  { latex: "10-4-3", kind: "evaluate", answer: "3", tags: ["arithmetic"] },
  { latex: "2^{5}", kind: "evaluate", answer: "32", tags: ["arithmetic", "powers"] },
  { latex: "2^{-2}", kind: "evaluate", answer: "\\frac{1}{4}", tags: ["arithmetic", "powers"] },
  { latex: "-3^{2}", kind: "evaluate", answer: "-9", tags: ["arithmetic", "signs"] },
  { latex: "(-3)^{2}", kind: "evaluate", answer: "9", tags: ["arithmetic", "signs"] },
  { latex: "0.1+0.2", kind: "evaluate", answer: "\\frac{3}{10}", tags: ["arithmetic", "decimals"] },
  { latex: "\\left|-7\\right|", kind: "evaluate", answer: "7", tags: ["arithmetic", "abs"] },

  // ---- fractions
  { latex: "\\frac{1}{3}+\\frac{1}{6}", kind: "evaluate", answer: "\\frac{1}{2}", tags: ["fractions"] },
  { latex: "\\frac{3}{4}-\\frac{1}{4}", kind: "evaluate", answer: "\\frac{1}{2}", tags: ["fractions"] },
  { latex: "\\frac{2}{3}\\cdot\\frac{3}{4}", kind: "evaluate", answer: "\\frac{1}{2}", tags: ["fractions"] },
  { latex: "\\frac{6}{8}", kind: "evaluate", answer: "\\frac{3}{4}", tags: ["fractions", "reduce"] },
  { latex: "\\frac{12}{4}", kind: "evaluate", answer: "3", tags: ["fractions", "reduce"] },
  { latex: "\\frac{\\frac{1}{2}}{\\frac{3}{4}}", kind: "evaluate", answer: "\\frac{2}{3}", tags: ["fractions", "complex"] },

  // ---- roots
  { latex: "\\sqrt{16}", kind: "evaluate", answer: "4", tags: ["roots"] },
  { latex: "\\sqrt{12}", kind: "evaluate", answer: "2 \\sqrt{3}", tags: ["roots", "simplify"] },
  { latex: "\\sqrt{72}", kind: "evaluate", answer: "6 \\sqrt{2}", tags: ["roots", "simplify"] },
  { latex: "\\sqrt[3]{27}", kind: "evaluate", answer: "3", tags: ["roots", "cube"] },
  { latex: "\\sqrt{\\frac{9}{4}}", kind: "evaluate", answer: "\\frac{3}{2}", tags: ["roots", "fractions"] },

  // ---- collecting terms
  { latex: "2x+3x", kind: "simplify", answer: "5 x", tags: ["like-terms"] },
  { latex: "2x+3x+x", kind: "simplify", answer: "6 x", tags: ["like-terms"] },
  { latex: "5x-3x", kind: "simplify", answer: "2 x", tags: ["like-terms"] },
  { latex: "3x-3x", kind: "simplify", answer: "0", tags: ["like-terms", "cancel"] },
  { latex: "2x+3y+4x", kind: "simplify", answer: "6 x + 3 y", tags: ["like-terms"] },
  { latex: "2x^{2}+3x^{2}", kind: "simplify", answer: "5 x^{2}", tags: ["like-terms", "powers"] },
  { latex: "x+x+x", kind: "simplify", answer: "3 x", tags: ["like-terms"] },
  { latex: "2x+3+4x+5", kind: "simplify", answer: "6 x + 8", tags: ["like-terms"] },

  // ---- powers
  { latex: "x^{2}\\cdot x^{3}", kind: "simplify", answer: "x^{5}", tags: ["powers"] },
  { latex: "x\\cdot x", kind: "simplify", answer: "x^{2}", tags: ["powers"] },
  { latex: "\\frac{x^{5}}{x^{2}}", kind: "simplify", answer: "x^{3}", tags: ["powers", "cancel"] },
  { latex: "x^{0}", kind: "simplify", answer: "1", tags: ["powers", "identity"] },
  { latex: "(x^{2})^{3}", kind: "simplify", answer: "x^{6}", tags: ["powers", "nested"] },

  // ---- expanding
  { latex: "2(x+3)", kind: "simplify", answer: "2 x + 6", tags: ["distribute"] },
  { latex: "-(x+3)", kind: "simplify", answer: "-x - 3", tags: ["distribute", "signs"] },
  { latex: "3(2x-4)", kind: "simplify", answer: "6 x - 12", tags: ["distribute"] },
  { latex: "(x+1)(x+2)", kind: "simplify", answer: "x^{2} + 3 x + 2", tags: ["distribute", "binomial"] },
  { latex: "(x+2)(x-2)", kind: "simplify", answer: "x^{2} - 4", tags: ["distribute", "difference-of-squares"] },
  { latex: "(x+1)^{2}", kind: "simplify", answer: "x^{2} + 2 x + 1", tags: ["distribute", "square"] },
  { latex: "2(x+1)+3(x-2)", kind: "simplify", answer: "5 x - 4", tags: ["distribute", "like-terms"] },

  // ---- algebraic fractions
  { latex: "\\frac{2x+4}{2}", kind: "simplify", answer: "x + 2", tags: ["fractions", "algebra"] },
  { latex: "\\frac{6x}{3x}", kind: "simplify", answer: "2", tags: ["fractions", "cancel"] },
  { latex: "\\frac{x}{2}+\\frac{x}{3}", kind: "simplify", answer: "\\frac{5 x}{6}", tags: ["fractions", "algebra"] },
  { latex: "\\frac{4x^{2}}{2x}", kind: "simplify", answer: "2 x", tags: ["fractions", "cancel"] },

  // ---- linear equations
  { latex: "x+3=7", kind: "solve", answer: "x = 4", roots: [4], tags: ["linear"] },
  { latex: "2x=8", kind: "solve", answer: "x = 4", roots: [4], tags: ["linear"] },
  { latex: "2x+3=7", kind: "solve", answer: "x = 2", roots: [2], tags: ["linear"] },
  { latex: "5x-3=2x+9", kind: "solve", answer: "x = 4", roots: [4], tags: ["linear", "both-sides"] },
  { latex: "3=x", kind: "solve", answer: "x = 3", roots: [3], tags: ["linear", "swap"] },
  { latex: "\\frac{x}{2}=3", kind: "solve", answer: "x = 6", roots: [6], tags: ["linear", "fractions"] },
  { latex: "\\frac{x+1}{3}=2", kind: "solve", answer: "x = 5", roots: [5], tags: ["linear", "fractions"] },
  { latex: "2(x+3)=10", kind: "solve", answer: "x = 2", roots: [2], tags: ["linear", "distribute"] },
  { latex: "-2x=6", kind: "solve", answer: "x = -3", roots: [-3], tags: ["linear", "signs"] },
  { latex: "4x+2=2x+2", kind: "solve", answer: "x = 0", roots: [0], tags: ["linear", "zero"] },
  { latex: "\\frac{2x}{3}=4", kind: "solve", answer: "x = 6", roots: [6], tags: ["linear", "fractions"] },
  { latex: "3x+2=11", kind: "solve", answer: "x = 3", roots: [3], tags: ["linear"] },

  // ---- inequalities
  { latex: "2x<10", kind: "solve", answer: "x < 5", tags: ["inequality"] },
  { latex: "-2x>6", kind: "solve", answer: "x < -3", tags: ["inequality", "flip"] },
  { latex: "3x+1\\le7", kind: "solve", answer: "x \\le 2", tags: ["inequality"] },

  // ---- degenerate equations
  { latex: "x+1=x+1", kind: "solve", tags: ["identity"] },
  { latex: "x+1=x+2", kind: "solve", tags: ["no-solution"] },

  // ---- quadratics
  { latex: "x^{2}=9", kind: "solve", roots: [-3, 3], tags: ["quadratic", "factor"] },
  { latex: "x^{2}-5x+6=0", kind: "solve", roots: [2, 3], tags: ["quadratic", "factor"] },
  { latex: "x^{2}+5x+6=0", kind: "solve", roots: [-3, -2], tags: ["quadratic", "factor"] },
  { latex: "x^{2}-4=0", kind: "solve", roots: [-2, 2], tags: ["quadratic", "factor"] },
  { latex: "2x^{2}-8=0", kind: "solve", roots: [-2, 2], tags: ["quadratic", "factor"] },
  { latex: "x^{2}-2x+1=0", kind: "solve", roots: [1], tags: ["quadratic", "repeated-root"] },
  { latex: "x^{2}+2x-5=0", kind: "solve", roots: [-3.449489742783178, 1.449489742783178], tags: ["quadratic", "formula"] },
  { latex: "x^{2}+1=0", kind: "solve", roots: [], tags: ["quadratic", "no-real-solutions"] },
  { latex: "2x^{2}+3x-2=0", kind: "solve", roots: [-2, 0.5], tags: ["quadratic", "factor"] },
  { latex: "x^{2}+5x=-6", kind: "solve", roots: [-3, -2], tags: ["quadratic", "rearrange"] },
  { latex: "x^{2}=2x+3", kind: "solve", roots: [-1, 3], tags: ["quadratic", "rearrange"] },

  // ---- literal equations
  { latex: "2x+y=5", kind: "solve", answer: "x = \\frac{5 - y}{2}", tags: ["literal", "two-variable"] },

  // ---- out of scope, must fail cleanly rather than answer wrongly
  { latex: "x^{3}-8=0", kind: "solve", unsupported: true, tags: ["cubic"] },
  { latex: "\\sin(x)=1", kind: "solve", unsupported: true, tags: ["trig"] },
  { latex: "\\frac{1}{x}=2", kind: "solve", unsupported: true, tags: ["rational"] },
];

export const byTag = (tag: string): CorpusProblem[] =>
  problems.filter((p) => p.tags.includes(tag));
