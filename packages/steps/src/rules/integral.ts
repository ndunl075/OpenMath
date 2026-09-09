import {
  add, asIntegral, children, cloneFresh, containsDiff, containsIntegral, countNodes, diff,
  div, fn, integral, type IntegralParts, isOne, isZero, key, makeTerm, type MathNode,
  mul, neg, num, pow, Rational, substitute, sym, symbols, toLatex, walk, withChildren,
} from "@openmath/math-core";
import { run } from "../engine.js";
import {
  coeff, degree, divideByRoot, divmodPoly, factorOverRationals, type LinearFactorisation,
  mulPoly, type Poly, polyToNode, toPolynomial,
} from "../poly.js";
import type { Rule, RuleResult } from "../types.js";
import { verifyAntiderivative } from "../verify.js";
import { arithmeticRules } from "./arithmetic.js";
import { collectRules } from "./collect.js";
import { derivativeRules } from "./derivative.js";
import { distribute, distributeNegative } from "./distribute.js";
import {
  cancelFractionFactors, divideByFraction, multiplyFractions,
  reduceFractionByCommonFactor,
} from "./fractions.js";
import { identityRules } from "./identities.js";

/**
 * Integration, one rewrite at a time.
 *
 * Differentiation is a finite rule set that always terminates. Integration is a
 * search: u-substitution has to guess the substitution, integration by parts has
 * to choose u and dv, and no complete algorithm produces pedagogical steps. What
 * makes an aggressive search safe here is that the answer is checkable — the
 * candidate is differentiated and compared with the integrand, and one that does
 * not match is thrown away rather than shown to a student. Every rule below that
 * guesses runs that check itself before returning, and the solver runs it again
 * on the finished answer.
 *
 * The order is the order a student writes the working: split the integral apart
 * first, then read the standard forms off the table, then reach for a technique.
 */

/** Does this sub-expression change when `v` changes? */
function dependsOn(n: MathNode, v: string): boolean {
  return symbols(n).has(v);
}

/**
 * An integral rule: matches only indefinite `\int ... dv` nodes and is handed
 * the pieces. A definite integral never reaches the rules — the solver finds its
 * antiderivative with these and evaluates it at the limits itself — so the guard
 * also keeps a limit from being quietly dropped.
 */
function integralRule(
  id: string,
  apply: (parts: IntegralParts) => RuleResult | null,
): Rule {
  return {
    id,
    apply(n) {
      const parts = asIntegral(n);
      if (!parts || parts.bounds) return null;
      return apply(parts);
    },
  };
}

// -------------------------------------------------------------- taking it apart

/** ∫(f + g) dx -> ∫f dx + ∫g dx, keeping the sign on a subtracted term. */
export const intSum = integralRule("INT_SUM", ({ body, variable: v, node }) => {
  if (body.type !== "add") return null;
  const terms = body.args.map((a) =>
    a.type === "neg" ? neg(integral(a.arg, sym(v)), a.id) : integral(a, sym(v)),
  );
  const result = add(terms, body.id);
  const created = terms.map((t) => (t.type === "neg" ? t.arg.id : t.id));
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: created }],
    vars: { count: String(terms.length), variable: v },
  };
});

/** ∫(-f) dx -> -∫f dx */
export const intNegative = integralRule("INT_NEGATIVE", ({ body, variable: v, node }) => {
  if (body.type !== "neg") return null;
  return {
    node: neg(integral(body.arg, sym(v)), body.id),
    changes: [{ kind: "move", fromIds: [body.id], toIds: [body.id] }],
    vars: { variable: v },
  };
});

/** ∫5f dx -> 5∫f dx, and ∫(f/5) dx -> (∫f dx)/5. */
export const intConstantMultiple = integralRule(
  "INT_CONSTANT_MULTIPLE",
  ({ body, variable: v, node }) => {
    if (body.type === "mul") {
      const constants = body.args.filter((a) => !dependsOn(a, v));
      const rest = body.args.filter((a) => dependsOn(a, v));
      if (constants.length === 0 || rest.length === 0) return null;
      const inner = integral(rest.length === 1 ? rest[0]! : mul(rest), sym(v));
      return {
        node: mul([...constants, inner], body.id),
        changes: [
          { kind: "move", fromIds: constants.map((c) => c.id), toIds: constants.map((c) => c.id) },
        ],
        vars: { constant: constants.map((c) => toLatex(c)).join(" \\cdot "), variable: v },
      };
    }
    if (body.type === "div" && !dependsOn(body.den, v) && dependsOn(body.num, v)) {
      return {
        node: div(integral(body.num, sym(v)), body.den, body.id),
        changes: [{ kind: "move", fromIds: [body.den.id], toIds: [body.den.id] }],
        vars: { constant: toLatex(body.den), variable: v },
        explanationKey: "INT_CONSTANT_DENOMINATOR",
      };
    }
    // 2/(x+1) is 2 times 1/(x+1). Splitting it here is what a student writes,
    // and it is also what leaves the standard 1/u form for the next rule.
    if (
      body.type === "div" && !dependsOn(body.num, v) && !isOne(body.num) &&
      dependsOn(body.den, v)
    ) {
      const inner = integral(div(num(Rational.ONE), body.den), sym(v));
      return {
        node: mul([body.num, inner], body.id),
        changes: [{ kind: "move", fromIds: [body.num.id], toIds: [body.num.id] }],
        vars: { constant: toLatex(body.num), variable: v },
      };
    }
    return null;
  },
);

// -------------------------------------------------------------------- the table

/** x, or x^e when the exponent is anything else. */
function powerNode(v: string, e: Rational): MathNode {
  return e.isOne() ? sym(v) : pow(sym(v), num(e));
}

/**
 * The exponent when the integrand is a bare power of the variable: x, x^n,
 * 1/x, 1/x^n and √x all reduce to one number, which is the only thing the power
 * rule needs.
 */
function powerOfVariable(body: MathNode, v: string): Rational | null {
  const isVar = (n: MathNode): boolean => n.type === "sym" && n.name === v;
  if (isVar(body)) return Rational.ONE;
  if (body.type === "pow" && isVar(body.base) && body.exp.type === "num") return body.exp.value;
  if (body.type === "fn" && body.name === "sqrt" && body.args.length === 1 && isVar(body.args[0]!)) {
    return Rational.of(1n, 2n);
  }
  if (body.type === "div" && isOne(body.num)) {
    const { den } = body;
    if (isVar(den)) return Rational.NEG_ONE;
    if (den.type === "pow" && isVar(den.base) && den.exp.type === "num") {
      return den.exp.value.neg();
    }
    if (den.type === "fn" && den.name === "sqrt" && den.args.length === 1 && isVar(den.args[0]!)) {
      return Rational.of(-1n, 2n);
    }
  }
  return null;
}

/** ∫c dx -> cx */
export const intConstant = integralRule("INT_CONSTANT", ({ body, variable: v, node }) => {
  if (dependsOn(body, v)) return null;
  const variable = sym(v);
  const result = isOne(body) ? variable : mul([body, variable]);
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
    vars: { constant: toLatex(body), variable: v },
  };
});

/** ∫x^n dx -> x^(n+1)/(n+1), for every n except -1. */
export const intPower = integralRule("INT_POWER", ({ body, variable: v, node }) => {
  const exponent = powerOfVariable(body, v);
  if (exponent === null || exponent.equals(Rational.NEG_ONE)) return null;
  const raised = exponent.add(Rational.ONE);

  // A negative new exponent reads better back under a fraction bar: the
  // antiderivative of x^-3 is -1/(2x^2), not -1/2 x^-2.
  const result = raised.isNegative()
    ? neg(div(num(Rational.ONE), makeTerm(raised.neg(), [powerNode(v, raised.neg())])))
    : raised.isInteger()
      ? div(powerNode(v, raised), num(raised))
      : makeTerm(Rational.ONE.div(raised), [powerNode(v, raised)]);

  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
    vars: { exponent: exponent.toLatex(), raised: raised.toLatex(), variable: v },
  };
});

