import {
  add, asDiff, cloneFresh, diff, div, fn, makeTerm, type MathNode, mul, neg, num,
  pow, Rational, sym, symbols, toLatex,
} from "@openmath/math-core";
import type { Rule, RuleResult } from "../types.js";

/**
 * Differentiation, one rewrite at a time.
 *
 * The engine takes the first rule in this list that applies anywhere in the
 * tree, so the order below is the order a student writes the working: break the
 * expression apart with the structural rules first (sum, constant multiple,
 * product, quotient), and only then differentiate the leaves. That is what makes
 * d/dx(x^2 + 3x) show the sum rule and then each term, instead of landing on the
 * answer in one jump.
 *
 * Every rule reads the variable off the derivative node itself rather than the
 * rule context, so a nested derivative in another variable can never pick up the
 * wrong one.
 */

/** Does this sub-expression change when `v` changes? */
function dependsOn(n: MathNode, v: string): boolean {
  return symbols(n).has(v);
}

/**
 * A derivative rule: matches only `d/dv(...)` nodes and is handed the pieces.
 * Wrapping them this way keeps the guard identical everywhere, which matters
 * because these rules also sit in `allRules` alongside the equation rules.
 */
function diffRule(
  id: string,
  apply: (body: MathNode, v: string, node: MathNode) => RuleResult | null,
): Rule {
  return {
    id,
    apply(n) {
      const d = asDiff(n);
      if (!d) return null;
      return apply(d.body, d.variable, d.node);
    },
  };
}

/** d/dx(f + g) -> d/dx(f) + d/dx(g), keeping the sign on a subtracted term. */
export const diffSum = diffRule("DIFF_SUM", (body, v, node) => {
  if (body.type !== "add") return null;
  const terms = body.args.map((a) =>
    a.type === "neg" ? neg(diff(a.arg, sym(v)), a.id) : diff(a, sym(v)),
  );
  const result = add(terms, body.id);
  // A subtracted term keeps its own minus node, so what is new on each term is
  // the derivative inside it, not the sign in front of it.
  const created = terms.map((t) => (t.type === "neg" ? t.arg.id : t.id));
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: created }],
    vars: { count: String(terms.length), variable: v },
  };
});

/** d/dx(-f) -> -d/dx(f) */
export const diffNegative = diffRule("DIFF_NEGATIVE", (body, v, node) => {
  if (body.type !== "neg") return null;
  const inner = diff(body.arg, sym(v));
  return {
    node: neg(inner, body.id),
    changes: [{ kind: "move", fromIds: [body.id], toIds: [body.id] }],
    vars: { variable: v },
  };
});

/**
 * d/dx(5f) -> 5 d/dx(f), and d/dx(f/5) -> d/dx(f)/5.
 *
 * Placed before the product and quotient rules so a constant factor is lifted
 * out rather than dragged through a product rule that would only produce a zero
 * term. Anything free of x counts as constant here; the solver has already
 * refused problems containing a second letter, whose reading would be a guess.
 */
export const diffConstantMultiple = diffRule("DIFF_CONSTANT_MULTIPLE", (body, v, node) => {
  if (body.type === "mul") {
    const constants = body.args.filter((a) => !dependsOn(a, v));
    const rest = body.args.filter((a) => dependsOn(a, v));
    if (constants.length === 0 || rest.length === 0) return null;
    const inner = diff(rest.length === 1 ? rest[0]! : mul(rest), sym(v));
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
      node: div(diff(body.num, sym(v)), body.den, body.id),
      changes: [{ kind: "move", fromIds: [body.den.id], toIds: [body.den.id] }],
      vars: { constant: toLatex(body.den), variable: v },
      explanationKey: "DIFF_CONSTANT_DENOMINATOR",
    };
  }
  return null;
});

/** d/dx(f g) -> d/dx(f) g + f d/dx(g) */
export const diffProduct = diffRule("DIFF_PRODUCT", (body, v, node) => {
  if (body.type !== "mul" || body.args.length < 2) return null;
  const first = body.args[0]!;
  const others = body.args.slice(1);
  const second = others.length === 1 ? others[0]! : mul(others);
  // A factor free of x belongs to the constant-multiple rule, which runs first.
  if (!dependsOn(first, v) || !dependsOn(second, v)) return null;

  // Each factor survives once and is differentiated once. The surviving copy
  // keeps the original node, so the animation slides it instead of redrawing it.
  const left = mul([diff(cloneFresh(first), sym(v)), second]);
  const right = mul([first, diff(cloneFresh(second), sym(v))]);
  return {
    node: add([left, right]),
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [left.id, right.id] }],
    vars: { first: toLatex(first), second: toLatex(second), variable: v },
  };
});

