import {
  add, div, isOne, key, makeTerm, type MathNode, mul, num, pow, Rational,
  splitCoefficient, toLatex,
} from "@openmath/math-core";
import type { Rule } from "../types.js";

function lcm(a: bigint, b: bigint): bigint {
  const g = (x: bigint, y: bigint): bigint => (y === 0n ? x : g(y, x % y));
  const gg = g(a < 0n ? -a : a, b < 0n ? -b : b) || 1n;
  return (a / gg) * b;
}

/** 2 * (x/3) -> (2x)/3 */
export const multiplyFractions: Rule = {
  id: "MULTIPLY_FRACTIONS",
  apply(n) {
    if (n.type !== "mul" || n.args.length < 2) return null;
    if (!n.args.some((a) => a.type === "div")) return null;

    const nums: MathNode[] = [];
    const dens: MathNode[] = [];
    for (const a of n.args) {
      if (a.type === "div") {
        nums.push(a.num);
        dens.push(a.den);
      } else nums.push(a);
    }
    const node = div(
      nums.length === 1 ? nums[0]! : mul(nums),
      dens.length === 1 ? dens[0]! : mul(dens),
    );
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
    };
  },
};

/** a / (b/c) -> (a*c)/b, and (a/b)/c -> a/(b*c) */
export const divideByFraction: Rule = {
  id: "DIVIDE_BY_FRACTION",
  apply(n) {
    if (n.type !== "div") return null;
    if (n.den.type === "div") {
      const node = div(mul([n.num, n.den.den]), n.den.num);
      return {
        node,
        changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
        vars: { divisor: toLatex(n.den) },
      };
    }
    if (n.num.type === "div") {
      const node = div(n.num.num, mul([n.num.den, n.den]));
      return {
        node,
        changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
        vars: { divisor: toLatex(n.den) },
      };
    }
    return null;
  },
};

/** x/2 + 1/3 -> (3x + 2)/6 */
export const addFractions: Rule = {
  id: "ADD_FRACTIONS",
  apply(n) {
    if (n.type !== "add" || n.args.length < 2) return null;

    const parts = n.args.map((a) => {
      if (a.type === "div") return { numerator: a.num, denominator: a.den, negated: false };
      if (a.type === "neg" && a.arg.type === "div") {
        return { numerator: a.arg.num, denominator: a.arg.den, negated: true };
      }
      return { numerator: a, denominator: null as MathNode | null, negated: false };
    });
    if (!parts.some((p) => p.denominator && !isOne(p.denominator))) return null;

    const dens = parts
      .map((p) => p.denominator)
      .filter((d): d is MathNode => !!d && !isOne(d));

    const allIntegers = dens.every(
      (d) => d.type === "num" && d.value.isInteger() && !d.value.isZero(),
    );

    let commonDen: MathNode;
    let multiplierFor: (i: number) => MathNode | null;

    if (allIntegers) {
      let l = 1n;
      for (const d of dens) if (d.type === "num") l = lcm(l, d.value.n);
      if (l < 0n) l = -l;
      commonDen = num(Rational.of(l));
      multiplierFor = (i) => {
        const d = parts[i]!.denominator;
        const dv = d && d.type === "num" ? d.value.n : 1n;
        const m = l / dv;
        return m === 1n ? null : num(Rational.of(m));
      };
    } else {
      // Distinct symbolic denominators multiplied together.
      const distinct: MathNode[] = [];
      const seen = new Set<string>();
      for (const d of dens) {
        const k = key(d);
        if (!seen.has(k)) {
          seen.add(k);
          distinct.push(d);
        }
      }
      commonDen = distinct.length === 1 ? distinct[0]! : mul(distinct);
      multiplierFor = (i) => {
        const d = parts[i]!.denominator;
        const dk = d && !isOne(d) ? key(d) : null;
        const others = distinct.filter((x) => key(x) !== dk);
        if (others.length === 0) return null;
        if (others.length === distinct.length && dk === null) {
          return distinct.length === 1 ? distinct[0]! : mul(distinct.map((x) => x));
        }
        return others.length === 1 ? others[0]! : mul(others);
      };
    }

    const numerators = parts.map((p, i) => {
      const m = multiplierFor(i);
      let value: MathNode;
      if (!m) value = p.numerator;
      else if (p.numerator.type === "num" && m.type === "num") {
        value = num(m.value.mul(p.numerator.value));
      } else if (isOne(p.numerator)) value = m;
      else value = mul([m, p.numerator]);
      if (p.negated) value = { type: "neg", id: value.id, arg: value } as MathNode;
      return value;
    });

    const node = div(add(numerators), commonDen);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: { denominator: toLatex(commonDen) },
    };
  },
};

interface Factor {
  base: MathNode;
  exp: Rational;
}