/** ∫(1/x) dx -> ln|x|. The one exponent the power rule cannot take. */
export const intReciprocal = integralRule("INT_RECIPROCAL", ({ body, variable: v, node }) => {
  const exponent = powerOfVariable(body, v);
  if (exponent === null || !exponent.equals(Rational.NEG_ONE)) return null;
  const result = fn("ln", [fn("abs", [sym(v)])]);
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
    vars: { variable: v },
  };
});

/** ∫e^x dx -> e^x, and ∫exp(x) dx -> exp(x). */
export const intExponentialE = integralRule("INT_EXPONENTIAL_E", ({ body, variable: v, node }) => {
  const isE =
    body.type === "pow" && body.base.type === "sym" && body.base.name === "e" &&
    body.exp.type === "sym" && body.exp.name === v;
  const isExp =
    body.type === "fn" && body.name === "exp" && body.args.length === 1 &&
    body.args[0]!.type === "sym" && (body.args[0] as { name: string }).name === v;
  if (!isE && !isExp) return null;
  return {
    node: body,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [body.id] }],
    vars: { variable: v },
  };
});

/** ∫a^x dx -> a^x / ln(a) */
export const intExponential = integralRule("INT_EXPONENTIAL", ({ body, variable: v, node }) => {
  if (body.type !== "pow") return null;
  const { base, exp } = body;
  if (dependsOn(base, v)) return null;
  if (exp.type !== "sym" || exp.name !== v) return null;
  if (base.type === "sym" && base.name === "e") return null;
  const result = div(body, fn("ln", [cloneFresh(base)]));
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
    vars: { base: toLatex(base), variable: v },
  };
});

/** Is this polynomial exactly the one described, e.g. `1 + x^2`? */
function polynomialIs(n: MathNode, v: string, wanted: Array<[number, number]>): boolean {
  const p = toPolynomial(n, v);
  if (!p) return false;
  const want = new Map(wanted.map(([d, c]) => [d, Rational.of(c)]));
  for (const [d, c] of want) if (!coeff(p, d).equals(c)) return false;
  for (const [d, c] of p) if (!c.isZero() && !want.has(d)) return false;
  return true;
}

/** The standard forms whose antiderivative is a single named function. */
function tableRule(
  id: string,
  matches: (body: MathNode, v: string) => boolean,
  result: (v: string) => MathNode,
): Rule {
  return integralRule(id, ({ body, variable: v, node }) => {
    if (!matches(body, v)) return null;
    const out = result(v);
    return {
      node: out,
      changes: [{ kind: "replace", fromIds: [node.id], toIds: [out.id] }],
      vars: { variable: v },
    };
  });
}

const isCall = (n: MathNode, name: string, v: string): boolean =>
  n.type === "fn" && n.name === name && n.args.length === 1 &&
  n.args[0]!.type === "sym" && (n.args[0] as { name: string }).name === v;

export const intSin = tableRule(
  "INT_SIN",
  (body, v) => isCall(body, "sin", v),
  (v) => neg(fn("cos", [sym(v)])),
);

export const intCos = tableRule(
  "INT_COS",
  (body, v) => isCall(body, "cos", v),
  (v) => fn("sin", [sym(v)]),
);

/**
 * `f(v)^k`, also reading the reciprocal form: 1/sin(t)^2 is csc(t)^2.
 *
 * Trig substitution produces the reciprocal shape constantly — dividing by
 * sin^2 t is what int 1/(x^2 sqrt(1-x^2)) dx turns into — and matching only
 * the named function would decline it for the sake of how it is written.
 */
function isTrigPower(body: MathNode, name: string, power: number, v: string): boolean {
  const co = { sin: "csc", csc: "sin", cos: "sec", sec: "cos", tan: "cot", cot: "tan" }[name];
  const wanted = Rational.of(power);
  if (
    body.type === "pow" && body.exp.type === "num" &&
    body.exp.value.equals(wanted) && isCall(body.base, name, v)
  ) return true;
  if (!co) return false;
  if (body.type !== "div" || !isOne(body.num)) return false;
  const den = body.den;
  return den.type === "pow" && den.exp.type === "num" &&
    den.exp.value.equals(wanted) && isCall(den.base, co, v);
}

export const intSecSquared = tableRule(
  "INT_SEC_SQUARED",
  (body, v) => isTrigPower(body, "sec", 2, v),
  (v) => fn("tan", [sym(v)]),
);

export const intCscSquared = tableRule(
  "INT_CSC_SQUARED",
  (body, v) => isTrigPower(body, "csc", 2, v),
  (v) => neg(fn("cot", [sym(v)])),
);

/**
 * int sec^3 = (sec tan + ln|sec + tan|)/2, and the cosecant mirror.
 *
 * The odd one out among the trig integrals: parts on sec^3 produces sec^3
 * again, so it is solved for rather than integrated, the same trick as
 * INT_CYCLIC_BY_PARTS. Worth having as an entry because the tangent
 * substitution lands on it constantly — int sqrt(x^2+1) dx is exactly
 * int sec^3 t dt in disguise.
 */
export const intSecCubed = tableRule(
  "INT_SEC_CUBED",
  (body, v) => isTrigPower(body, "sec", 3, v),
  (v) => div(
    add([
      mul([fn("sec", [sym(v)]), fn("tan", [sym(v)])]),
      fn("ln", [fn("abs", [add([fn("sec", [sym(v)]), fn("tan", [sym(v)])])])]),
    ]),
    num(Rational.of(2)),
  ),
);

export const intCscCubed = tableRule(
  "INT_CSC_CUBED",
  (body, v) => isTrigPower(body, "csc", 3, v),
  (v) => div(
    add([
      neg(mul([fn("csc", [sym(v)]), fn("cot", [sym(v)])])),
      fn("ln", [fn("abs", [add([fn("csc", [sym(v)]), neg(fn("cot", [sym(v)]))])])]),
    ]),
    num(Rational.of(2)),
  ),
);

export const intArctan = tableRule(
  "INT_ARCTAN",
  (body, v) =>
    body.type === "div" && isOne(body.num) && polynomialIs(body.den, v, [[0, 1], [2, 1]]),
  (v) => fn("arctan", [sym(v)]),
);

export const intArcsin = tableRule(
  "INT_ARCSIN",
  (body, v) =>
    body.type === "div" && isOne(body.num) &&
    body.den.type === "fn" && body.den.name === "sqrt" && body.den.args.length === 1 &&
    polynomialIs(body.den.args[0]!, v, [[0, 1], [2, -1]]),
  (v) => fn("arcsin", [sym(v)]),
);

// ------------------------------------------------------------- the trig family

/** The argument of a trig call, when the call is of the given function. */
function trigArg(n: MathNode, name: string): MathNode | null {
  if (n.type !== "fn" || n.name !== name || n.args.length !== 1) return null;
  return n.args[0]!;
}

/** `f(u)^k` for a named trig function, returning the argument and the power. */
function trigPower(n: MathNode, name: string): { arg: MathNode; power: number } | null {
  if (n.type === "pow" && n.exp.type === "num" && n.exp.value.isInteger()) {
    const arg = trigArg(n.base, name);
    if (arg) return { arg, power: Number(n.exp.value.toNumber()) };
    return null;
  }
  const arg = trigArg(n, name);
  return arg ? { arg, power: 1 } : null;
}

export const intTan = tableRule(
  "INT_TAN",
  (body, v) => isCall(body, "tan", v),
  (v) => neg(fn("ln", [fn("abs", [fn("cos", [sym(v)])])])),
);

/**
 * A square root inside a product or sum becomes a half power.
 *
 * The power rule reads `pow` nodes and sqrt is a function node, so
 * int (u-1)sqrt(u) du was declined while the identical
 * int (u-1)u^(1/2) du was integrated term by term. Only fires where the root
 * is mixed in with something else: a bare int sqrt(x) dx is already handled,
 * and rewriting it would replace a step that reads well with one that does
 * not.
 */
