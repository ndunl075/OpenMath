import {
  add, evaluateNumeric, fn, type MathNode, mul, neg, num, pow, Rational, rel, sym, toLatex,
} from "@openmath/math-core";
import { coeff, degree, type Poly, subPoly, toPolynomial } from "./poly.js";
import { explain } from "./explain.js";
import { run } from "./engine.js";
import { expressionRules } from "./rules/index.js";
import type { Step } from "./types.js";

export interface QuadraticResult {
  steps: Step[];
  answers: string[];
  answerValues: number[];
  note?: string;
}

/** Wrap a negative number in brackets so a substituted formula reads correctly. */
function bracketed(r: Rational): string {
  return r.isNegative() ? `\\left(${r.toLatex()}\\right)` : r.toLatex();
}

function displayStep(
  ruleId: string,
  before: string,
  after: string,
  beforeNode: MathNode,
  vars: Record<string, string> = {},
): Step {
  const wording = explain(ruleId, vars);
  return {
    ruleId,
    title: wording.title,
    explanation: wording.text,
    before,
    after,
    beforeNode,
    display: true,
    changes: [],
  };
}

/** Run the expression rules over a node and return only its simplified form. */
function simplifyNode(n: MathNode): MathNode {
  return run(n, expressionRules, {}, { verify: false }).node;
}

export function polynomialOf(equation: MathNode, variable: string): Poly | null {
  if (equation.type !== "rel") return null;
  const l = toPolynomial(equation.lhs, variable);
  const r = toPolynomial(equation.rhs, variable);
  if (!l || !r) return null;
  return subPoly(l, r);
}

/**
 * Solve ax^2 + bx + c = 0.
 *
 * Prefers factoring when both roots are rational, because that is the method a
 * student is expected to show. Falls back to the quadratic formula, keeping the
 * roots exact as radicals rather than rounding to decimals.
 */
export function solveQuadratic(
  equation: MathNode,
  variable: string,
  poly: Poly,
): QuadraticResult | null {
  if (degree(poly) !== 2) return null;
  const a = coeff(poly, 2);
  const b = coeff(poly, 1);
  const c = coeff(poly, 0);
  if (a.isZero()) return null;

  const steps: Step[] = [];
  const currentLatex = toLatex(equation);
  const discriminant = b.mul(b).sub(Rational.of(4).mul(a).mul(c));
  const exactRoot = discriminant.isNegative() ? null : discriminant.nthRoot(2n);

  // ---- Factoring path: both roots rational.
  if (exactRoot) {
    const twoA = Rational.of(2).mul(a);
    const r1 = b.neg().add(exactRoot).div(twoA);
    const r2 = b.neg().sub(exactRoot).div(twoA);

    const ordered = r1.cmp(r2) <= 0 ? [r1, r2] : [r2, r1];
    const factorNode = (r: Rational): MathNode =>
      r.isZero() ? sym(variable) : add([sym(variable), num(r.neg())]);
    const factors: MathNode[] = ordered.map(factorNode);
    const product = a.isOne() ? mul(factors) : mul([num(a), ...factors]);
    const factored = rel("=", product, num(Rational.ZERO));

    steps.push({
      ...displayStep("FACTOR_QUADRATIC", currentLatex, toLatex(factored), equation, {
        product: c.div(a).toLatex(),
        sum: b.div(a).toLatex(),
      }),
      afterNode: factored,
      display: false,
    });

    const roots = r1.equals(r2) ? [ordered[0]!] : ordered;
    const answers = roots.map((r) => `${variable} = ${r.toLatex()}`);
    steps.push(
      displayStep("ZERO_PRODUCT", toLatex(factored), answers.join(" \\quad \\text{or} \\quad "), factored),
    );
    return {
      steps,
      answers,
      answerValues: roots.map((r) => r.toNumber()),
      ...(r1.equals(r2) ? { note: "The two roots are equal, so there is one solution." } : {}),
    };
  }

  // ---- Quadratic formula path.
  const leading = b.isZero() ? "" : `-${bracketed(b)} `;
  const formula =
    `${variable} = \\frac{${leading}\\pm \\sqrt{${bracketed(b)}^{2} - 4 \\cdot ${bracketed(a)} \\cdot ${bracketed(c)}}}{2 \\cdot ${bracketed(a)}}`;
  steps.push(
    displayStep("QUADRATIC_FORMULA", currentLatex, formula, equation, {
      a: a.toLatex(), b: b.toLatex(), c: c.toLatex(),
    }),
  );
  steps.push(
    displayStep(
      "DISCRIMINANT",
      formula,
      `${bracketed(b)}^{2} - 4 \\cdot ${bracketed(a)} \\cdot ${bracketed(c)} = ${discriminant.toLatex()}`,
      equation,
      { discriminant: discriminant.toLatex() },
    ),
  );

  if (discriminant.isNegative()) {
    steps.push(
      displayStep("NO_REAL_SOLUTIONS", formula, "\\text{no real solutions}", equation, {
        discriminant: discriminant.toLatex(),
      }),
    );
    return {
      steps,
      answers: [],
      answerValues: [],
      note: "No real solutions: the discriminant is negative.",
    };
  }

  const twoA = Rational.of(2).mul(a);
  const rootNode = (sign: 1 | -1): MathNode => {
    const radical = fn("sqrt", [num(discriminant)]);
    const signed = sign === 1 ? radical : neg(radical);
    return simplifyNode({
      type: "div", id: -1,
      num: add([num(b.neg()), signed]),
      den: num(twoA),
    });
  };
  const plus = rootNode(1);
  const minus = rootNode(-1);
  const ordered =
    evaluateNumeric(minus) <= evaluateNumeric(plus) ? [minus, plus] : [plus, minus];
  const answers = ordered.map((r) => `${variable} = ${toLatex(r)}`);
  steps.push(
    displayStep("QUADRATIC_ROOTS", formula, answers.join(" \\quad \\text{or} \\quad "), equation),
  );
  return {
    steps,
    answers,
    answerValues: ordered.map((r) => evaluateNumeric(r)),
  };
}

/** Exposed for tests: build x^2 style nodes without importing the AST helpers. */
export const quadraticHelpers = { pow, sym, num };