function factorize(n: MathNode): { coeff: Rational; factors: Factor[] } | null {
  const { coeff, rest } = splitCoefficient(n);
  const factors: Factor[] = [];
  for (const r of rest) {
    if (r.type === "pow") {
      if (r.exp.type !== "num" || !r.exp.value.isInteger()) return null;
      factors.push({ base: r.base, exp: r.exp.value });
    } else {
      factors.push({ base: r, exp: Rational.ONE });
    }
  }
  return { coeff, factors };
}

function rebuild(coeff: Rational, factors: Factor[]): MathNode {
  const parts: MathNode[] = [];
  if (!coeff.isOne()) parts.push(num(coeff));
  for (const f of factors) {
    if (f.exp.isZero()) continue;
    parts.push(f.exp.isOne() ? f.base : pow(f.base, num(f.exp)));
  }
  if (parts.length === 0) return num(Rational.ONE);
  return parts.length === 1 ? parts[0]! : mul(parts);
}

/** (2x^3)/(4x) -> x^2/2 */
export const cancelFractionFactors: Rule = {
  id: "CANCEL_FRACTION_FACTORS",
  apply(n) {
    if (n.type !== "div") return null;
    const top = factorize(n.num);
    const bot = factorize(n.den);
    if (!top || !bot) return null;
    if (bot.coeff.isZero()) return null;

    let changed = false;
    const cancelledIds: number[] = [];

    // Reduce the numeric coefficients against each other.
    const ratio = top.coeff.div(bot.coeff);
    let newTopCoeff = Rational.of(ratio.n);
    let newBotCoeff = Rational.of(ratio.d);
    if (!newTopCoeff.equals(top.coeff) || !newBotCoeff.equals(bot.coeff)) changed = true;

    // Subtract exponents of shared bases.
    const topF = top.factors.map((f) => ({ ...f }));
    const botF = bot.factors.map((f) => ({ ...f }));
    for (const b of botF) {
      const t = topF.find((x) => key(x.base) === key(b.base) && !x.exp.isZero() && !b.exp.isZero());
      if (!t) continue;
      const shared = t.exp.cmp(b.exp) <= 0 ? t.exp : b.exp;
      if (shared.isZero()) continue;
      t.exp = t.exp.sub(shared);
      b.exp = b.exp.sub(shared);
      cancelledIds.push(b.base.id, t.base.id);
      changed = true;
    }
    if (!changed) return null;

    const numerator = rebuild(newTopCoeff, topF);
    const denominator = rebuild(newBotCoeff, botF);
    const node = isOne(denominator) ? numerator : div(numerator, denominator);
    return {
      node,
      changes: [{ kind: "cancel", fromIds: cancelledIds, toIds: [node.id] }],
    };
  },
};

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) { const t = x % y; x = y; y = t; }
  return x;
}

function gcdRational(a: Rational, b: Rational): Rational {
  if (a.isZero()) return b.abs();
  if (b.isZero()) return a.abs();
  const n = gcdBig(a.n, b.n);
  const d = lcm(a.d, b.d);
  return Rational.of(n, d < 0n ? -d : d).abs();
}

/**
 * (2x + 4)/2 -> x + 2, and (-2 + 2 sqrt 5)/4 -> (-1 + sqrt 5)/2.
 * Divides a sum over a fraction bar by the factor every term shares with the
 * denominator, and keeps the minus sign out of the denominator.
 */
export const reduceFractionByCommonFactor: Rule = {
  id: "CANCEL_FRACTION_FACTORS",
  apply(n) {
    if (n.type !== "div" || n.num.type !== "add") return null;
    const terms = n.num.args;
    const denSplit = splitCoefficient(n.den);
    let g = denSplit.coeff.abs();
    if (g.isZero()) return null;
    for (const t of terms) {
      const { coeff } = splitCoefficient(t);
      g = gcdRational(g, coeff);
      if (g.isOne()) break;
    }
    const denNegative = denSplit.coeff.isNegative();
    if (g.isOne() && !denNegative) return null;

    const divisor = denNegative ? g.neg() : g;
    const scale = (node: MathNode): MathNode => {
      const { coeff, rest } = splitCoefficient(node);
      return makeTerm(coeff.div(divisor), rest);
    };
    const numerator = add(terms.map(scale));
    const denominator = makeTerm(denSplit.coeff.div(divisor), denSplit.rest);
    const node = isOne(denominator) ? numerator : div(numerator, denominator);
    return {
      node,
      changes: [{ kind: "cancel", fromIds: [n.num.id, n.den.id], toIds: [node.id] }],
    };
  },
};

export const fractionRules: Rule[] = [
  divideByFraction,
  cancelFractionFactors,
  reduceFractionByCommonFactor,
  multiplyFractions,
  addFractions,
];