export const intSqrtAsPower = integralRule(
  "INT_SQRT_AS_POWER",
  ({ body, variable: v, node }) => {
    if (body.type !== "mul" && body.type !== "add" && body.type !== "div") return null;
    let found: MathNode | null = null;
    walk(body, (n) => {
      if (found) return;
      if (n.type !== "fn" || n.name !== "sqrt" || n.args.length !== 1) return;
      if (!dependsOn(n, v)) return;
      // Only a root of something linear. A root of a quadratic is trig
      // substitution's, and flattening it to a half power here would take the
      // sqrt node that rule looks for out from under it.
      const p = toPolynomial(n.args[0]!, v);
      if (!p || degree(p) !== 1) return;
      found = n;
    });
    if (!found) return null;
    const root = found as MathNode & { type: "fn" };
    const half = pow(cloneFresh(root.args[0]!), num(Rational.of(1, 2)), root.id);
    const rebuilt = replaceSubtree(body, key(root), () => half);
    const out = integral(rebuilt, sym(v));
    return {
      node: out,
      changes: [{ kind: "replace", fromIds: [root.id], toIds: [half.id] }],
      vars: { variable: v, root: toLatex(root), power: toLatex(half) },
    };
  },
);

export const intSec = tableRule(
  "INT_SEC",
  (body, v) => isCall(body, "sec", v),
  (v) => fn("ln", [fn("abs", [add([fn("sec", [sym(v)]), fn("tan", [sym(v)])])])]),
);

export const intCsc = tableRule(
  "INT_CSC",
  (body, v) => isCall(body, "csc", v),
  (v) => neg(fn("ln", [fn("abs", [add([fn("csc", [sym(v)]), fn("cot", [sym(v)])])])])),
);

export const intCot = tableRule(
  "INT_COT",
  (body, v) => isCall(body, "cot", v),
  (v) => fn("ln", [fn("abs", [fn("sin", [sym(v)])])]),
);

/**
 * sin^2 u -> (1 - cos 2u)/2, and cos^2 u -> (1 + cos 2u)/2.
 *
 * A rewrite rather than a table entry, because the identity *is* the lesson.
 * Once the square is gone the existing sum, constant-multiple and cosine rules
 * finish the job on their own, and the working reads the way it is taught.
 */
function powerReduction(id: string, name: "sin" | "cos"): Rule {
  return integralRule(id, ({ body, variable: v, node }) => {
    const found = trigPower(body, name);
    if (!found || found.power !== 2) return null;
    const doubled = mul([num(Rational.of(2)), cloneFresh(found.arg)]);
    const cos2u = fn("cos", [doubled]);
    const inner = name === "sin"
      ? add([num(Rational.ONE), neg(cos2u)])
      : add([num(Rational.ONE), cos2u]);
    const out = integral(div(inner, num(Rational.of(2))), sym(v));
    return {
      node: out,
      changes: [{ kind: "replace", fromIds: [node.id], toIds: [out.id] }],
      vars: { variable: v, argument: toLatex(found.arg) },
    };
  });
}

export const intSinSquared = powerReduction("INT_SIN_SQUARED", "sin");
export const intCosSquared = powerReduction("INT_COS_SQUARED", "cos");

/**
 * An odd power of sine or cosine: peel one factor off and turn the rest into
 * the other function, which leaves something u-substitution can take.
 *
 *   sin^3 u -> sin u (1 - cos^2 u)
 *   cos^5 u -> cos u (1 - sin^2 u)^2
 *
 * Only fires on an odd power of three or more; the power-reduction rules above
 * own the even ones, and a bare first power is already in the table.
 */
function oddPower(id: string, name: "sin" | "cos"): Rule {
  const other = name === "sin" ? "cos" : "sin";
  return integralRule(id, ({ body, variable: v, node }) => {
    const found = trigPower(body, name);
    if (!found || found.power < 3 || found.power % 2 === 0) return null;
    const half = (found.power - 1) / 2;
    const pythag = add([
      num(Rational.ONE),
      neg(pow(fn(other, [cloneFresh(found.arg)]), num(Rational.of(2)))),
    ]);
    const rest = half === 1 ? pythag : pow(pythag, num(Rational.of(half)));
    const out = integral(mul([fn(name, [cloneFresh(found.arg)]), rest]), sym(v));
    return {
      node: out,
      changes: [{ kind: "replace", fromIds: [node.id], toIds: [out.id] }],
      vars: { variable: v, power: String(found.power), other },
    };
  });
}

export const intSinOdd = oddPower("INT_SIN_ODD", "sin");
export const intCosOdd = oddPower("INT_COS_ODD", "cos");

/**
 * 1/(x^2 + a^2) -> (1/a) arctan(x/a), and 1/sqrt(a^2 - x^2) -> arcsin(x/a).
 *
 * The table entries above only match a = 1, so the integral of 1/(x^2+4) was
 * refused while 1/(x^2+1) was answered.
 */
export const intArctanScaled = integralRule(
  "INT_ARCTAN_SCALED",
  ({ body, variable: v, node }) => {
    if (body.type !== "div" || !isOne(body.num)) return null;
    const p = toPolynomial(body.den, v);
    if (!p || degree(p) !== 2) return null;
    if (!coeff(p, 2).equals(Rational.ONE)) return null;
    const b = coeff(p, 1);
    const c = coeff(p, 0);

    // Completing the square turns x^2 + bx + c into (x + b/2)^2 + k. A
    // positive k means no real roots, so the quadratic never vanishes and
    // this is an inverse tangent; a negative one is partial fractions' job.
    const half = b.div(Rational.of(2));
    const k = c.sub(half.mul(half));
    if (k.isNegative() || k.isZero()) return null;
    if (b.isZero() && k.equals(Rational.ONE)) return null; // plain arctan's

    const a = k.nthRoot(2n);
    if (!a) return null;

    const shifted = b.isZero() ? sym(v) : add([sym(v), num(half)]);
    const out = mul([
      div(num(Rational.ONE), num(a)),
      fn("arctan", [div(shifted, num(a))]),
    ]);
    return {
      node: out,
      changes: [{ kind: "replace", fromIds: [node.id], toIds: [out.id] }],
      vars: {
        variable: v,
        a: a.toLatex(),
        shift: half.toLatex(),
        square: toLatex(shifted),
      },
      ...(b.isZero() ? {} : { explanationKey: "INT_COMPLETE_THE_SQUARE" }),
    };
  },
);

// ------------------------------------------------------------ running the rules

/**
 * The algebra that tidies up between integration steps.
 *
 * ADD_FRACTIONS is deliberately left out. An antiderivative is a sum of terms,
 * one per term of the integrand, and putting x^3/3 + 3x^2/2 over a common
 * denominator hides which term came from where for no gain in tidiness.
 *
 * Composed here rather than imported from ./index.js, which imports this file:
 * the techniques below need a rule list while their own module is still being
 * initialised, and a cycle through the barrel would hand them undefined.
 */
const tidyRules: Rule[] = [
  ...identityRules, ...arithmeticRules, ...collectRules,
  divideByFraction, cancelFractionFactors, reduceFractionByCommonFactor, multiplyFractions,
  distributeNegative, distribute,
];

const derivativeEngine: Rule[] = [...derivativeRules, ...tidyRules];

/** How far a technique may call back into the engine before the search stops. */
const MAX_NESTING = 3;
let nesting = 0;

/** d/dv(expr) worked out in full, or null when the derivative engine cannot. */
function derivativeOf(expr: MathNode, v: string): MathNode | null {
  const result = run(
    diff(cloneFresh(expr), sym(v)), derivativeEngine, { variable: v },
    { verify: false, maxSteps: 40 },
  );
  return containsDiff(result.node) ? null : result.node;
}

/**
 * An antiderivative of `body`, or null.
 *
 * Nothing comes out of here that has not been differentiated back and matched
 * against `body`, which is what lets the techniques above try a guess and drop
 * it without a wrong step ever reaching a step card.
 */
function antiderivativeOf(body: MathNode, v: string): MathNode | null {
  if (nesting >= MAX_NESTING) return null;
  nesting++;
  try {
    const result = run(
      integral(cloneFresh(body), sym(v)), integrationRules, { variable: v },
      { verify: false, maxSteps: 40 },
    );
    if (containsIntegral(result.node) || containsDiff(result.node)) return null;
    return verifyAntiderivative(result.node, body, v) === "ok" ? result.node : null;
  } finally {
    nesting--;
  }
}

