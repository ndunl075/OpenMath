import {
  add, asLimit, diff, div, evaluateExact, evaluateNumeric, isInfinity, isZero,
  type LimitParts, limitNumerically, makeTerm, type MathNode, mul, num, pow,
  Rational, substitute, sym, symbols, toLatex, undefinedReason, withLimitBody,
} from "@openmath/math-core";
import { coeff, degree, type Poly, toPolynomial } from "../poly.js";
import type { Rule, RuleContext, RuleResult } from "../types.js";

/**
 * Limits, in the order a student is taught them.
 *
 * Substitution first, because it is the answer most of the time and everything
 * else is a response to it failing. Then the two ways out of an indeterminate
 * form: cancel the factor that made both sides zero, or differentiate top and
 * bottom. A limit at infinity is its own question, answered by comparing
 * degrees. Anything left over is a limit this engine cannot take, and the solver
 * declines it rather than returning the half of it that did simplify.
 */

/** A limit rule: matched against `lim` nodes only, and handed the pieces. */
function limitRule(
  id: string,
  apply: (l: LimitParts, ctx: RuleContext) => RuleResult | null,
): Rule {
  return {
    id,
    apply(n, ctx) {
      const l = asLimit(n);
      return l ? apply(l, ctx) : null;
    },
  };
}

/** The body evaluated as a function of the limit variable alone. */
function bodyAt(l: LimitParts, expr: MathNode): (x: number) => number {
  return (x: number) => evaluateNumeric(expr, { [l.variable]: x });
}

function pointValue(l: LimitParts): number {
  return evaluateNumeric(l.point);
}

/** How far the samples may sit from the value substitution claims. */
const CONTINUITY_TOLERANCE = 1e-4;

/**
 * The expression with the point substituted, when doing that is legitimate.
 *
 * Substitution is only the answer where the function is continuous, so the
 * substituted value has to be defined *and* has to be where the function is
 * actually heading. The value itself stays exact — this is a symbolic
 * substitution — and the sampling is only a guard, deciding whether to
 * substitute at all rather than what the result is. It is what keeps
 * `\lim_{x \to 0}\sqrt{x}` from being answered as though the function existed on
 * both sides of zero, while `\lim_{x \to 0^+}\sqrt{x}` is answered as 0.
 */
function substitutable(l: LimitParts): MathNode | null {
  const at = pointValue(l);
  if (!Number.isFinite(at)) return null;
  const substituted = substitute(l.body, l.variable, l.point);
  const value = evaluateNumeric(substituted);
  if (!Number.isFinite(value)) return null;
  if (undefinedReason(substituted)) return null;
  const approached = limitNumerically(bodyAt(l, l.body), at, l.side);
  if (!Number.isFinite(approached)) return null;
  const scale = Math.max(1, Math.abs(value), Math.abs(approached));
  if (Math.abs(approached - value) > CONTINUITY_TOLERANCE * scale) return null;
  return substituted;
}

/**
 * Put the point in.
 *
 * The substituted expression is left for the arithmetic rules to finish, so the
 * student sees the number go in and then sees it worked out, which is how the
 * step would be written on paper.
 */
export const limitSubstitute = limitRule("LIMIT_SUBSTITUTE", (l): RuleResult | null => {
  // A body that does not mention the variable is already the answer, and that
  // holds at infinity too, where substituting nothing would mean nothing.
  if (!symbols(l.body).has(l.variable)) {
    return {
      node: l.body,
      changes: [{ kind: "replace", fromIds: [l.node.id], toIds: [l.body.id] }],
      vars: { variable: l.variable, expression: toLatex(l.body) },
      explanationKey: "LIMIT_CONSTANT",
    };
  }
  const substituted = substitutable(l);
  if (!substituted) return null;
  return {
    node: substituted,
    changes: [{ kind: "replace", fromIds: [l.node.id], toIds: [substituted.id] }],
    vars: { variable: l.variable, point: toLatex(l.point) },
  };
});

// ------------------------------------------------------- indeterminate forms

