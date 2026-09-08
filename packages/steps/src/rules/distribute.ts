import {
  add, cloneFresh, type MathNode, mul, neg, toLatex,
} from "@openmath/math-core";
import type { Rule } from "../types.js";

/**
 * 2(x + 1) -> 2x + 2. Distributes one sum at a time so a product of two
 * binomials expands over two readable steps rather than one dense one.
 */
export const distribute: Rule = {
  id: "DISTRIBUTE",
  apply(n) {
    if (n.type !== "mul") return null;
    const k = n.args.findIndex((a) => a.type === "add");
    if (k < 0) return null;
    const sum = n.args[k]!;
    if (sum.type !== "add") return null;
    const others = n.args.filter((_, i) => i !== k);
    if (others.length === 0) return null;

    const terms = sum.args.map((t) => {
      const factors = [...others.map((o) => cloneFresh(o)), t];
      return factors.length === 1 ? factors[0]! : mul(factors);
    });
    const node = add(terms);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: terms.map((t) => t.id) }],
      vars: {
        factor: others.map((o) => toLatex(o)).join(" \\cdot "),
        sum: toLatex(sum),
      },
    };
  },
};

/** -(x + 1) -> -x - 1 */
export const distributeNegative: Rule = {
  id: "DISTRIBUTE_NEGATIVE",
  apply(n) {
    if (n.type !== "neg" || n.arg.type !== "add") return null;
    const terms = n.arg.args.map((t) => (t.type === "neg" ? t.arg : neg(t)));
    const node = add(terms);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: terms.map((t) => t.id) }],
      vars: { sum: toLatex(n.arg) },
    };
  },
};

/** (x + 1)^2 -> (x + 1)(x + 1) */
export const expandPower: Rule = {
  id: "EXPAND_POWER",
  apply(n) {
    if (n.type !== "pow" || n.base.type !== "add") return null;
    if (n.exp.type !== "num" || !n.exp.value.isInteger() || n.exp.value.isNegative()) return null;
    const e = Number(n.exp.value.n);
    if (e < 2 || e > 4) return null;
    const copies: MathNode[] = [];
    for (let i = 0; i < e; i++) copies.push(cloneFresh(n.base));
    const node = mul(copies);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: { base: toLatex(n.base), exponent: String(e) },
    };
  },
};

export const distributeRules: Rule[] = [distributeNegative, distribute, expandPower];