// ------------------------------------------------------------- u-substitution

/** A product written as a rational coefficient over two lists of factors. */
interface Factored {
  coefficient: Rational;
  top: MathNode[];
  bottom: MathNode[];
}

function factorise(n: MathNode): Factored {
  switch (n.type) {
    case "num":
      return { coefficient: n.value, top: [], bottom: [] };
    case "neg": {
      const inner = factorise(n.arg);
      return { ...inner, coefficient: inner.coefficient.neg() };
    }
    case "mul": {
      let coefficient = Rational.ONE;
      const top: MathNode[] = [];
      const bottom: MathNode[] = [];
      for (const a of n.args) {
        const f = factorise(a);
        coefficient = coefficient.mul(f.coefficient);
        top.push(...f.top);
        bottom.push(...f.bottom);
      }
      return { coefficient, top, bottom };
    }
    case "div": {
      const a = factorise(n.num);
      const b = factorise(n.den);
      if (b.coefficient.isZero()) return { coefficient: Rational.ONE, top: [n], bottom: [] };
      return {
        coefficient: a.coefficient.div(b.coefficient),
        top: [...a.top, ...b.bottom],
        bottom: [...a.bottom, ...b.top],
      };
    }
    default:
      return { coefficient: Rational.ONE, top: [n], bottom: [] };
  }
}

/** a / b, cancelling the factors the two have in common. */
function divideFactored(a: Factored, b: Factored): Factored | null {
  if (b.coefficient.isZero()) return null;
  const top = [...a.top, ...b.bottom];
  const bottom = [...a.bottom, ...b.top];
  for (let i = top.length - 1; i >= 0; i--) {
    const match = bottom.findIndex((d) => key(d) === key(top[i]!));
    if (match >= 0) {
      top.splice(i, 1);
      bottom.splice(match, 1);
    }
  }
  return { coefficient: a.coefficient.div(b.coefficient), top, bottom };
}

/**
 * The coefficient stays out in front rather than going under the fraction bar:
 * `\frac{1}{2} \cdot \frac{1}{u}` is something the constant-multiple rule can
 * take apart, and `\frac{1}{2u}` is not.
 */
function rebuild(f: Factored): MathNode {
  const top = f.top.map(cloneFresh);
  const bottom = f.bottom.map(cloneFresh);
  const gather = (parts: MathNode[]): MathNode =>
    parts.length === 0 ? num(Rational.ONE) : parts.length === 1 ? parts[0]! : mul(parts);
  const core = bottom.length === 0 ? gather(top) : div(gather(top), gather(bottom));
  return makeTerm(f.coefficient, [core]);
}

/**
 * Every occurrence of one sub-expression swapped for something else, matched by
 * canonical key so `x^2 + 1` and `1 + x^2` are the same sub-expression. It is
 * what turns the integrand into a function of u and the answer back into a
 * function of x.
 */
function replaceSubtree(n: MathNode, target: string, make: () => MathNode): MathNode {
  if (key(n) === target) return make();
  const kids = children(n);
  if (kids.length === 0) return n;
  return withChildren(n, kids.map((k) => replaceSubtree(k, target, make)));
}

/**
 * Where a substitution might be hiding: what a function is applied to, what is
 * being raised to a power, what sits under a fraction bar, and then everything
 * else. Simplest first, because the tidiest answer usually comes from the
 * smallest u — and because every candidate costs a derivative.
 */
function substitutionCandidates(body: MathNode, v: string): MathNode[] {
  const preferred: MathNode[] = [];
  const others: MathNode[] = [];
  const seen = new Set<string>();
  const push = (into: MathNode[], n: MathNode): void => {
    if (!dependsOn(n, v) || n.type === "sym" || n.type === "num") return;
    const k = key(n);
    if (seen.has(k)) return;
    seen.add(k);
    into.push(n);
  };
  walk(body, (n) => {
    if (n.type === "fn") for (const a of n.args) push(preferred, a);
    else if (n.type === "pow") {
      push(preferred, n.base);
      push(preferred, n.exp);
    } else if (n.type === "div") {
      push(preferred, n.den);
      push(preferred, n.num);
    }
  });
  walk(body, (n) => push(others, n));
  const bySize = (a: MathNode, b: MathNode): number => countNodes(a) - countNodes(b);
  return [...preferred.sort(bySize), ...others.sort(bySize)].slice(0, 8);
}

/**
 * The integrand rewritten in u, or null when it does not come out free of x.
 *
 * f(x) dx becomes h(u) du exactly when f divided by du/dx is a function of u
 * alone, so that division is the whole test. It is tried structurally first,
 * cancelling matching factors, and then again through the simplifier, because
 * the two get different fractions to cancel.
 */
function integrandInU(
  body: MathNode,
  candidate: MathNode,
  rate: MathNode,
  v: string,
  placeholder: string,
): MathNode | null {
  const target = key(candidate);
  const attempts: MathNode[] = [];
  const divided = divideFactored(factorise(body), factorise(rate));
  if (divided) attempts.push(rebuild(divided));
  attempts.push(
    run(div(cloneFresh(body), cloneFresh(rate)), tidyRules, {}, {
      verify: false, maxSteps: 30,
    }).node,
  );
  for (const attempt of attempts) {
    const substituted = replaceSubtree(attempt, target, () => sym(placeholder));
    if (!dependsOn(substituted, v)) return substituted;
    // Something of the original variable is left over. When the substitution
    // is linear it can be inverted and put in: for int x*sqrt(x+1) dx with
    // u = x+1, the stray x becomes u-1 and the integrand turns into
    // (u-1)*sqrt(u), which is a polynomial in u. Without this the whole
    // problem was declined for the sake of one leftover x.
    if (!appearsWrapped(body, candidate)) continue;
    const inverted = invertLinear(candidate, v, placeholder);
    if (!inverted) continue;
    const rewritten = run(
      substitute(substituted, v, inverted), tidyRules, {},
      { verify: false, maxSteps: 30 },
    ).node;
    if (!dependsOn(rewritten, v)) return rewritten;
  }
  return null;
}

/**
 * Does the candidate sit inside something — a root, an exponential, a bracket
 * raised to a power — rather than standing on its own?
 *
 * Substituting only earns its place when it unwraps something. Without this
 * check, inverting a linear substitution lets *any* linear part of the
 * integrand absorb the whole problem: int (5x-3)/(x^2-2x-3) dx took u = 5x-3
 * and came back with 2ln|5x+5| + 3ln|5x-15|, which is right — it differs from
 * 3ln|x-3| + 2ln|x+1| by a constant, and the constant of integration swallows
 * it — but it is not the answer anyone wants, and it walks straight past the
 * partial fractions the question was set to practise.
 */
function appearsWrapped(body: MathNode, candidate: MathNode): boolean {
  const target = key(candidate);
  let wrapped = false;
  walk(body, (n) => {
    if (wrapped) return;
    if (n.type === "fn" && n.args.some((a) => key(a) === target)) wrapped = true;
    else if (n.type === "pow" && key(n.base) === target) wrapped = true;
  });
  return wrapped;
}

/**
 * `u = ax + b` read backwards as `x = (u - b)/a`, or null when the
 * substitution is not linear and so has no single inverse to offer.
 */
function invertLinear(candidate: MathNode, v: string, placeholder: string): MathNode | null {
  const p = toPolynomial(candidate, v);
  if (!p || degree(p) !== 1) return null;
  const a = coeff(p, 1);
  const b = coeff(p, 0);
  if (a.isZero()) return null;
  const shifted = b.isZero() ? sym(placeholder) : add([sym(placeholder), num(b.neg())]);
  return a.equals(Rational.ONE) ? shifted : div(shifted, num(a));
}

/**
 * ∫f(x) dx by substitution.
 *
 * The working a student writes is three lines — pick u, rewrite the integral in
 * u, substitute back — and it is shown as one step because the middle line is an
 * integral in a variable that is not in the problem. The explanation names u,
 * du and the integral in u, so all three lines are readable; the step card shows
 * the antiderivative it lands on, which has been differentiated back first.
 */