/** d/dx(f/g) -> (d/dx(f) g - f d/dx(g)) / g^2 */
export const diffQuotient = diffRule("DIFF_QUOTIENT", (body, v, node) => {
  if (body.type !== "div") return null;
  // A constant denominator is the constant-multiple rule's job.
  if (!dependsOn(body.den, v)) return null;
  const top = body.num;
  const bottom = body.den;
  const numerator = add([
    mul([diff(cloneFresh(top), sym(v)), bottom]),
    neg(mul([top, diff(cloneFresh(bottom), sym(v))])),
  ]);
  const result = div(numerator, pow(cloneFresh(bottom), num(Rational.of(2))), body.id);
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
    vars: { top: toLatex(top), bottom: toLatex(bottom), variable: v },
  };
});

/** d/dx(7) -> 0 */
export const diffConstant = diffRule("DIFF_CONSTANT", (body, v, node) => {
  if (dependsOn(body, v)) return null;
  const zero = num(Rational.ZERO);
  return {
    node: zero,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [zero.id] }],
    vars: { constant: toLatex(body), variable: v },
  };
});

/** d/dx(x) -> 1 */
export const diffVariable = diffRule("DIFF_VARIABLE", (body, v, node) => {
  if (body.type !== "sym" || body.name !== v) return null;
  const one = num(Rational.ONE);
  return {
    node: one,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [one.id] }],
    vars: { variable: v },
  };
});

/**
 * d/dx(x^n) -> n x^(n-1), and d/dx(u^n) -> n u^(n-1) d/dx(u) when the base is
 * itself a function of x.
 *
 * The chain factor is written last so the serialized step re-reads as the same
 * expression: the derivative operator always brackets its operand, and putting
 * it at the end means nothing can follow it to be swallowed.
 */
