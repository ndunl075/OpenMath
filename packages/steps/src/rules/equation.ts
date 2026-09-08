import {
  add, div, isOne, isZero, type MathNode, mul, neg, num, rel, Rational,
  splitCoefficient, symbols, toLatex,
} from "@openmath/math-core";
import type { Rule, RuleContext } from "../types.js";
import { relationDegree } from "../poly.js";

export function termsOf(n: MathNode): MathNode[] {
  return n.type === "add" ? n.args : [n];
}

export function containsVariable(n: MathNode, v: string): boolean {
  return symbols(n).has(v);
}

/** Negate a term, unwrapping an existing minus so ids survive the move. */
export function negate(t: MathNode): MathNode {
  return t.type === "neg" ? t.arg : neg(t);
}

function joinTerms(terms: MathNode[], id?: number): MathNode {
  if (terms.length === 0) return num(Rational.ZERO);
  if (terms.length === 1) return terms[0]!;
  return add(terms, id);
}

/** Pick the variable to solve for: the only symbol, or x/y/z by convention. */
export function chooseVariable(n: MathNode): string | undefined {
  const syms = [...symbols(n)].filter((s) => s !== "pi");
  if (syms.length === 0) return undefined;
  if (syms.length === 1) return syms[0];
  for (const pref of ["x", "y", "z", "t", "n"]) if (syms.includes(pref)) return pref;
  return syms.sort()[0];
}

/** 5 = x  ->  x = 5 */
export const swapSides: Rule = {
  id: "SWAP_SIDES",
  apply(n, ctx: RuleContext) {
    if (n.type !== "rel" || !ctx.variable) return null;
    if (n.rel !== "=") return null;
    const lhsHas = containsVariable(n.lhs, ctx.variable);
    const rhsHas = containsVariable(n.rhs, ctx.variable);
    if (lhsHas || !rhsHas) return null;
    return {
      node: rel(n.rel, n.rhs, n.lhs, n.id),
      changes: [{ kind: "move", fromIds: [n.rhs.id, n.lhs.id], toIds: [n.rhs.id, n.lhs.id] }],
    };
  },
};

/**
 * x/2 = 3  ->  x = 3 * 2
 * Only when the denominator is a non-zero constant, so no solutions are lost or
 * gained by multiplying through.
 */
export const clearDenominators: Rule = {
  id: "CLEAR_DENOMINATORS",
  apply(n, ctx: RuleContext) {
    if (n.type !== "rel" || !ctx.variable) return null;
    const side = n.lhs.type === "div" ? "lhs" : n.rhs.type === "div" ? "rhs" : null;
    if (!side) return null;
    const frac = (side === "lhs" ? n.lhs : n.rhs) as Extract<MathNode, { type: "div" }>;
    const other = side === "lhs" ? n.rhs : n.lhs;
    if (frac.den.type !== "num" || frac.den.value.isZero()) return null;
    if (isOne(frac.den)) return null;
    // Only clear a denominator that is actually in the way. Without this the
    // rule undoes DIVIDE_BOTH_SIDES and the two ping-pong forever.
    if (!containsVariable(frac.num, ctx.variable)) return null;

    const multiplied = mul([other, frac.den]);
    const node =
      side === "lhs"
        ? rel(n.rel, frac.num, multiplied, n.id)
        : rel(n.rel, multiplied, frac.num, n.id);
    return {
      node,
      changes: [{ kind: "apply-both-sides", fromIds: [frac.den.id], toIds: [multiplied.id] }],
      vars: { by: toLatex(frac.den) },
    };
  },
};

/**
 * x^2 + 5x = -6  ->  x^2 + 5x + 6 = 0
 * A quadratic is solved from the "equals zero" form, so everything moves left
 * rather than being shuffled term by term.
 */
export const moveAllToLeft: Rule = {
  id: "MOVE_ALL_TO_LEFT",
  apply(n, ctx: RuleContext) {
    if (n.type !== "rel" || !ctx.variable) return null;
    const deg = relationDegree(n, ctx.variable);
    if (deg === null || deg < 2) return null;
    if (isZero(n.rhs)) return null;
    const moving = termsOf(n.rhs).filter((t) => !isZero(t));
    if (moving.length === 0) return null;
    const movedIn = moving.map(negate);
    const newLhs = joinTerms([...termsOf(n.lhs), ...movedIn]);
    return {
      node: rel(n.rel, newLhs, num(Rational.ZERO), n.id),
      changes: [{ kind: "move", fromIds: moving.map((t) => t.id), toIds: movedIn.map((t) => t.id) }],
    };
  },
};