export const intSubstitution = integralRule(
  "INT_SUBSTITUTION",
  ({ body, variable: v, node }) => {
    if (nesting >= MAX_NESTING) return null;
    const placeholder = v === "u" ? "w" : "u";
    for (const candidate of substitutionCandidates(body, v)) {
      const rate = derivativeOf(candidate, v);
      if (!rate || isZero(rate)) continue;
      const inner = integrandInU(body, candidate, rate, v, placeholder);
      if (!inner) continue;
      const integrated = antiderivativeOf(inner, placeholder);
      if (!integrated) continue;
      const result = replaceSubtree(integrated, key(sym(placeholder)), () =>
        cloneFresh(candidate),
      );
      if (dependsOn(result, placeholder)) continue;
      if (verifyAntiderivative(result, body, v) !== "ok") continue;
      return {
        node: result,
        changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
        vars: {
          u: toLatex(candidate),
          rate: toLatex(rate),
          inner: toLatex(inner),
          placeholder,
          variable: v,
        },
      };
    }
    return null;
  },
);

/** The slope of a linear expression in v, or null when it is not linear. */
function linearSlope(n: MathNode, v: string): Rational | null {
  const p = toPolynomial(n, v);
  if (!p || degree(p) !== 1) return null;
  const a = coeff(p, 1);
  return a.isZero() ? null : a;
}

/** `e^u` or `exp(u)`, returning the exponent. */
function exponentialArgument(n: MathNode): MathNode | null {
  if (n.type === "fn" && n.name === "exp" && n.args.length === 1) return n.args[0]!;
  if (n.type === "pow" && n.base.type === "sym" && n.base.name === "e") return n.exp;
  return null;
}

/**
 * int e^(ax) sin(bx) dx, where by parts comes back to where it started.
 *
 * This one is not like the others. Parts applied twice does not reduce the
 * integral, it reproduces it: you end up with I = (something) - (b^2/a^2)I,
 * and the way out is algebra, not another round of integration. intByParts
 * refuses a trig or exponential u precisely because that pairing loops, so
 * without this rule the problem was declined outright.
 *
 * The closed form below is what solving for I gives. Differentiating it back
 * confirms it the same way every other antiderivative here is confirmed.
 */
export const intCyclicByParts = integralRule(
  "INT_CYCLIC_BY_PARTS",
  ({ body, variable: v, node }) => {
    if (body.type !== "mul" || body.args.length !== 2) return null;
    const [first, second] = body.args as [MathNode, MathNode];

    let exponential: MathNode | null = null;
    let trig: (MathNode & { type: "fn" }) | null = null;
    for (const [a, b] of [[first, second], [second, first]] as const) {
      if (exponentialArgument(a) === null) continue;
      if (b.type !== "fn" || (b.name !== "sin" && b.name !== "cos")) continue;
      if (b.args.length !== 1) continue;
      exponential = a;
      trig = b as MathNode & { type: "fn" };
      break;
    }
    if (!exponential || !trig) return null;

    const exponent = exponentialArgument(exponential)!;
    const a = linearSlope(exponent, v);
    const b = linearSlope(trig.args[0]!, v);
    if (!a || !b) return null;

    const denominator = a.mul(a).add(b.mul(b));
    if (denominator.isZero()) return null;

    const angle = trig.args[0]!;
    const sine = (): MathNode => fn("sin", [cloneFresh(angle)]);
    const cosine = (): MathNode => fn("cos", [cloneFresh(angle)]);

    // int e^E sin T = e^E (a sin T - b cos T)/(a^2+b^2)
    // int e^E cos T = e^E (a cos T + b sin T)/(a^2+b^2)
    const bracket = trig.name === "sin"
      ? add([makeTerm(a, [sine()]), neg(makeTerm(b, [cosine()]))])
      : add([makeTerm(a, [cosine()]), makeTerm(b, [sine()])]);

    const result = div(mul([cloneFresh(exponential), bracket]), num(denominator));
    return {
      node: result,
      changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
      vars: {
        variable: v,
        integrand: toLatex(body),
        exponential: toLatex(exponential),
        trig: toLatex(trig),
      },
    };
  },
);

// -------------------------------------------------------- integration by parts

type Liate = "log" | "inverse" | "algebraic" | "trig" | "exponential";

/** LIATE order: the earlier a factor's class, the better it works as u. */
const LIATE: Liate[] = ["log", "inverse", "algebraic", "trig", "exponential"];

const TRIG = new Set(["sin", "cos", "tan", "sec", "csc", "cot"]);

function liateClass(n: MathNode, v: string): Liate | null {
  if (!dependsOn(n, v)) return null;
  if (n.type === "fn") {
    if (n.name === "ln" || n.name === "log") return "log";
    if (n.name === "arcsin" || n.name === "arccos" || n.name === "arctan") return "inverse";
    if (TRIG.has(n.name)) return "trig";
    if (n.name === "exp") return "exponential";
    return null;
  }
  if (n.type === "pow") {
    if (!dependsOn(n.base, v)) return "exponential";
    if (dependsOn(n.exp, v)) return null;
    if (toPolynomial(n, v)) return "algebraic";
    return liateClass(n.base, v) === "trig" ? "trig" : null;
  }
  return toPolynomial(n, v) ? "algebraic" : null;
}

/**
 * ∫u dv = uv - ∫v du.
 *
 * Two guards keep this from chasing its own tail. u is only ever a polynomial,
 * a logarithm or an inverse trig function, so differentiating it genuinely
 * simplifies — a polynomial drops a degree and the other two turn algebraic —
 * and a trig or exponential u, the pairing that integrates back to where it
 * started, is refused outright. And the integral left over has to be one the
 * engine can actually finish, checked here before the step is offered, so a
 * by-parts that leads nowhere better is never shown.
 */
export const intByParts = integralRule("INT_BY_PARTS", ({ body, variable: v, node }) => {
  if (nesting >= MAX_NESTING) return null;
  const factors = body.type === "mul" ? body.args : [body];
  if (factors.length > 2) return null;
  if (factors.some((f) => !dependsOn(f, v))) return null;

  const classes = factors.map((f) => liateClass(f, v));
  if (classes.some((c) => c === null)) return null;

  let uPart: MathNode;
  let dvPart: MathNode;
  if (factors.length === 1) {
    // ∫ln(x) dx and ∫arctan(x) dx: dv is dx, and the whole trick is that
    // differentiating the function is easier than integrating it.
    const only = classes[0]!;
    if (only !== "log" && only !== "inverse") return null;
    uPart = factors[0]!;
    dvPart = num(Rational.ONE);
  } else {
    const [first, second] = factors as [MathNode, MathNode];
    const rankA = LIATE.indexOf(classes[0]!);
    const rankB = LIATE.indexOf(classes[1]!);
    // Two polynomials multiply out; that is expanding, not integrating by parts.
    if (rankA === rankB) return null;
    [uPart, dvPart] = rankA < rankB ? [first, second] : [second, first];
  }

  const uClass = liateClass(uPart, v);
  if (uClass === "trig" || uClass === "exponential") return null;

  const antiderivative = antiderivativeOf(dvPart, v);
  if (!antiderivative) return null;
  const rate = derivativeOf(uPart, v);
  if (!rate) return null;

  const remaining = run(
    mul([cloneFresh(antiderivative), cloneFresh(rate)]), tidyRules, {},
    { verify: false, maxSteps: 20 },
  ).node;
  // The integral this leaves has to be an improvement, and the plainest way to
  // be sure is to check that it can be finished at all.
  if (key(remaining) === key(body)) return null;
  if (!antiderivativeOf(remaining, v)) return null;

  const product = mul([uPart, antiderivative]);
  const leftover = neg(integral(remaining, sym(v)));
  const result = add([product, leftover]);
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [product.id, leftover.id] }],
    vars: {
      u: toLatex(uPart),
      dv: toLatex(dvPart),
      v: toLatex(antiderivative),
      du: toLatex(rate),
      variable: v,
    },
  };
});

// ---------------------------------------------------------- rational functions

/** Read the integrand as one polynomial over another. */
function asRationalFunction(body: MathNode, v: string): { top: Poly; bottom: Poly } | null {
  if (body.type !== "div") return null;
  const top = toPolynomial(body.num, v);
  const bottom = toPolynomial(body.den, v);
  if (!top || !bottom || degree(bottom) < 1) return null;
  return { top, bottom };
}

