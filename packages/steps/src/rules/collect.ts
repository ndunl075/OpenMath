import {
  add, key, makeTerm, type MathNode, mul, num, pow, Rational, splitCoefficient, toLatex,
} from "@openmath/math-core";
import type { Rule } from "../types.js";

/** 2x + 3x -> 5x. The single most common step in school algebra. */
export const combineLikeTerms: Rule = {
  id: "COMBINE_LIKE_TERMS",
  apply(n) {
    if (n.type !== "add") return null;

    const parts = n.args.map((a) => {
      const { coeff, rest } = splitCoefficient(a);
      return { node: a, coeff, rest, k: rest.map(key).sort().join("*") };
    });

    // Group by the non-numeric part. Plain numbers are ADD_NUMBERS' job.
    const groups = new Map<string, typeof parts>();
    for (const p of parts) {
      if (p.rest.length === 0) continue;
      const g = groups.get(p.k);
      if (g) g.push(p);
      else groups.set(p.k, [p]);
    }

    let target: typeof parts | undefined;
    for (const g of groups.values()) {
      if (g.length >= 2) {
        target = g;
        break;
      }
    }
    if (!target) return null;

    let sum = Rational.ZERO;
    for (const p of target) sum = sum.add(p.coeff);
    const merged = makeTerm(sum, target[0]!.rest);

    const targetNodes = new Set(target.map((p) => p.node));
    const firstIndex = n.args.findIndex((a) => targetNodes.has(a));
    const rest: MathNode[] = [];
    n.args.forEach((a, i) => {
      if (i === firstIndex) rest.push(merged);
      else if (!targetNodes.has(a)) rest.push(a);
    });

    return {
      node: rest.length === 0 ? merged : rest.length === 1 ? rest[0]! : add(rest, n.id),
      changes: [
        { kind: "combine", fromIds: target.map((p) => p.node.id), toIds: [merged.id] },
      ],
      vars: {
        terms: target.map((p) => toLatex(p.node)).join(" and "),
        result: toLatex(merged),
      },
    };
  },
};

/** x * x^2 -> x^3 */
export const collectLikeFactors: Rule = {
  id: "COLLECT_LIKE_FACTORS",
  apply(n) {
    if (n.type !== "mul") return null;

    const parts = n.args.map((a) => {
      if (a.type === "pow") return { node: a, base: a.base, exp: a.exp };
      return { node: a, base: a, exp: num(Rational.ONE) };
    });

    const groups = new Map<string, typeof parts>();
    for (const p of parts) {
      if (p.base.type === "num") continue; // numeric powers are EVALUATE_POWER's job
      const k = key(p.base);
      const g = groups.get(k);
      if (g) g.push(p);
      else groups.set(k, [p]);
    }

    let target: typeof parts | undefined;
    for (const g of groups.values()) {
      if (g.length >= 2) {
        target = g;
        break;
      }
    }
    if (!target) return null;

    const base = target[0]!.base;
    const exps = target.map((p) => p.exp);
    // Fold numeric exponents immediately so the student sees x^3, not x^{1+2}.
    const allNumeric = exps.every((e) => e.type === "num");
    let merged: MathNode;
    if (allNumeric) {
      let total = Rational.ZERO;
      for (const e of exps) if (e.type === "num") total = total.add(e.value);
      merged = total.isOne() ? base : total.isZero() ? num(Rational.ONE) : pow(base, num(total));
    } else {
      merged = pow(base, add(exps));
    }

    const targetNodes = new Set(target.map((p) => p.node));
    const firstIndex = n.args.findIndex((a) => targetNodes.has(a));
    const rest: MathNode[] = [];
    n.args.forEach((a, i) => {
      if (i === firstIndex) rest.push(merged);
      else if (!targetNodes.has(a)) rest.push(a);
    });

    return {
      node: rest.length === 1 ? rest[0]! : mul(rest, n.id),
      changes: [
        { kind: "combine", fromIds: target.map((p) => p.node.id), toIds: [merged.id] },
      ],
      vars: { base: toLatex(base), count: String(target.length) },
    };
  },
};

/** (x^2)^3 -> x^6 */
export const powerOfPower: Rule = {
  id: "POWER_OF_POWER",
  apply(n) {
    if (n.type !== "pow" || n.base.type !== "pow") return null;
    const inner = n.base;
    const merged =
      inner.exp.type === "num" && n.exp.type === "num"
        ? pow(inner.base, num(inner.exp.value.mul(n.exp.value)))
        : pow(inner.base, mul([inner.exp, n.exp]));
    return {
      node: merged,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [merged.id] }],
      vars: { base: toLatex(inner.base) },
    };
  },
};

export const collectRules: Rule[] = [combineLikeTerms, collectLikeFactors, powerOfPower];