export const diffPower = diffRule("DIFF_POWER", (body, v, node) => {
  if (body.type !== "pow") return null;
  const { base, exp } = body;
  // A variable exponent is DIFF_EXPONENTIAL's, and a constant base with a
  // constant exponent is DIFF_CONSTANT's.
  if (exp.type !== "num" || !dependsOn(base, v)) return null;

  const lowered = pow(base, num(exp.value.sub(Rational.ONE)), body.id);
  const direct = base.type === "sym" && base.name === v;
  // makeTerm keeps a coefficient of 1 or -1 from being printed, so d/dx(x^-1)
  // reads -x^-2 rather than -1 x^-2.
  const result = makeTerm(
    exp.value,
    direct ? [lowered] : [lowered, diff(cloneFresh(base), sym(v))],
  );
  // The exponent coming down to the front is the motion of the power rule; when
  // it lands as 1 or -1 there is no coefficient to land on and it is a rewrite.
  const coefficient = result.type === "mul" ? result.args[0] : undefined;
  return {
    node: result,
    changes:
      coefficient && coefficient.type === "num"
        ? [{ kind: "move", fromIds: [exp.id], toIds: [coefficient.id] }]
        : [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
    vars: { exponent: exp.value.toLatex(), base: toLatex(base), variable: v },
    ...(direct ? {} : { explanationKey: "DIFF_CHAIN_POWER" }),
  };
});

/**
 * d/dx(e^u) -> e^u d/dx(u), and d/dx(a^u) -> a^u ln(a) d/dx(u) for any other
 * constant base. Base e is separated out because ln(e) = 1 is a simplification
 * this engine has no rule for, and printing it would be noise.
 */
export const diffExponential = diffRule("DIFF_EXPONENTIAL", (body, v, node) => {
  if (body.type !== "pow") return null;
  const { base, exp } = body;
  if (dependsOn(base, v) || !dependsOn(exp, v)) return null;

  const chain = diff(cloneFresh(exp), sym(v));
  const isE = base.type === "sym" && base.name === "e";
  const factors = isE ? [body, chain] : [body, fn("ln", [cloneFresh(base)]), chain];
  const result = mul(factors);
  return {
    node: result,
    changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
    vars: { base: toLatex(base), variable: v },
    ...(isE ? { explanationKey: "DIFF_EXPONENTIAL_E" } : {}),
  };
});

/**
 * The elementary functions. Each one differentiates its own outside and, when
 * the argument is anything other than the variable itself, multiplies by the
 * derivative of the inside. Writing the chain factor as an unevaluated
 * `d/dx(inside)` is what makes the next step show the inside being differentiated
 * on its own line, which is the part of the chain rule students get wrong.
 */
interface Elementary {
  id: string;
  name: string;
  /** The derivative when the argument is the variable itself. `arg` is reused. */
  direct(arg: MathNode): MathNode;
  /**
   * The derivative when the argument is a function of the variable. `arg` is
   * reused, `chain` is the unevaluated derivative of the inside. Defaults to
   * multiplying the two, which is right for everything except ln and sqrt,
   * where the chain factor belongs on top of the fraction.
   */
  chained?(arg: MathNode, chain: MathNode): MathNode;
}

const TWO = () => num(Rational.of(2));

const ELEMENTARY: Elementary[] = [
  { id: "DIFF_SIN", name: "sin", direct: (u) => fn("cos", [u]) },
  { id: "DIFF_COS", name: "cos", direct: (u) => neg(fn("sin", [u])) },
  { id: "DIFF_TAN", name: "tan", direct: (u) => pow(fn("sec", [u]), TWO()) },
  { id: "DIFF_EXP", name: "exp", direct: (u) => fn("exp", [u]) },
  {
    id: "DIFF_LN",
    name: "ln",
    direct: (u) => div(num(Rational.ONE), u),
    chained: (u, chain) => div(chain, u),
  },
  {
    id: "DIFF_SQRT",
    name: "sqrt",
    direct: (u) => div(num(Rational.ONE), mul([TWO(), fn("sqrt", [u])])),
    chained: (u, chain) => div(chain, mul([TWO(), fn("sqrt", [u])])),
  },
  // The rest of the trig family. sec appeared in answers long before it could
  // be differentiated, since d/dx(tan u) produces it.
  {
    id: "DIFF_SEC",
    name: "sec",
    direct: (u) => mul([fn("sec", [u]), fn("tan", [cloneFresh(u)])]),
  },
  {
    id: "DIFF_CSC",
    name: "csc",
    direct: (u) => neg(mul([fn("csc", [u]), fn("cot", [cloneFresh(u)])])),
  },
  { id: "DIFF_COT", name: "cot", direct: (u) => neg(pow(fn("csc", [u]), TWO())) },
  // The inverse trig pair. Like ln, the chain factor belongs on the numerator.
  {
    id: "DIFF_ARCSIN",
    name: "arcsin",
    direct: (u) => div(num(Rational.ONE), oneMinusSquare(u)),
    chained: (u, chain) => div(chain, oneMinusSquare(u)),
  },
  {
    id: "DIFF_ARCCOS",
    name: "arccos",
    direct: (u) => neg(div(num(Rational.ONE), oneMinusSquare(u))),
    chained: (u, chain) => neg(div(chain, oneMinusSquare(u))),
  },
  {
    id: "DIFF_ARCTAN",
    name: "arctan",
    direct: (u) => div(num(Rational.ONE), onePlusSquare(u)),
    chained: (u, chain) => div(chain, onePlusSquare(u)),
  },
  { id: "DIFF_SINH", name: "sinh", direct: (u) => fn("cosh", [u]) },
  { id: "DIFF_COSH", name: "cosh", direct: (u) => fn("sinh", [u]) },
  {
    id: "DIFF_TANH",
    name: "tanh",
    direct: (u) => div(num(Rational.ONE), pow(fn("cosh", [u]), TWO())),
    chained: (u, chain) => div(chain, pow(fn("cosh", [u]), TWO())),
  },
  // log is base 10 here, matching the parser and evaluate.
  {
    id: "DIFF_LOG",
    name: "log",
    direct: (u) => div(num(Rational.ONE), mul([u, fn("ln", [num(Rational.of(10))])])),
    chained: (u, chain) => div(chain, mul([u, fn("ln", [num(Rational.of(10))])])),
  },
];

/** sqrt(1 - u^2), the denominator both inverse sine and cosine sit over. */
function oneMinusSquare(u: MathNode): MathNode {
  return fn("sqrt", [add([num(Rational.ONE), neg(pow(cloneFresh(u), TWO()))])]);
}

/** 1 + u^2, the denominator of the inverse tangent. */
function onePlusSquare(u: MathNode): MathNode {
  return add([num(Rational.ONE), pow(cloneFresh(u), TWO())]);
}

function elementaryRule(spec: Elementary): Rule {
  return diffRule(spec.id, (body, v, node) => {
    if (body.type !== "fn" || body.name !== spec.name || body.args.length !== 1) return null;
    const arg = body.args[0];
    if (!arg || !dependsOn(arg, v)) return null;

    if (arg.type === "sym" && arg.name === v) {
      const result = spec.direct(arg);
      return {
        node: result,
        changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
        vars: { inside: toLatex(arg), variable: v },
      };
    }

    const chain = diff(cloneFresh(arg), sym(v));
    const result = spec.chained
      ? spec.chained(arg, chain)
      : mul([spec.direct(arg), chain]);
    return {
      node: result,
      changes: [{ kind: "replace", fromIds: [node.id], toIds: [result.id] }],
      vars: { inside: toLatex(arg), variable: v },
      explanationKey: `${spec.id}_CHAIN`,
    };
  });
}

export const elementaryRules: Rule[] = ELEMENTARY.map(elementaryRule);

/**
 * Structure first, leaves last. Constant before variable so d/dx(5) is not
 * looked at as a power of x; power before exponential so x^2 and 2^x cannot
 * both match.
 */
export const derivativeRules: Rule[] = [
  diffSum,
  diffNegative,
  diffConstantMultiple,
  diffProduct,
  diffQuotient,
  diffConstant,
  diffVariable,
  diffPower,
  diffExponential,
  ...elementaryRules,
];