/** ∫(x^2/(x+1)) dx -> ∫(x - 1 + 1/(x+1)) dx: divide before decomposing. */
/**
 * sqrt(4x^2 + 1) -> 2 sqrt(x^2 + 1/4), so trig substitution can take it.
 *
 * The substitution rules want the square term to carry a coefficient of one,
 * and arc length produces the other kind constantly: the length of a parabola
 * is an integral of sqrt(1 + 4x^2). Pulling the constant out front is the step
 * a student writes anyway, and it only fires when the constant comes out
 * rational, so nothing irrational is invented on the way.
 */
export const intFactorRoot = integralRule(
  "INT_FACTOR_ROOT",
  ({ body, variable: v, node }) => {
    let target: MathNode | null = null;
    let scale: Rational | null = null;
    let inner: MathNode | null = null;

    walk(body, (n) => {
      if (target) return;
      if (n.type !== "fn" || n.name !== "sqrt" || n.args.length !== 1) return;
      const p = toPolynomial(n.args[0]!, v);
      if (!p || degree(p) !== 2 || !coeff(p, 1).isZero()) return;
      const square = coeff(p, 2);
      const constant = coeff(p, 0);
      if (constant.isZero()) return;
      // Already in standard form; the substitution rule owns those.
      if (square.equals(Rational.ONE) || square.equals(Rational.ONE.neg())) return;

      const magnitude = square.isNegative() ? square.neg() : square;
      const root = magnitude.nthRoot(2n);
      if (!root) return;
      const sign = square.isNegative() ? Rational.ONE.neg() : Rational.ONE;
      const reduced = constant.div(magnitude);

      target = n;
      scale = root;
      inner = add([
        makeTerm(sign, [pow(sym(v), num(Rational.of(2)))]),
        num(reduced),
      ]);
    });
    if (!target || !scale || !inner) return null;

    const pulled = mul([num(scale), fn("sqrt", [inner])]);
    const rebuilt = replaceSubtree(body, key(target), () => pulled);
    const out = integral(rebuilt, sym(v));
    return {
      node: out,
      changes: [{ kind: "replace", fromIds: [(target as MathNode).id], toIds: [pulled.id] }],
      vars: { variable: v, scale: (scale as Rational).toLatex(), root: toLatex(target) },
    };
  },
);

// -------------------------------------------------------- trig substitution

type TrigSubKind = "sine" | "tangent" | "secant";

interface TrigSubForm {
  kind: TrigSubKind;
  /** The `a` in a^2 - x^2, a^2 + x^2 or x^2 - a^2. */
  a: Rational;
  /** The sqrt node in the integrand that named the form. */
  root: MathNode;
}

/** Read a sqrt of a quadratic as one of the three trig-substitution shapes. */
function trigSubForm(body: MathNode, v: string): TrigSubForm | null {
  let found: TrigSubForm | null = null;
  walk(body, (n) => {
    if (found) return;
    if (n.type !== "fn" || n.name !== "sqrt" || n.args.length !== 1) return;
    const p = toPolynomial(n.args[0]!, v);
    if (!p || degree(p) !== 2 || !coeff(p, 1).isZero()) return;
    const square = coeff(p, 2);
    const constant = coeff(p, 0);
    if (constant.isZero()) return;

    // a^2 - x^2, a^2 + x^2, or x^2 - a^2, with a rational.
    let kind: TrigSubKind;
    let squared: Rational;
    if (square.equals(Rational.ONE.neg()) && !constant.isNegative()) {
      kind = "sine";
      squared = constant;
    } else if (square.equals(Rational.ONE) && !constant.isNegative()) {
      kind = "tangent";
      squared = constant;
    } else if (square.equals(Rational.ONE) && constant.isNegative()) {
      kind = "secant";
      squared = constant.neg();
    } else return;

    const a = squared.nthRoot(2n);
    if (!a) return;
    found = { kind, a, root: n };
  });
  return found;
}

/**
 * x = a sin t, a tan t or a sec t, for an integrand carrying a square root of
 * a quadratic that will not yield to anything simpler.
 *
 * The substitution is applied structurally rather than by substituting and
 * hoping the engine notices: the root *becomes* a cos t (or a sec t, or
 * a tan t) by the Pythagorean identity, which is the whole point of choosing
 * that substitution, and asking the simplifier to rediscover
 * sqrt(a^2 - a^2 sin^2 t) = a cos t would be a much harder problem than the
 * integral.
 *
 * Coming back is the part students find fiddly, and it is done here with the
 * triangle relations. Any slip is caught: the answer is differentiated back
 * against the original integrand before the step is offered, so a wrong
 * back-substitution is declined rather than shown.
 */
export const intTrigSubstitution = integralRule(
  "INT_TRIG_SUBSTITUTION",
  ({ body, variable: v, node }) => {
    if (nesting >= MAX_NESTING) return null;
    const form = trigSubForm(body, v);
    if (!form) return null;

    const t = v === "t" ? "w" : "t";
    const a = num(form.a);
    const angle = (): MathNode => sym(t);
    const call = (name: string): MathNode => fn(name, [angle()]);

    // What x, the root, and dx become under the substitution.
    let xInT: MathNode;
    let rootInT: MathNode;
    let dx: MathNode;
    switch (form.kind) {
      case "sine":
        xInT = mul([cloneFresh(a), call("sin")]);
        rootInT = mul([cloneFresh(a), call("cos")]);
        dx = mul([cloneFresh(a), call("cos")]);
        break;
      case "tangent":
        xInT = mul([cloneFresh(a), call("tan")]);
        rootInT = mul([cloneFresh(a), call("sec")]);
        dx = mul([cloneFresh(a), pow(call("sec"), num(Rational.of(2)))]);
        break;
      case "secant":
        xInT = mul([cloneFresh(a), call("sec")]);
        rootInT = mul([cloneFresh(a), call("tan")]);
        dx = mul([cloneFresh(a), call("sec"), call("tan")]);
        break;
    }

    const withoutRoot = replaceSubtree(body, key(form.root), () => cloneFresh(rootInT));
    const integrand = run(
      mul([substitute(withoutRoot, v, xInT), dx]), tidyRules, {},
      { verify: false, maxSteps: 40 },
    ).node;
    if (dependsOn(integrand, v)) return null;

    const inT = antiderivativeOf(integrand, t);
    if (!inT) return null;

    const back = backFromTrigSub(inT, t, form, v);
    if (!back) return null;
    const result = run(back, tidyRules, {}, { verify: false, maxSteps: 40 }).node;
    if (dependsOn(result, t)) return null;
    if (verifyAntiderivative(result, body, v) !== "ok") return null;

    return {
      node: result,
      changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
      vars: {
        variable: v,
        angle: t,
        substitution: toLatex(xInT),
        root: toLatex(form.root),
        becomes: toLatex(rootInT),
      },
    };
  },
);

/**
 * Undo the substitution, reading each trig function off the right triangle the
 * substitution describes.
 *
 * Double angles are broken up first. Integrating cos^2 t produces sin(2t),
 * which has no direct reading off the triangle, but 2 sin t cos t does.
 */
