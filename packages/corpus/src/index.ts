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
  kind: "simplify" | "evaluate" | "solve" | "differentiate" | "integrate";
  /** Exact expected answer LaTeX. */
  answer?: string;
  /**
   * The answer is only fixed up to an additive constant, which is true of every
   * indefinite integral. The check differentiates the answer written here and
   * compares it with the integrand, then compares the solver's answer with this
   * one by confirming the gap between them stays constant — string equality is
   * the wrong test when x^2/2 and (x^2+1)/2 are both right.
   */
  upToConstant?: true;
  /** Numeric value of each solution, checked by substitution. */
  roots?: number[];
  /** Expected to be rejected rather than answered. */
  unsupported?: true;
  /**
   * How an unsupported problem is refused. "unsupported" is the useful one, an
   * honest "we cannot do this yet"; "parse" records notation the grammar does
   * not read at all, which the scope check in @openmath/ocr turns into the same
   * message before the solver ever sees it.
   */
  declineReason?: "parse" | "unsupported";
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

  // ---- derivatives: the leaves
  { latex: "\\frac{d}{dx}(7)", kind: "differentiate", answer: "0", tags: ["derivative", "constant"] },
  { latex: "\\frac{d}{dx}(x)", kind: "differentiate", answer: "1", tags: ["derivative", "variable"] },
  { latex: "\\frac{d}{dx}(x^{3})", kind: "differentiate", answer: "3 x^{2}", tags: ["derivative", "power"] },
  { latex: "\\frac{d}{dx} x^{2}", kind: "differentiate", answer: "2 x", tags: ["derivative", "power", "no-brackets"] },
  { latex: "\\frac{d}{dx}(x^{-2})", kind: "differentiate", answer: "-2 x^{-3}", tags: ["derivative", "power", "negative-exponent"] },
  { latex: "\\frac{d}{dx}(5x^{4})", kind: "differentiate", answer: "20 x^{3}", tags: ["derivative", "constant-multiple"] },
  { latex: "\\frac{d}{dx}(-x^{2})", kind: "differentiate", answer: "-2 x", tags: ["derivative", "signs"] },

  // ---- derivatives: sums and differences
  { latex: "\\frac{d}{dx}(x^{2}+3x)", kind: "differentiate", answer: "2 x + 3", tags: ["derivative", "sum"] },
  { latex: "\\frac{d}{dx}(x^{2}-4x+7)", kind: "differentiate", answer: "2 x - 4", tags: ["derivative", "sum", "difference"] },
  { latex: "\\frac{d}{dt}(t^{2}+t)", kind: "differentiate", answer: "2 t + 1", tags: ["derivative", "other-variable"] },

  // ---- derivatives: the standard functions
  { latex: "\\frac{d}{dx}\\sin(x)", kind: "differentiate", answer: "\\cos\\left(x\\right)", tags: ["derivative", "trig"] },
  { latex: "\\frac{d}{dx}\\cos(x)", kind: "differentiate", answer: "-\\sin\\left(x\\right)", tags: ["derivative", "trig"] },
  { latex: "\\frac{d}{dx}\\tan(x)", kind: "differentiate", answer: "\\sec\\left(x\\right)^{2}", tags: ["derivative", "trig"] },
  { latex: "\\frac{d}{dx}\\ln(x)", kind: "differentiate", answer: "\\frac{1}{x}", tags: ["derivative", "log"] },
  { latex: "\\frac{d}{dx}\\sqrt{x}", kind: "differentiate", answer: "\\frac{1}{2 \\sqrt{x}}", tags: ["derivative", "roots"] },
  { latex: "\\frac{d}{dx}\\exp(x)", kind: "differentiate", answer: "\\exp\\left(x\\right)", tags: ["derivative", "exponential"] },
  { latex: "\\frac{d}{dx}e^{x}", kind: "differentiate", answer: "e^{x}", tags: ["derivative", "exponential"] },
  { latex: "\\frac{d}{dx}2^{x}", kind: "differentiate", answer: "2^{x} \\ln\\left(2\\right)", tags: ["derivative", "exponential"] },

  // ---- derivatives: chain rule
  { latex: "\\frac{d}{dx}\\sin(2x)", kind: "differentiate", answer: "2 \\cos\\left(2 x\\right)", tags: ["derivative", "chain", "trig"] },
  { latex: "\\frac{d}{dx}\\cos(3x)", kind: "differentiate", answer: "-3 \\sin\\left(3 x\\right)", tags: ["derivative", "chain", "trig"] },
  { latex: "\\frac{d}{dx}\\tan(x^{2})", kind: "differentiate", answer: "2 \\sec\\left(x^{2}\\right)^{2} x", tags: ["derivative", "chain", "trig"] },
  { latex: "\\frac{d}{dx}(x^{2}+1)^{3}", kind: "differentiate", answer: "6 \\left(x^{2} + 1\\right)^{2} x", tags: ["derivative", "chain", "power"] },
  { latex: "\\frac{d}{dx}(3x+1)^{4}", kind: "differentiate", answer: "12 \\left(3 x + 1\\right)^{3}", tags: ["derivative", "chain", "power"] },
  { latex: "\\frac{d}{dx}\\sqrt{x^{2}+1}", kind: "differentiate", answer: "\\frac{x}{\\sqrt{x^{2} + 1}}", tags: ["derivative", "chain", "roots"] },
  { latex: "\\frac{d}{dx}\\ln(x^{2}+1)", kind: "differentiate", answer: "\\frac{2 x}{x^{2} + 1}", tags: ["derivative", "chain", "log"] },
  { latex: "\\frac{d}{dx}e^{3x}", kind: "differentiate", answer: "3 e^{3 x}", tags: ["derivative", "chain", "exponential"] },
  { latex: "\\frac{d}{dx}\\sin(\\sqrt{x})", kind: "differentiate", answer: "\\frac{\\cos\\left(\\sqrt{x}\\right)}{2 \\sqrt{x}}", tags: ["derivative", "chain", "nested"] },
  { latex: "\\frac{d}{dx}\\sin(\\cos(x))", kind: "differentiate", answer: "-\\cos\\left(\\cos\\left(x\\right)\\right) \\sin\\left(x\\right)", tags: ["derivative", "chain", "nested"] },
  { latex: "\\frac{d}{dx}\\sin(\\sin(\\sin(x)))", kind: "differentiate", answer: "\\cos\\left(\\sin\\left(\\sin\\left(x\\right)\\right)\\right) \\cos\\left(\\sin\\left(x\\right)\\right) \\cos\\left(x\\right)", tags: ["derivative", "chain", "nested"] },

  // ---- derivatives: products and quotients
  { latex: "\\frac{d}{dx}(x\\sin(x))", kind: "differentiate", answer: "\\sin\\left(x\\right) + x \\cos\\left(x\\right)", tags: ["derivative", "product"] },
  { latex: "\\frac{d}{dx}(x\\ln(x))", kind: "differentiate", answer: "\\ln\\left(x\\right) + 1", tags: ["derivative", "product"] },
  { latex: "\\frac{d}{dx}\\frac{\\sin(x)}{x}", kind: "differentiate", answer: "\\frac{\\cos\\left(x\\right) x - \\sin\\left(x\\right)}{x^{2}}", tags: ["derivative", "quotient"] },
  { latex: "\\frac{d}{dx}\\frac{\\sin(2x)}{x}", kind: "differentiate", answer: "\\frac{2 \\cos\\left(2 x\\right) x - \\sin\\left(2 x\\right)}{x^{2}}", tags: ["derivative", "quotient", "chain"] },
  { latex: "\\frac{d}{dx}\\frac{x}{x+1}", kind: "differentiate", answer: "\\frac{1}{\\left(x + 1\\right)^{2}}", tags: ["derivative", "quotient"] },
  { latex: "\\frac{d}{dx}\\frac{1}{x}", kind: "differentiate", answer: "-\\frac{1}{x^{2}}", tags: ["derivative", "quotient", "reciprocal"] },
  { latex: "\\frac{d}{dx}\\frac{x^{2}}{3}", kind: "differentiate", answer: "\\frac{2 x}{3}", tags: ["derivative", "constant-multiple"] },

  // ---- derivatives: prime notation
  { latex: "(x^{2}+3x)'", kind: "differentiate", answer: "2 x + 3", tags: ["derivative", "prime"] },
  { latex: "(x^{3})''", kind: "differentiate", answer: "6 x", tags: ["derivative", "prime", "second"] },

  // ---- derivatives out of scope, must be refused rather than half-answered
  { latex: "\\frac{dy}{dx}", kind: "differentiate", unsupported: true, tags: ["derivative", "implicit"] },
  { latex: "\\frac{d}{dx}(y^{2})", kind: "differentiate", unsupported: true, tags: ["derivative", "implicit"] },
  { latex: "f'(x)", kind: "differentiate", unsupported: true, tags: ["derivative", "prime", "undefined-function"] },
  { latex: "\\frac{d}{dx}\\arctan(x)", kind: "differentiate", unsupported: true, tags: ["derivative", "no-rule"] },
  { latex: "\\frac{d}{dx}\\left|x\\right|", kind: "differentiate", unsupported: true, tags: ["derivative", "no-rule"] },
  { latex: "\\frac{d}{dx}(x^{2})=2x", kind: "differentiate", unsupported: true, tags: ["derivative", "equation"] },

  // ---- integrals: the table
  { latex: "\\int x \\, dx", kind: "integrate", answer: "\\frac{x^{2}}{2} + C", upToConstant: true, tags: ["integral", "power"] },
  { latex: "\\int x^{2} \\, dx", kind: "integrate", answer: "\\frac{x^{3}}{3} + C", upToConstant: true, tags: ["integral", "power"] },
  { latex: "\\int x^{5} \\, dx", kind: "integrate", answer: "\\frac{x^{6}}{6} + C", upToConstant: true, tags: ["integral", "power"] },
  { latex: "\\int 3 \\, dx", kind: "integrate", answer: "3x + C", upToConstant: true, tags: ["integral", "constant"] },
  { latex: "\\int \\frac{1}{x} \\, dx", kind: "integrate", answer: "\\ln\\left|x\\right| + C", upToConstant: true, tags: ["integral", "log"] },
  { latex: "\\int \\frac{1}{x^{3}} \\, dx", kind: "integrate", answer: "-\\frac{1}{2x^{2}} + C", upToConstant: true, tags: ["integral", "power", "negative-exponent"] },
  { latex: "\\int \\sqrt{x} \\, dx", kind: "integrate", answer: "\\frac{2}{3}x^{\\frac{3}{2}} + C", upToConstant: true, tags: ["integral", "roots"] },
  { latex: "\\int e^{x} \\, dx", kind: "integrate", answer: "e^{x} + C", upToConstant: true, tags: ["integral", "exponential"] },
  { latex: "\\int 2^{x} \\, dx", kind: "integrate", answer: "\\frac{2^{x}}{\\ln\\left(2\\right)} + C", upToConstant: true, tags: ["integral", "exponential"] },
  { latex: "\\int \\sin(x) \\, dx", kind: "integrate", answer: "-\\cos\\left(x\\right) + C", upToConstant: true, tags: ["integral", "trig"] },
  { latex: "\\int \\cos(x) \\, dx", kind: "integrate", answer: "\\sin\\left(x\\right) + C", upToConstant: true, tags: ["integral", "trig"] },
  { latex: "\\int \\sec(x)^{2} \\, dx", kind: "integrate", answer: "\\tan\\left(x\\right) + C", upToConstant: true, tags: ["integral", "trig"] },
  { latex: "\\int \\frac{1}{1+x^{2}} \\, dx", kind: "integrate", answer: "\\arctan\\left(x\\right) + C", upToConstant: true, tags: ["integral", "arctan"] },
  { latex: "\\int \\frac{1}{\\sqrt{1-x^{2}}} \\, dx", kind: "integrate", answer: "\\arcsin\\left(x\\right) + C", upToConstant: true, tags: ["integral", "arcsin"] },

  // ---- integrals: sums and constant multiples
  { latex: "\\int (x^{2}+3x) \\, dx", kind: "integrate", answer: "\\frac{x^{3}}{3} + \\frac{3x^{2}}{2} + C", upToConstant: true, tags: ["integral", "sum"] },
  { latex: "\\int (4x^{3}-2x+5) \\, dx", kind: "integrate", answer: "x^{4} - x^{2} + 5x + C", upToConstant: true, tags: ["integral", "sum", "difference"] },
  { latex: "\\int 5x^{4} \\, dx", kind: "integrate", answer: "x^{5} + C", upToConstant: true, tags: ["integral", "constant-multiple"] },
  { latex: "\\int \\frac{x^{2}}{3} \\, dx", kind: "integrate", answer: "\\frac{x^{3}}{9} + C", upToConstant: true, tags: ["integral", "constant-multiple"] },
  { latex: "\\int (x+1)(x+2) \\, dx", kind: "integrate", answer: "\\frac{x^{3}}{3} + \\frac{3x^{2}}{2} + 2x + C", upToConstant: true, tags: ["integral", "expand"] },
  { latex: "\\int (x^{2}+1)^{2} \\, dx", kind: "integrate", answer: "\\frac{x^{5}}{5} + \\frac{2x^{3}}{3} + x + C", upToConstant: true, tags: ["integral", "expand"] },
  { latex: "\\int t^{2} \\, dt", kind: "integrate", answer: "\\frac{t^{3}}{3} + C", upToConstant: true, tags: ["integral", "other-variable"] },

  // ---- integrals: substitution
  { latex: "\\int 2x(x^{2}+1)^{3} \\, dx", kind: "integrate", answer: "\\frac{(x^{2}+1)^{4}}{4} + C", upToConstant: true, tags: ["integral", "substitution"] },
  { latex: "\\int \\sin(3x) \\, dx", kind: "integrate", answer: "-\\frac{\\cos\\left(3x\\right)}{3} + C", upToConstant: true, tags: ["integral", "substitution", "trig"] },
  { latex: "\\int \\cos(2x) \\, dx", kind: "integrate", answer: "\\frac{\\sin\\left(2x\\right)}{2} + C", upToConstant: true, tags: ["integral", "substitution", "trig"] },
  { latex: "\\int e^{3x} \\, dx", kind: "integrate", answer: "\\frac{e^{3x}}{3} + C", upToConstant: true, tags: ["integral", "substitution", "exponential"] },
  { latex: "\\int xe^{x^{2}} \\, dx", kind: "integrate", answer: "\\frac{e^{x^{2}}}{2} + C", upToConstant: true, tags: ["integral", "substitution", "exponential"] },
  { latex: "\\int \\frac{2x}{x^{2}+1} \\, dx", kind: "integrate", answer: "\\ln\\left|x^{2}+1\\right| + C", upToConstant: true, tags: ["integral", "substitution", "log"] },
  { latex: "\\int \\frac{\\ln(x)}{x} \\, dx", kind: "integrate", answer: "\\frac{\\ln\\left(x\\right)^{2}}{2} + C", upToConstant: true, tags: ["integral", "substitution", "log"] },
  { latex: "\\int (2x+1)^{5} \\, dx", kind: "integrate", answer: "\\frac{(2x+1)^{6}}{12} + C", upToConstant: true, tags: ["integral", "substitution", "power"] },
  { latex: "\\int \\frac{1}{(x-1)^{2}} \\, dx", kind: "integrate", answer: "-\\frac{1}{x-1} + C", upToConstant: true, tags: ["integral", "substitution", "power"] },

  // ---- integrals: by parts
  { latex: "\\int x\\sin(x) \\, dx", kind: "integrate", answer: "\\sin\\left(x\\right) - x\\cos\\left(x\\right) + C", upToConstant: true, tags: ["integral", "by-parts", "trig"] },
  { latex: "\\int x\\cos(x) \\, dx", kind: "integrate", answer: "x\\sin\\left(x\\right) + \\cos\\left(x\\right) + C", upToConstant: true, tags: ["integral", "by-parts", "trig"] },
  { latex: "\\int xe^{x} \\, dx", kind: "integrate", answer: "xe^{x} - e^{x} + C", upToConstant: true, tags: ["integral", "by-parts", "exponential"] },
  { latex: "\\int x^{2}e^{x} \\, dx", kind: "integrate", answer: "x^{2}e^{x} - 2xe^{x} + 2e^{x} + C", upToConstant: true, tags: ["integral", "by-parts", "twice"] },
  { latex: "\\int \\ln(x) \\, dx", kind: "integrate", answer: "x\\ln\\left(x\\right) - x + C", upToConstant: true, tags: ["integral", "by-parts", "log"] },
  { latex: "\\int x\\ln(x) \\, dx", kind: "integrate", answer: "\\frac{x^{2}\\ln\\left(x\\right)}{2} - \\frac{x^{2}}{4} + C", upToConstant: true, tags: ["integral", "by-parts", "log"] },

  // ---- integrals: rational functions
  { latex: "\\int \\frac{5x-3}{x^{2}-2x-3} \\, dx", kind: "integrate", answer: "3\\ln\\left|x-3\\right| + 2\\ln\\left|x+1\\right| + C", upToConstant: true, tags: ["integral", "partial-fractions"] },
  { latex: "\\int \\frac{1}{x^{2}-1} \\, dx", kind: "integrate", answer: "\\frac{1}{2}\\ln\\left|x-1\\right| - \\frac{1}{2}\\ln\\left|x+1\\right| + C", upToConstant: true, tags: ["integral", "partial-fractions"] },
  { latex: "\\int \\frac{1}{x^{2}+3x+2} \\, dx", kind: "integrate", answer: "\\ln\\left|x+1\\right| - \\ln\\left|x+2\\right| + C", upToConstant: true, tags: ["integral", "partial-fractions"] },
  { latex: "\\int \\frac{x^{2}}{x+1} \\, dx", kind: "integrate", answer: "\\frac{x^{2}}{2} - x + \\ln\\left|x+1\\right| + C", upToConstant: true, tags: ["integral", "long-division"] },

  // ---- integrals: definite, where the answer is one number and pinned exactly
  { latex: "\\int_{0}^{1} x^{2} \\, dx", kind: "integrate", answer: "\\frac{1}{3}", tags: ["integral", "definite"] },
  { latex: "\\int_{1}^{3} 2x \\, dx", kind: "integrate", answer: "8", tags: ["integral", "definite"] },
  { latex: "\\int_{0}^{2} (x^{2}+1) \\, dx", kind: "integrate", answer: "\\frac{14}{3}", tags: ["integral", "definite", "sum"] },
  { latex: "\\int_{1}^{2} \\frac{1}{x^{2}} \\, dx", kind: "integrate", answer: "\\frac{1}{2}", tags: ["integral", "definite"] },
  { latex: "\\int_{0}^{1} e^{x} \\, dx", kind: "integrate", answer: "e - 1", tags: ["integral", "definite", "exponential"] },
  { latex: "\\int_{-1}^{1} x^{3} \\, dx", kind: "integrate", answer: "0", tags: ["integral", "definite", "odd"] },
  { latex: "\\int_{0}^{1} \\sqrt{x} \\, dx", kind: "integrate", answer: "\\frac{2}{3}", tags: ["integral", "definite", "roots"] },
  { latex: "\\int_{2}^{1} x \\, dx", kind: "integrate", answer: "-\\frac{3}{2}", tags: ["integral", "definite", "reversed-limits"] },
  { latex: "\\int_{0}^{3} (2x+1) \\, dx", kind: "integrate", answer: "12", tags: ["integral", "definite"] },

  // ---- integrals out of scope, must be refused rather than half-answered
  { latex: "\\int e^{x^{2}} \\, dx", kind: "integrate", unsupported: true, tags: ["integral", "no-elementary-antiderivative"] },
  { latex: "\\int \\sin(x^{2}) \\, dx", kind: "integrate", unsupported: true, tags: ["integral", "no-elementary-antiderivative"] },
  { latex: "\\int \\frac{1}{\\ln(x)} \\, dx", kind: "integrate", unsupported: true, tags: ["integral", "no-elementary-antiderivative"] },
  { latex: "\\int_{1}^{\\infty} \\frac{1}{x^{2}} \\, dx", kind: "integrate", unsupported: true, declineReason: "parse", tags: ["integral", "improper"] },
  { latex: "\\int_{-1}^{1} \\frac{1}{x} \\, dx", kind: "integrate", unsupported: true, tags: ["integral", "improper", "pole-inside"] },
  { latex: "\\int_{0}^{1} \\frac{1}{x} \\, dx", kind: "integrate", unsupported: true, tags: ["integral", "improper", "pole-at-limit"] },
  { latex: "\\int ax \\, dx", kind: "integrate", unsupported: true, tags: ["integral", "ambiguous"] },
  { latex: "\\int x \\, dx = 5", kind: "integrate", unsupported: true, tags: ["integral", "equation"] },
];

export const byTag = (tag: string): CorpusProblem[] =>
  problems.filter((p) => p.tags.includes(tag));