/** 2x + 3 = 5x - 1  ->  2x + 3 - 5x = -1 */
export const moveVariableTerms: Rule = {
  id: "MOVE_VARIABLE_TERMS",
  apply(n, ctx: RuleContext) {
    if (n.type !== "rel" || !ctx.variable) return null;
    const v = ctx.variable;
    const deg = relationDegree(n, v);
    if (deg !== null && deg > 1) return null;
    const rhsTerms = termsOf(n.rhs);
    const moving = rhsTerms.filter((t) => containsVariable(t, v) && !isZero(t));
    if (moving.length === 0) return null;
    const staying = rhsTerms.filter((t) => !moving.includes(t));

    const movedIn = moving.map(negate);
    const newLhs = joinTerms([...termsOf(n.lhs), ...movedIn]);
    const newRhs = joinTerms(staying);
    return {
      node: rel(n.rel, newLhs, newRhs, n.id),
      changes: [
        {
          kind: "move",
          fromIds: moving.map((t) => t.id),
          toIds: movedIn.map((t) => t.id),
        },
      ],
      vars: { terms: moving.map((t) => toLatex(t)).join(" and "), side: "left" },
    };
  },
};

/** 2x + 3 = 7  ->  2x = 7 - 3 */
export const moveConstantTerms: Rule = {
  id: "MOVE_CONSTANT_TERMS",
  apply(n, ctx: RuleContext) {
    if (n.type !== "rel" || !ctx.variable) return null;
    const v = ctx.variable;
    const deg = relationDegree(n, v);
    if (deg !== null && deg > 1) return null;
    const lhsTerms = termsOf(n.lhs);
    if (!lhsTerms.some((t) => containsVariable(t, v))) return null;
    const moving = lhsTerms.filter((t) => !containsVariable(t, v) && !isZero(t));
    if (moving.length === 0) return null;
    const staying = lhsTerms.filter((t) => !moving.includes(t));
    if (staying.length === 0) return null;

    const movedIn = moving.map(negate);
    const newLhs = joinTerms(staying);
    const newRhs = joinTerms([...termsOf(n.rhs), ...movedIn]);
    return {
      node: rel(n.rel, newLhs, newRhs, n.id),
      changes: [
        {
          kind: "move",
          fromIds: moving.map((t) => t.id),
          toIds: movedIn.map((t) => t.id),
        },
      ],
      vars: { terms: moving.map((t) => toLatex(t)).join(" and "), side: "right" },
    };
  },
};

/**
 * 2x = 6  ->  x = 6/2
 * Flips the relation when dividing an inequality by a negative number.
 */
export const divideBothSides: Rule = {
  id: "DIVIDE_BOTH_SIDES",
  apply(n, ctx: RuleContext) {
    if (n.type !== "rel" || !ctx.variable) return null;
    const deg = relationDegree(n, ctx.variable);
    if (deg !== null && deg > 1) return null;
    if (n.lhs.type === "add") return null;
    const { coeff, rest } = splitCoefficient(n.lhs);
    if (rest.length === 0 || coeff.isOne() || coeff.isZero()) return null;
    if (!containsVariable(n.lhs, ctx.variable)) return null;

    const divisor = num(coeff);
    const newLhs = rest.length === 1 ? rest[0]! : mul(rest);
    const newRhs = div(n.rhs, divisor);
    const flipped: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
    const nextRel =
      coeff.isNegative() && n.rel !== "=" ? (flipped[n.rel] as typeof n.rel) : n.rel;
    return {
      node: rel(nextRel, newLhs, newRhs, n.id),
      changes: [{ kind: "apply-both-sides", fromIds: [n.lhs.id], toIds: [newRhs.id] }],
      vars: { by: coeff.toLatex(), flipped: nextRel !== n.rel ? "yes" : "" },
    };
  },
};

export const equationRules: Rule[] = [
  swapSides,
  clearDenominators,
  moveAllToLeft,
  moveVariableTerms,
  moveConstantTerms,
  divideBothSides,
];