function backFromTrigSub(
  inT: MathNode,
  t: string,
  form: TrigSubForm,
  v: string,
): MathNode | null {
  const expanded = expandDoubleAngles(inT, t);
  const a = num(form.a);
  const x = (): MathNode => sym(v);
  const root = (): MathNode => cloneFresh(form.root);

  let table: Record<string, MathNode>;
  let inverse: MathNode;
  switch (form.kind) {
    case "sine":
      // x = a sin t: opposite x, hypotenuse a, adjacent sqrt(a^2 - x^2).
      table = {
        sin: div(x(), cloneFresh(a)),
        cos: div(root(), cloneFresh(a)),
        tan: div(x(), root()),
        sec: div(cloneFresh(a), root()),
        cot: div(root(), x()),
        csc: div(cloneFresh(a), x()),
      };
      inverse = fn("arcsin", [div(x(), cloneFresh(a))]);
      break;
    case "tangent":
      // x = a tan t: opposite x, adjacent a, hypotenuse sqrt(a^2 + x^2).
      table = {
        sin: div(x(), root()),
        cos: div(cloneFresh(a), root()),
        tan: div(x(), cloneFresh(a)),
        sec: div(root(), cloneFresh(a)),
        cot: div(cloneFresh(a), x()),
        csc: div(root(), x()),
      };
      inverse = fn("arctan", [div(x(), cloneFresh(a))]);
      break;
    case "secant":
      // x = a sec t: hypotenuse x, adjacent a, opposite sqrt(x^2 - a^2).
      table = {
        sin: div(root(), x()),
        cos: div(cloneFresh(a), x()),
        tan: div(root(), cloneFresh(a)),
        sec: div(x(), cloneFresh(a)),
        cot: div(cloneFresh(a), root()),
        csc: div(x(), root()),
      };
      // There is no arcsec here, and arccos(a/x) is the same angle.
      inverse = fn("arccos", [div(cloneFresh(a), x())]);
      break;
  }

  const replace = (n: MathNode): MathNode => {
    if (n.type === "fn" && n.args.length === 1) {
      const arg = n.args[0]!;
      if (arg.type === "sym" && arg.name === t) {
        const swap = table[n.name];
        if (swap) return cloneFresh(swap);
        return n;
      }
    }
    if (n.type === "sym" && n.name === t) return cloneFresh(inverse);
    const kids = children(n);
    if (kids.length === 0) return n;
    return withChildren(n, kids.map(replace));
  };
  return replace(expanded);
}

/** sin(2t) -> 2 sin t cos t, and cos(2t) -> 1 - 2 sin^2 t. */
function expandDoubleAngles(n: MathNode, t: string): MathNode {
  const doubled = (arg: MathNode): boolean =>
    arg.type === "mul" && arg.args.length === 2 &&
    arg.args[0]!.type === "num" && arg.args[0]!.value.equals(Rational.of(2)) &&
    arg.args[1]!.type === "sym" && (arg.args[1] as { name: string }).name === t;

  if (n.type === "fn" && n.args.length === 1 && doubled(n.args[0]!)) {
    const angle = (): MathNode => sym(t);
    if (n.name === "sin") {
      return mul([num(Rational.of(2)), fn("sin", [angle()]), fn("cos", [angle()])]);
    }
    if (n.name === "cos") {
      return add([
        num(Rational.ONE),
        neg(mul([num(Rational.of(2)), pow(fn("sin", [angle()]), num(Rational.of(2)))])),
      ]);
    }
  }
  const kids = children(n);
  if (kids.length === 0) return n;
  return withChildren(n, kids.map((k) => expandDoubleAngles(k, t)));
}

export const intLongDivision = integralRule(
  "INT_LONG_DIVISION",
  ({ body, variable: v, node }) => {
    const parts = asRationalFunction(body, v);
    if (!parts || degree(parts.top) < degree(parts.bottom)) return null;
    const divided = divmodPoly(parts.top, parts.bottom);
    if (!divided) return null;
    const quotient = polyToNode(divided.quotient, v);
    const rewritten =
      degree(divided.remainder) < 0
        ? quotient
        : add([quotient, div(polyToNode(divided.remainder, v), cloneFresh((body as { den: MathNode }).den))]);
    const result = integral(rewritten, sym(v), node.id);
    return {
      node: result,
      changes: [{ kind: "replace", fromIds: [body.id], toIds: [rewritten.id] }],
      vars: { quotient: toLatex(quotient), variable: v },
    };
  },
);

/** Gaussian elimination on an n by n+1 augmented matrix of exact rationals. */
function solveLinearSystem(rows: Rational[][]): Rational[] | null {
  const n = rows.length;
  const m = rows.map((r) => [...r]);
  for (let col = 0; col < n; col++) {
    let pivot = -1;
    for (let r = col; r < n; r++) if (!m[r]![col]!.isZero()) { pivot = r; break; }
    if (pivot < 0) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const lead = m[col]![col]!;
    for (let c = col; c <= n; c++) m[col]![c] = m[col]![c]!.div(lead);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]!;
      if (factor.isZero()) continue;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]!.sub(factor.mul(m[col]![c]!));
    }
  }
  return m.map((r) => r[n]!);
}

/** The denominator rebuilt from its roots, which is what the basis divides. */
function denominatorPoly(factored: LinearFactorisation): Poly {
  let out: Poly = new Map([[0, factored.lead]]);
  for (const f of factored.factors) {
    const linear: Poly = new Map([[1, Rational.ONE], [0, f.root.neg()]]);
    for (let k = 0; k < f.multiplicity; k++) out = mulPoly(out, linear);
  }
  return out;
}

/**
 * N(x)/D(x) as a sum of A/(x - r)^k, or null.
 *
 * The unknowns are found by matching coefficients rather than by covering up,
 * which costs a linear solve but handles a repeated root with no special case.
 */
function decompose(top: Poly, factored: LinearFactorisation, v: string): MathNode[] | null {
  const full = denominatorPoly(factored);
  const size = degree(full);
  if (size < 1 || size > 6) return null;

  const basis: Poly[] = [];
  const pieces: Array<{ root: Rational; power: number }> = [];
  for (const factor of factored.factors) {
    for (let power = 1; power <= factor.multiplicity; power++) {
      let b = full;
      for (let k = 0; k < power; k++) b = divideByRoot(b, factor.root);
      basis.push(b);
      pieces.push({ root: factor.root, power });
    }
  }
  if (basis.length !== size) return null;

  const rows: Rational[][] = [];
  for (let d = 0; d < size; d++) {
    rows.push([...basis.map((b) => coeff(b, d)), coeff(top, d)]);
  }
  const solved = solveLinearSystem(rows);
  if (!solved) return null;

  const terms: MathNode[] = [];
  pieces.forEach((piece, i) => {
    const value = solved[i]!;
    if (value.isZero()) return;
    const base = piece.root.isZero() ? sym(v) : add([sym(v), num(piece.root.neg())]);
    const denominator =
      piece.power === 1 ? base : pow(base, num(Rational.of(BigInt(piece.power))));
    terms.push(div(num(value), denominator));
  });
  return terms.length > 0 ? terms : null;
}

/**
 * ∫(5x - 3)/(x^2 - 2x - 3) dx -> ∫(3/(x-3) + 2/(x+1)) dx.
 *
 * Only a denominator that splits into linear factors over the rationals is
 * decomposed. x^2 + 1 has no such factorisation, and the table entry for arctan
 * is the rule that handles it; anything with irrational roots is declined.
 */
export const intPartialFractions = integralRule(
  "INT_PARTIAL_FRACTIONS",
  ({ body, variable: v, node }) => {
    const parts = asRationalFunction(body, v);
    if (!parts) return null;
    if (degree(parts.top) >= degree(parts.bottom)) return null;
    if (degree(parts.bottom) < 2) return null;
    const factored = factorOverRationals(parts.bottom);
    if (!factored) return null;
    const terms = decompose(parts.top, factored, v);
    if (!terms || terms.length < 2) return null;
    const sum = add(terms);
    const result = integral(sum, sym(v), node.id);
    return {
      node: result,
      changes: [{ kind: "replace", fromIds: [body.id], toIds: [sum.id] }],
      vars: { pieces: String(terms.length), variable: v },
    };
  },
);

/**
 * ∫(x^2+1)^2 dx -> ∫(x^4 + 2x^2 + 1) dx.
 *
 * Last of the techniques, so a substitution wins wherever one exists:
 * multiplying (x^2+1)^3 out and integrating term by term is correct but buries
 * the shape a substitution keeps. Only an integrand is ever expanded, never an
 * answer — an antiderivative like (x^2+1)^4/4 reads best folded up, which is
 * why EXPAND_POWER is not in the pipeline and this is.
 */
/**
 * A sum of terms `c * v^r`, where r may be any rational. Written as a map from
 * the exponent to its coefficient.
 *
 * `toPolynomial` only reads whole-number exponents, so it says no to
 * (u-1)^2 * u^(1/2), and nothing then expanded it — which is how
 * int x^2 sqrt(x+1) dx came to be declined after the substitution had already
 * done the hard part. This reads the same shapes but keeps the exponents
 * rational.
 */
