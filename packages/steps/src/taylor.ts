import {
  add, children, cloneFresh, containsDiff, diff, div, evaluateExact,
  evaluateNumeric, makeTerm, type MathNode, mul, num, pow, Rational, substitute,
  sym, symbols, toLatex, withChildren,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { normalize } from "./normalize.js";
import { differentiationRules, expressionRules } from "./rules/index.js";
import { displayStep } from "./step.js";
import { type Solution, type Step, UnsupportedProblemError } from "./types.js";

/**
 * Taylor and Maclaurin series, in the direction that starts from the function.
 *
 * The other direction — recognising a series someone wrote down — lives in
 * series.ts. This one needed a way to be *asked*, which is why `taylor` and
 * `maclaurin` are named operations rather than notation: "find the Maclaurin
 * series of f" is a sentence, and there is no symbol for it.
 *
 * Differentiation goes through the ordinary rule engine, not through the
 * verifier's own differentiator in symbolic-diff.ts. That is deliberate: the
 * verifier has to stay a second opinion, and a Taylor polynomial built with
 * its differentiator would be checked against itself.
 */

/**
 * How many derivatives to take before giving up on a stubborn function.
 *
 * Eight, which is past anything a question asks for and inside what the rule
 * engine does quickly. Most functions reach it in a few milliseconds; arctan,
 * whose derivatives are genuinely messy rational functions, takes about two
 * seconds at this order and rather less at the four or five terms actually
 * set.
 */
const MAX_ORDER = 8;

/**
 * One derivative, through the ordinary rule engine.
 *
 * Tidied by differentiationRules alone, which leaves EXPAND_POWER out on
 * purpose. Running the full expression rules afterwards put it back, and that
 * is what made repeated differentiation unusable: the fifth derivative of
 * ln(1+x) is 24/(1+x)^5, and with the denominator multiplied out into a
 * degree-five polynomial the next quotient rule has nothing to cancel
 * against. Each round then roughly doubled the size of the expression, and
 * the sixth derivative took eight seconds where the fifth took a tenth of
 * one.
 */
function derivativeOf(expr: MathNode, v: string): MathNode | null {
  const result = run(
    diff(cloneFresh(expr), sym(v)), differentiationRules, { variable: v },
    { verify: false, maxSteps: 200 },
  );
  return containsDiff(result.node) ? null : result.node;
}

/** sqrt(u) -> u^(1/2), everywhere in the tree. */
function rootsAsPowers(n: MathNode): MathNode {
  if (n.type === "fn" && n.name === "sqrt" && n.args.length === 1) {
    return pow(rootsAsPowers(n.args[0]!), num(Rational.of(1, 2)));
  }
  const kids = children(n);
  if (kids.length === 0) return n;
  return withChildren(n, kids.map(rootsAsPowers));
}

/**
 * The value of an expression at the centre, kept as an expression.
 *
 * Not reduced to a rational: the coefficients of the Taylor series of e^x
 * about 1 are all e, and demanding an exact *number* refused the whole
 * expansion for the sake of one that has no decimal.
 */
function valueAtCentre(expr: MathNode, v: string, centre: MathNode): MathNode | null {
  const put = normalize(substitute(cloneFresh(expr), v, cloneFresh(centre)));
  const simplified = run(put, expressionRules, {}, { verify: false, maxSteps: 60 }).node;
  // Anything still carrying the variable means the substitution did not take,
  // which is a bug rather than a hard problem.
  return symbols(simplified).has(v) ? null : simplified;
}

/** Is this expression exactly zero, so its term drops out? */
function vanishes(n: MathNode): boolean {
  const exact = evaluateExact(n);
  return exact !== null && exact.isZero();
}

export function solveTaylor(node: MathNode): Solution {
  const problem = toLatex(node);
  if (node.type !== "fn" || node.name !== "taylor" || node.args.length !== 4) {
    throw new UnsupportedProblemError("could not tell what to expand");
  }
  const [body, variableNode, centre, orderNode] = node.args as [
    MathNode, MathNode, MathNode, MathNode,
  ];
  if (variableNode.type !== "sym") {
    throw new UnsupportedProblemError("could not tell which variable to expand in");
  }
  const v = variableNode.name;

  const orderValue = evaluateExact(orderNode);
  if (!orderValue || !orderValue.isInteger() || orderValue.isNegative()) {
    throw new UnsupportedProblemError("the number of terms has to be a whole number");
  }
  const order = Number(orderValue.toNumber());
  if (order > MAX_ORDER) {
    throw new UnsupportedProblemError(`that is more than ${MAX_ORDER} derivatives to take`);
  }

  const centreValue = evaluateExact(centre);
  if (!centreValue) {
    throw new UnsupportedProblemError("the centre has to be an exact number");
  }

  // Roots go in as half powers. Differentiating sqrt(1+x) repeatedly leaves a
  // tower of nested roots the tidying rules cannot flatten, where the same
  // function written as (1+x)^(1/2) stays one compact power at every order.
  const expandable = rootsAsPowers(cloneFresh(body));

  const steps: Step[] = [
    displayStep("TAYLOR_SETUP", problem, taylorFormula(v, centre), node, {
      variable: v,
      centre: toLatex(centre),
      order: String(order),
      f: toLatex(body),
    }),
  ];

  // Differentiate repeatedly, reading off the value at the centre each time.
  const terms: MathNode[] = [];
  let current: MathNode = expandable;
  let factorial = Rational.ONE;

  for (let k = 0; k <= order; k++) {
    if (k > 0) {
      factorial = factorial.mul(Rational.of(k));
      const next = derivativeOf(current, v);
      if (!next) {
        throw new UnsupportedProblemError(
          `cannot take derivative ${k} of ${toLatex(body)}`,
        );
      }
      current = next;
    }

    const value = valueAtCentre(current, v, centre);
    if (!value) {
      throw new UnsupportedProblemError(
        `derivative ${k} has no exact value at ${toLatex(centre)}`,
      );
    }

    steps.push(displayStep(
      k === 0 ? "TAYLOR_TERM_FIRST" : "TAYLOR_TERM",
      toLatex(current),
      toLatex(value),
      node,
      {
        order: String(k),
        derivative: toLatex(current),
        centre: toLatex(centre),
        value: toLatex(value),
        factorial: factorial.toLatex(),
        f: toLatex(body),
      },
    ));

    if (vanishes(value)) continue;

    // Simplify the coefficient on its own. Running the expression rules over
    // the assembled polynomial instead would put every term over a common
    // denominator, which is the opposite of what a series should look like.
    const raw = factorial.equals(Rational.ONE) ? value : div(value, num(factorial));
    const coefficient = run(raw, expressionRules, {}, { verify: false, maxSteps: 40 }).node;

    if (k === 0) {
      terms.push(coefficient);
      continue;
    }
    const power = shifted(v, centreValue, k);
    // A rational coefficient goes through makeTerm, which knows not to print
    // a leading 1 or to write -1 as a coefficient at all.
    const exact = evaluateExact(coefficient);
    terms.push(exact ? makeTerm(exact, [power]) : mul([coefficient, power]));
  }

  // Structural tidying only. The terms are already in their final form and
  // anything more would start combining them.
  const polynomial = terms.length === 0 ? num(Rational.ZERO) : add(terms);
  const tidied = normalize(polynomial);

  steps.push(displayStep("TAYLOR_ASSEMBLE", taylorFormula(v, centre), toLatex(tidied), node, {
    order: String(order),
    variable: v,
  }));

  const answer = toLatex(tidied);
  return {
    kind: "series",
    problem,
    variable: v,
    answer,
    answers: [answer],
    steps,
    verified: matchesNear(body, tidied, v, centreValue, order),
    note: order < MAX_ORDER
      ? `Up to the ${ordinal(order)} power. The series carries on.`
      : undefined,
  };
}

/** `(x - a)^k`, or `x^k` when the centre is zero. */
function shifted(v: string, centre: Rational, k: number): MathNode {
  const base = centre.isZero()
    ? sym(v)
    : add([sym(v), num(centre.neg())]);
  return k === 1 ? base : pow(base, num(Rational.of(k)));
}

function taylorFormula(v: string, centre: MathNode): string {
  const at = toLatex(centre);
  const shift = at === "0" ? v : `\\left(${v} - ${at}\\right)`;
  return `\\sum_{k=0}^{n}\\left(\\frac{f^{(k)}\\left(${at}\\right)}{k!} ${shift}^{k}\\right)`;
}

function ordinal(n: number): string {
  const names = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth",
    "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
  return names[n] ?? `${n}th`;
}

/**
 * Does the polynomial actually track the function near the centre?
 *
 * The defining property of a Taylor polynomial is that it agrees with f to
 * order n at the centre, so the gap between them must fall away like the next
 * power. Checked at a point close in, where that gap is small, and at a point
 * further out, where it is bigger — a polynomial that merely happened to touch
 * f at one place would fail the pair.
 *
 * Not a proof, but it is an independent one: nothing here reuses the
 * differentiation that built the polynomial.
 */
function matchesNear(
  f: MathNode,
  polynomial: MathNode,
  v: string,
  centre: Rational,
  order: number,
): boolean {
  const at = centre.toNumber();
  const near = 0.05;
  const far = 0.2;

  const gap = (h: number): number | null => {
    const x = at + h;
    const a = evaluateNumeric(f, { [v]: x });
    const b = evaluateNumeric(polynomial, { [v]: x });
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.abs(a - b);
  };

  const close = gap(near);
  const further = gap(far);
  if (close === null || further === null) return false;

  // The error should be of order h^(n+1). Allowing a generous constant, since
  // what is being ruled out is a polynomial that is simply wrong, not one
  // whose remainder is a little larger than the textbook bound.
  const allowed = 50 * Math.pow(near, order + 1) + 1e-12;
  if (close > allowed) return false;

  // And it has to grow the way a remainder grows, rather than staying flat,
  // which is what a constant disagreement would do.
  return further >= close - 1e-12;
}