/** Is this expression zero at the point the limit approaches? */
function vanishesAt(l: LimitParts, expr: MathNode): boolean {
  const exact = evaluateExact(substitute(expr, l.variable, l.point));
  if (exact) return exact.isZero();
  const value = evaluateNumeric(substitute(expr, l.variable, l.point));
  return Number.isFinite(value) && Math.abs(value) <= 1e-12;
}

const GROWTH_LADDER = [1e1, 1e2, 1e3, 1e4, 1e5, 1e6];

/**
 * Does this expression grow without bound as the variable runs off to infinity?
 *
 * Deliberately conservative: it wants a magnitude that never stops climbing and
 * no finite limit to be found, so a function that merely rises towards a ceiling
 * is not mistaken for one that diverges. It only ever decides which *reasoning*
 * to show; the value that comes out the far side is checked numerically anyway.
 */
function growsWithoutBound(l: LimitParts, expr: MathNode): boolean {
  const at = pointValue(l);
  if (Number.isFinite(at)) return false;
  const f = bodyAt(l, expr);
  const sign = at > 0 ? 1 : -1;
  const values = GROWTH_LADDER.map((t) => f(sign * t));

  // Overflowing a double is evidence of growth, not a reason to abstain.
  // e^x passes 1.8e308 somewhere around x = 710, so climbing the ladder to
  // 1e6 always ran it off the top and lim x->inf x/e^x was refused for want
  // of a form, while ln(x)/x — which stays in range — was answered. NaN is
  // the genuinely unreadable case and still gives up.
  let climbed = 0;
  for (const v of values) {
    if (Number.isNaN(v)) return false;
    if (!Number.isFinite(v)) break;
    if (climbed > 0 && Math.abs(v) <= Math.abs(values[climbed - 1]!)) return false;
    climbed++;
  }
  const overflowed = climbed < values.length;
  if (climbed === 0) return false;
  if (!overflowed && Math.abs(values[values.length - 1]!) < 5) return false;
  if (overflowed) return true;
  return !Number.isFinite(limitNumerically(f, at, l.side));
}

export type IndeterminateForm = "0/0" | "inf/inf";

/** Which indeterminate form direct substitution runs into, if any. */
export function indeterminateForm(l: LimitParts): IndeterminateForm | null {
  if (l.body.type !== "div") return null;
  const { num: top, den: bottom } = l.body;
  if (vanishesAt(l, top) && vanishesAt(l, bottom)) return "0/0";
  if (growsWithoutBound(l, top) && growsWithoutBound(l, bottom)) return "inf/inf";
  return null;
}

/** How the form is written on the step card. */
export function formLatex(form: IndeterminateForm): string {
  return form === "0/0" ? "\\frac{0}{0}" : "\\frac{\\infty}{\\infty}";
}

// ------------------------------------------------------------ factor and cancel

/** Is `at` a root of this polynomial? Exact, so it never guesses at a cancellation. */
function vanishesThere(p: Poly, at: Rational): boolean {
  let total = Rational.ZERO;
  for (const [d, c] of p) {
    // Every degree here is a non-negative integer, so the power always exists.
    const power = at.powInt(BigInt(d));
    if (!power) return false;
    total = total.add(c.mul(power));
  }
  return total.isZero();
}

/** Synthetic division of `p` by `(v - at)`, which is exact when `at` is a root. */
function divideByRoot(p: Poly, at: Rational): Poly {
  const top = degree(p);
  const out: Poly = new Map();
  let carry = Rational.ZERO;
  for (let d = top; d >= 1; d--) {
    carry = coeff(p, d).add(carry.mul(at));
    if (!carry.isZero()) out.set(d - 1, carry);
  }
  return out;
}

function polyToNode(p: Poly, v: string): MathNode {
  const degrees = [...p.keys()].sort((a, b) => b - a);
  const terms = degrees.map((d) => {
    const factors =
      d === 0 ? [] : d === 1 ? [sym(v)] : [pow(sym(v), num(Rational.of(d)))];
    return makeTerm(coeff(p, d), factors);
  });
  if (terms.length === 0) return num(Rational.ZERO);
  return terms.length === 1 ? terms[0]! : add(terms);
}