type PowerSum = Map<string, { exp: Rational; coeff: Rational }>;

function addTerm(into: PowerSum, exp: Rational, coeff: Rational): void {
  const k = exp.toLatex();
  const at = into.get(k);
  if (at) at.coeff = at.coeff.add(coeff);
  else into.set(k, { exp, coeff });
}

function timesPowerSum(a: PowerSum, b: PowerSum): PowerSum {
  const out: PowerSum = new Map();
  for (const x of a.values()) {
    for (const y of b.values()) addTerm(out, x.exp.add(y.exp), x.coeff.mul(y.coeff));
  }
  return out;
}

const MAX_BINOMIAL_POWER = 6;

/** A rational raised to a whole-number power, by repeated multiplication. */
function raise(base: Rational, power: Rational): Rational | null {
  if (!power.isInteger()) return null;
  const times = Number(power.toNumber());
  if (!Number.isSafeInteger(times) || Math.abs(times) > 32) return null;
  if (times === 0) return Rational.ONE;
  if (base.isZero()) return times > 0 ? Rational.ZERO : null;
  let out = Rational.ONE;
  for (let i = 0; i < Math.abs(times); i++) out = out.mul(base);
  return times > 0 ? out : Rational.ONE.div(out);
}

function asPowerSum(n: MathNode, v: string): PowerSum | null {
  switch (n.type) {
    case "num":
      return new Map([["0", { exp: Rational.ZERO, coeff: n.value }]]);
    case "sym":
      return n.name === v
        ? new Map([["1", { exp: Rational.ONE, coeff: Rational.ONE }]])
        : null;
    case "neg": {
      const inner = asPowerSum(n.arg, v);
      if (!inner) return null;
      const out: PowerSum = new Map();
      for (const t of inner.values()) addTerm(out, t.exp, t.coeff.neg());
      return out;
    }
    case "add": {
      const out: PowerSum = new Map();
      for (const a of n.args) {
        const part = asPowerSum(a, v);
        if (!part) return null;
        for (const t of part.values()) addTerm(out, t.exp, t.coeff);
      }
      return out;
    }
    case "mul": {
      let out: PowerSum = new Map([["0", { exp: Rational.ZERO, coeff: Rational.ONE }]]);
      for (const a of n.args) {
        const part = asPowerSum(a, v);
        if (!part) return null;
        out = timesPowerSum(out, part);
      }
      return out;
    }
    case "div": {
      const top = asPowerSum(n.num, v);
      const bottom = asPowerSum(n.den, v);
      if (!top || !bottom || bottom.size !== 1) return null;
      const [only] = [...bottom.values()];
      if (!only || only.coeff.isZero()) return null;
      const out: PowerSum = new Map();
      for (const t of top.values()) addTerm(out, t.exp.sub(only.exp), t.coeff.div(only.coeff));
      return out;
    }
    case "pow": {
      const base = asPowerSum(n.base, v);
      if (!base || n.exp.type !== "num") return null;
      // A single term takes any rational power; a sum has to be multiplied
      // out, so its exponent must be a small whole number.
      if (base.size === 1) {
        const [only] = [...base.values()];
        if (!only) return null;
        const power = n.exp.value;
        let coefficient: Rational;
        if (power.isInteger()) {
          const raised = raise(only.coeff, power);
          if (!raised) return null;
          coefficient = raised;
        } else {
          // A fractional power of a coefficient is not rational in general,
          // so only a bare 1 out front is safe to carry through.
          if (!only.coeff.equals(Rational.ONE)) return null;
          coefficient = Rational.ONE;
        }
        const exponent = only.exp.mul(power);
        return new Map([[exponent.toLatex(), { exp: exponent, coeff: coefficient }]]);
      }
      const power = n.exp.value;
      if (!power.isInteger() || power.isNegative() || power.isZero()) return null;
      const times = Number(power.toNumber());
      if (times > MAX_BINOMIAL_POWER) return null;
      let out: PowerSum = new Map([["0", { exp: Rational.ZERO, coeff: Rational.ONE }]]);
      for (let i = 0; i < times; i++) out = timesPowerSum(out, base);
      return out;
    }
    case "fn":
      if (n.name === "sqrt" && n.args.length === 1) {
        return asPowerSum(pow(cloneFresh(n.args[0]!), num(Rational.of(1, 2))), v);
      }
      return null;
    default:
      return null;
  }
}

function powerSumToNode(sum: PowerSum, v: string): MathNode {
  const terms = [...sum.values()]
    .filter((t) => !t.coeff.isZero())
    .sort((a, b) => b.exp.toNumber() - a.exp.toNumber())
    .map((t) =>
      t.exp.isZero()
        ? num(t.coeff)
        : makeTerm(t.coeff, [
          t.exp.equals(Rational.ONE) ? sym(v) : pow(sym(v), num(t.exp)),
        ]),
    );
  if (terms.length === 0) return num(Rational.ZERO);
  return terms.length === 1 ? terms[0]! : add(terms);
}

/**
 * Multiply out an integrand whose exponents are not all whole numbers, so the
 * power rule can take it a term at a time. INT_EXPAND above owns the ordinary
 * polynomial case and words it better, so this only fires where a fractional
 * or negative exponent is what stopped it.
 */
export const intExpandPowers = integralRule(
  "INT_EXPAND_POWERS",
  ({ body, variable: v, node }) => {
    if (body.type !== "mul" && body.type !== "pow" && body.type !== "div") return null;
    if (toPolynomial(body, v)) return null;
    const sum = asPowerSum(body, v);
    if (!sum || sum.size < 2) return null;
    const expanded = powerSumToNode(sum, v);
    if (key(expanded) === key(body)) return null;
    const result = integral(expanded, sym(v), node.id);
    return {
      node: result,
      changes: [{ kind: "replace", fromIds: [body.id], toIds: [expanded.id] }],
      vars: { variable: v, expanded: toLatex(expanded) },
    };
  },
);

export const intExpand = integralRule("INT_EXPAND", ({ body, variable: v, node }) => {
  if (body.type !== "pow" && body.type !== "mul") return null;
  const expandable = toPolynomial(body, v);
  if (!expandable || degree(expandable) < 2) return null;
  const expanded = polyToNode(expandable, v);
  const result = integral(expanded, sym(v), node.id);
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [body.id], toIds: [expanded.id] }],
    vars: { variable: v },
  };
});

// ------------------------------------------------------------------- the order

/**
 * Split the integral apart first, so the working reads the way a student writes
 * it; then the table, which is what most integrals actually need; then the
 * techniques, cheapest search first. Anything still standing after all of them
 * is an integral this engine cannot do, and the solver declines it rather than
 * returning a half-finished answer.
 */
export const integralRules: Rule[] = [
  intSum,
  intNegative,
  intConstantMultiple,
  intConstant,
  intPower,
  intReciprocal,
  intExponentialE,
  intExponential,
  intSin,
  intCos,
  intSecSquared,
  intTan,
  intCot,
  intSec,
  intCsc,
  intCscSquared,
  intSecCubed,
  intCscCubed,
  intArctan,
  intArcsin,
  intArctanScaled,
  // The rewrites come before the search. Reducing a square or peeling a factor
  // off an odd power is cheap and leaves something the table can finish, where
  // substitution and parts would otherwise flail at it.
  intSinSquared,
  intCosSquared,
  intSinOdd,
  intCosOdd,
  intSqrtAsPower,
  intSubstitution,
  intLongDivision,
  intPartialFractions,
  intCyclicByParts,
  intByParts,
  intFactorRoot,
  intTrigSubstitution,
  intExpand,
  intExpandPowers,
];

/**
 * Integration ahead of the algebra, so ∫2(x+3) dx pulls the 2 out instead of
 * multiplying the bracket out first. The derivative rules come first of all:
 * they only match a d/dv node, and having them resolve one before the integral
 * rules look at it costs nothing and makes ∫d/dx(f) dx readable.
 */
export const integrationRules: Rule[] = [
  ...derivativeRules,
  ...integralRules,
  ...tidyRules,
];
