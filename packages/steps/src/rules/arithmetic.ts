import {
  add, evaluateExact, type MathNode, mul, num, Rational, toLatex,
} from "@openmath/math-core";
import type { Rule } from "../types.js";

const MAX_POWER_EXPONENT = 30n;
const MAX_DIGITS = 40;

function tooBig(r: Rational): boolean {
  return r.n.toString().length > MAX_DIGITS || r.d.toString().length > MAX_DIGITS;
}

/** 2 + 3 + x  ->  5 + x */
export const addNumbers: Rule = {
  id: "ADD_NUMBERS",
  apply(n) {
    if (n.type !== "add") return null;
    const idx: number[] = [];
    n.args.forEach((a, i) => {
      if (a.type === "num") idx.push(i);
    });
    if (idx.length < 2) return null;

    let sum = Rational.ZERO;
    const parts: string[] = [];
    for (const i of idx) {
      const a = n.args[i]!;
      if (a.type !== "num") continue;
      sum = sum.add(a.value);
      parts.push(a.value.toLatex());
    }
    const merged = num(sum);
    const first = idx[0]!;
    const rest: MathNode[] = [];
    n.args.forEach((a, i) => {
      if (i === first) rest.push(merged);
      else if (!idx.includes(i)) rest.push(a);
    });
    return {
      node: rest.length === 1 ? rest[0]! : add(rest, n.id),
      changes: [{ kind: "combine", fromIds: idx.map((i) => n.args[i]!.id), toIds: [merged.id] }],
      vars: { values: parts.join(" + "), result: sum.toLatex() },
    };
  },
};

/** 2 * 3 * x  ->  6x */
export const multiplyNumbers: Rule = {
  id: "MULTIPLY_NUMBERS",
  apply(n) {
    if (n.type !== "mul") return null;
    const idx: number[] = [];
    n.args.forEach((a, i) => {
      if (a.type === "num") idx.push(i);
    });
    if (idx.length < 2) return null;

    let prod = Rational.ONE;
    const parts: string[] = [];
    for (const i of idx) {
      const a = n.args[i]!;
      if (a.type !== "num") continue;
      prod = prod.mul(a.value);
      parts.push(a.value.toLatex());
    }
    if (tooBig(prod)) return null;
    const merged = num(prod);
    const first = idx[0]!;
    const rest: MathNode[] = [];
    n.args.forEach((a, i) => {
      if (i === first) rest.push(merged);
      else if (!idx.includes(i)) rest.push(a);
    });
    return {
      node: rest.length === 1 ? rest[0]! : mul(rest, n.id),
      changes: [{ kind: "combine", fromIds: idx.map((i) => n.args[i]!.id), toIds: [merged.id] }],
      vars: { values: parts.join(" \\times "), result: prod.toLatex() },
    };
  },
};

/**
 * Reduce a numeric fraction. Only fires when the rendering actually changes, so
 * an already-reduced fraction like 1/2 does not produce an empty step.
 */
export const simplifyNumericFraction: Rule = {
  id: "SIMPLIFY_FRACTION",
  apply(n) {
    if (n.type !== "div" || n.num.type !== "num" || n.den.type !== "num") return null;
    const a = n.num.value;
    const b = n.den.value;
    if (b.isZero()) return null;
    const result = a.div(b);
    const gcd = (x: bigint, y: bigint): bigint => {
      let p = x < 0n ? -x : x;
      let q = y < 0n ? -y : y;
      while (q) { const t = p % q; p = q; q = t; }
      return p;
    };
    const alreadyLowestTerms =
      a.isInteger() && b.isInteger() && !b.isNegative() && !b.isOne() &&
      gcd(a.n, b.n) === 1n;
    if (alreadyLowestTerms) return null;
    const merged = num(result);
    return {
      node: merged,
      changes: [{ kind: "combine", fromIds: [n.num.id, n.den.id], toIds: [merged.id] }],
      vars: { before: `\\frac{${a.toLatex()}}{${b.toLatex()}}`, result: result.toLatex() },
    };
  },
};

/** 2^3 -> 8, 2^{-1} -> 1/2 */
export const evaluatePower: Rule = {
  id: "EVALUATE_POWER",
  apply(n) {
    if (n.type !== "pow" || n.base.type !== "num" || n.exp.type !== "num") return null;
    const e = n.exp.value;
    // 0^0 is undefined; powInt would answer 1.
    if (n.base.value.isZero() && e.isZero()) return null;
    if (!e.isInteger()) {
      // Zero to a positive power is zero however the power is written, which is
      // the one fractional exponent with an exact value. Substituting a limit of
      // zero into an antiderivative like (2/3)x^(3/2) is where this comes up.
      if (!n.base.value.isZero() || e.isNegative()) return null;
      const zero = num(Rational.ZERO);
      return {
        node: zero,
        changes: [{ kind: "replace", fromIds: [n.id], toIds: [zero.id] }],
        vars: { base: "0", exponent: e.toLatex(), result: "0" },
      };
    }
    const mag = e.n < 0n ? -e.n : e.n;
    if (mag > MAX_POWER_EXPONENT) return null;
    const result = n.base.value.powInt(e.n);
    if (!result || tooBig(result)) return null;
    const merged = num(result);
    return {
      node: merged,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [merged.id] }],
      vars: {
        base: n.base.value.toLatex(),
        exponent: e.toLatex(),
        result: result.toLatex(),
      },
    };
  },
};