/** `(x - 2)`, or plain `x` when the point is zero. */
function rootFactor(v: string, at: Rational): MathNode {
  return at.isZero() ? sym(v) : add([sym(v), num(at.neg())]);
}

function isOnePoly(p: Poly): boolean {
  return degree(p) === 0 && coeff(p, 0).isOne();
}

/**
 * (x^2 - 4)/(x - 2) -> ((x - 2)(x + 2))/(x - 2).
 *
 * Only the factoring is done here. Cancelling is what CANCEL_FRACTION_FACTORS
 * already does, and it runs first on the next pass, so the working reads as the
 * three separate moves a student makes: factor, cancel, substitute.
 */
export const limitFactorAndCancel = limitRule("LIMIT_FACTOR", (l) => {
  if (l.body.type !== "div") return null;
  const at = evaluateExact(l.point);
  if (!at) return null;
  const top = toPolynomial(l.body.num, l.variable);
  const bottom = toPolynomial(l.body.den, l.variable);
  if (!top || !bottom) return null;
  if (degree(top) < 1 || degree(bottom) < 1) return null;
  if (!vanishesThere(top, at) || !vanishesThere(bottom, at)) return null;

  const topRest = divideByRoot(top, at);
  const bottomRest = divideByRoot(bottom, at);
  const factored = (rest: Poly): MathNode =>
    isOnePoly(rest)
      ? rootFactor(l.variable, at)
      : mul([rootFactor(l.variable, at), polyToNode(rest, l.variable)]);
  const body = div(factored(topRest), factored(bottomRest));
  const node = withLimitBody(l, body);
  return {
    node,
    changes: [{ kind: "replace", fromIds: [l.body.id], toIds: [body.id] }],
    vars: { factor: toLatex(rootFactor(l.variable, at)), variable: l.variable },
  };
});

// ------------------------------------------------------------- at infinity

/**
 * A rational function at infinity is decided by its degrees: the bottom wins and
 * the limit is zero, or the two tie and the leading coefficients decide it.
 * A numerator of higher degree runs away, which is not a value to report, so
 * nothing is returned and the solver declines.
 */
export const limitAtInfinity = limitRule("LIMIT_AT_INFINITY", (l): RuleResult | null => {
  if (!isInfinity(l.point) || l.body.type !== "div") return null;
  const top = toPolynomial(l.body.num, l.variable);
  const bottom = toPolynomial(l.body.den, l.variable);
  if (!top || !bottom) return null;
  const dTop = degree(top);
  const dBottom = degree(bottom);
  if (dTop < 0 || dBottom < 1) return null;
  if (dTop > dBottom) return null;

  const value =
    dTop < dBottom ? Rational.ZERO : coeff(top, dTop).div(coeff(bottom, dBottom));
  const node = num(value);
  return {
    node,
    changes: [{ kind: "replace", fromIds: [l.node.id], toIds: [node.id] }],
    vars: {
      top: String(dTop),
      bottom: String(dBottom),
      variable: l.variable,
      result: value.toLatex(),
    },
    ...(dTop === dBottom ? { explanationKey: "LIMIT_AT_INFINITY_RATIO" } : {}),
  };
});

/**
 * A bounded top over a bottom that runs away is zero.
 *
 * The degree comparison above only reads rational functions, so it had nothing
 * to say about 1/e^x — which is exactly what l'Hopital leaves behind when it
 * is used on x/e^x, so that limit was worked most of the way out and then
 * refused on the last step.
 */
export const limitBoundedOverUnbounded = limitRule(
  "LIMIT_BOUNDED_OVER_UNBOUNDED",
  (l): RuleResult | null => {
    if (l.body.type !== "div") return null;
    if (!growsWithoutBound(l, l.body.den)) return null;

    // The top must settle somewhere finite. A top that also runs away is an
    // indeterminate form for l'Hopital, and one that oscillates for ever, as
    // sin x does, is not something to answer by claiming a value.
    const top = limitNumerically(bodyAt(l, l.body.num), pointValue(l), l.side);
    if (!Number.isFinite(top)) return null;

    const node = num(Rational.ZERO);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [l.node.id], toIds: [node.id] }],
      vars: { bottom: toLatex(l.body.den), variable: l.variable },
    };
  },
);