/** sqrt(9) -> 3, and the exact nth root when there is one. */
export const evaluateRoot: Rule = {
  id: "EVALUATE_ROOT",
  apply(n) {
    if (n.type !== "fn") return null;
    let radicand: MathNode | undefined;
    let degree = 2n;
    if (n.name === "sqrt") {
      radicand = n.args[0];
    } else if (n.name === "root") {
      radicand = n.args[0];
      const d = n.args[1];
      if (!d || d.type !== "num" || !d.value.isInteger() || d.value.n <= 0n) return null;
      degree = d.value.n;
    } else return null;
    if (!radicand) return null;
    const value = evaluateExact(radicand);
    if (!value) return null;
    const root = value.nthRoot(degree);
    if (!root) return null;
    const merged = num(root);
    return {
      node: merged,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [merged.id] }],
      vars: { radicand: value.toLatex(), result: root.toLatex() },
    };
  },
};

/** sqrt(12) -> 2 sqrt(3): pull out the largest square factor. */
export const simplifyRadical: Rule = {
  id: "SIMPLIFY_RADICAL",
  apply(n) {
    if (n.type !== "fn" || n.name !== "sqrt") return null;
    const r = n.args[0];
    if (!r || r.type !== "num") return null;
    const v = r.value;
    if (!v.isInteger() || v.isNegative() || v.n < 2n) return null;
    let rest = v.n;
    let outside = 1n;
    for (let f = 2n; f * f <= rest; f++) {
      while (rest % (f * f) === 0n) {
        rest /= f * f;
        outside *= f;
      }
    }
    if (outside === 1n) return null;
    const outNode = num(Rational.of(outside));
    const inner = num(Rational.of(rest));
    const node = rest === 1n ? outNode : mul([outNode, { ...n, args: [inner] }]);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: {
        radicand: v.toLatex(),
        outside: outside.toString(),
        inside: rest.toString(),
      },
    };
  },
};

/** |-7| -> 7 */
export const evaluateAbsoluteValue: Rule = {
  id: "EVALUATE_ABS",
  apply(n) {
    if (n.type !== "fn" || n.name !== "abs") return null;
    const arg = n.args[0];
    if (!arg) return null;
    const value = evaluateExact(arg);
    if (!value || !value.isNegative()) {
      // A non-negative value still drops the bars, but only when we know the sign.
      if (!value) return null;
    }
    const merged = num(value.abs());
    return {
      node: merged,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [merged.id] }],
      vars: { value: value.toLatex(), result: value.abs().toLatex() },
    };
  },
};

/**
 * Is this expression positive whatever its variables do?
 *
 * Conservative on purpose: it only says yes where the sign is structural. Used
 * to drop absolute-value bars that an antiderivative put there for safety —
 * the integral of 1/x is ln|x|, so evaluating it between 1 and e produced
 * ln|e|, which is 1 but does not say so.
 */
function knownPositive(n: MathNode): boolean {
  switch (n.type) {
    case "num":
      return !n.value.isNegative() && !n.value.isZero();
    case "sym":
      return n.name === "e" || n.name === "pi";
    case "fn":
      return n.name === "exp" || n.name === "cosh";
    case "pow":
      return knownPositive(n.base);
    case "mul":
      return n.args.every(knownPositive);
    case "add":
      return n.args.every(knownPositive);
    case "div":
      return knownPositive(n.num) && knownPositive(n.den);
    default:
      return false;
  }
}

/** 5! -> 120 */
export const evaluateFactorial: Rule = {
  id: "EVALUATE_FACTORIAL",
  apply(n) {
    if (n.type !== "fn" || n.name !== "factorial") return null;
    const arg = n.args[0];
    if (!arg) return null;
    const value = evaluateExact(arg);
    if (!value || !value.isInteger() || value.isNegative()) return null;
    const times = Number(value.toNumber());
    // Past twenty or so the exact answer is a very long integer that no
    // student wrote down on purpose, and printing it helps nobody.
    if (times > 20) return null;
    let total = Rational.ONE;
    for (let k = 2; k <= times; k++) total = total.mul(Rational.of(k));
    const result = num(total);
    return {
      node: result,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [result.id] }],
      vars: { value: value.toLatex(), result: total.toLatex() },
    };
  },
};

/** |e| -> e, for anything whose sign is not in doubt. */
export const absoluteValueOfPositive: Rule = {
  id: "ABS_OF_POSITIVE",
  apply(n) {
    if (n.type !== "fn" || n.name !== "abs") return null;
    const arg = n.args[0];
    if (!arg || !knownPositive(arg)) return null;
    // A plain number is EVALUATE_ABS's, which words it better.
    if (arg.type === "num") return null;
    return {
      node: arg,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [arg.id] }],
      vars: { value: toLatex(arg) },
    };
  },
};

export const arithmeticRules: Rule[] = [
  addNumbers,
  multiplyNumbers,
  simplifyNumericFraction,
  evaluatePower,
  evaluateRoot,
  simplifyRadical,
  evaluateAbsoluteValue,
  absoluteValueOfPositive,
  evaluateFactorial,
];