/**
 * A term inside a sum that dies away to nothing becomes nothing.
 *
 * lim b->inf (1 - e^-b) is 1, but nothing here could say so: substitution
 * cannot put infinity in, the degree comparison only reads fractions, and
 * l'Hopital needs a quotient. Zeroing the vanishing term leaves 1 - 0, which
 * every remaining rule handles, and it is how the step is read aloud anyway.
 *
 * Only ever fires on one term of a sum, never on the whole body, so it cannot
 * answer a limit by asserting the thing being asked.
 */
/** Does this expression involve the variable at all? */
function dependsOn(n: MathNode, v: string): boolean {
  return symbols(n).has(v);
}

export const limitVanishingTerm = limitRule(
  "LIMIT_VANISHING_TERM",
  (l): RuleResult | null => {
    if (l.body.type !== "add" || l.body.args.length < 2) return null;
    const at = pointValue(l);
    if (Number.isFinite(at)) return null;

    const terms = l.body.args;
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]!;
      if (!dependsOn(term, l.variable)) continue;
      if (isZero(term)) continue;
      const value = limitNumerically(bodyAt(l, term), at, l.side);
      if (!Number.isFinite(value) || Math.abs(value) > 1e-9) continue;

      // Something else has to survive, or this is the whole answer and the
      // rule would be asserting it rather than reasoning to it.
      const survives = terms.some((other, j) => j !== i && !isZero(other));
      if (!survives) continue;

      const zero = num(Rational.ZERO);
      const rebuilt = add(terms.map((t, j) => (j === i ? zero : t)), l.body.id);
      const node = withLimitBody(l, rebuilt);
      return {
        node,
        changes: [{ kind: "replace", fromIds: [term.id], toIds: [zero.id] }],
        vars: { term: toLatex(term), variable: l.variable, point: toLatex(l.point) },
      };
    }
    return null;
  },
);


// ---------------------------------------------------------------- l'Hopital

/**
 * Differentiate the top and the bottom separately and try again.
 *
 * The derivatives are left unevaluated so the derivative rules take them one
 * step at a time on the following passes, which is what makes the working show
 * *which* derivative was taken rather than jumping to a new fraction.
 *
 * The budget in the rule context is what stops a limit that never resolves from
 * differentiating forever. It is spent when the rule fires, and the engine only
 * reaches this rule when nothing earlier applied, so at worst a little of it goes
 * on a rewrite the engine then rejects — which ends in an honest refusal rather
 * than a loop.
 */
export const limitLHopital = limitRule("LIMIT_LHOPITAL", (l, ctx) => {
  if (l.body.type !== "div") return null;
  const form = indeterminateForm(l);
  if (!form) return null;
  const budget = ctx.lhopital;
  if (budget) {
    if (budget.used >= budget.max) return null;
    budget.used++;
  }
  const v = () => sym(l.variable);
  const body = div(diff(l.body.num, v()), diff(l.body.den, v()));
  const node = withLimitBody(l, body);
  return {
    node,
    changes: [{ kind: "replace", fromIds: [l.body.id], toIds: [body.id] }],
    vars: {
      form: formLatex(form),
      variable: l.variable,
      top: toLatex(l.body.num),
      bottom: toLatex(l.body.den),
    },
  };
});

/**
 * Substitution first, then the escapes from an indeterminate form, then the
 * degree comparison, and l'Hopital last: it is the heaviest tool and the one
 * that hides the most reasoning, so anything else that can answer the question
 * should have answered it already.
 */
export const limitTransformRules: Rule[] = [
  limitSubstitute,
  limitFactorAndCancel,
  limitAtInfinity,
  limitBoundedOverUnbounded,
  limitVanishingTerm,
  limitLHopital,
];
