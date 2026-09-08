import { add, isOne, isZero, type MathNode, mul, num, Rational } from "@openmath/math-core";
import type { Rule } from "../types.js";

/** x + 0 -> x */
export const removeAdditiveIdentity: Rule = {
  id: "REMOVE_ADDITIVE_IDENTITY",
  apply(n) {
    if (n.type !== "add") return null;
    const zeros = n.args.filter(isZero);
    if (zeros.length === 0 || n.args.length - zeros.length === 0) return null;
    const rest = n.args.filter((a) => !isZero(a));
    return {
      node: rest.length === 1 ? rest[0]! : add(rest, n.id),
      changes: [{ kind: "cancel", fromIds: zeros.map((z) => z.id), toIds: [] }],
    };
  },
};

/** x * 1 -> x */
export const removeMultiplicativeIdentity: Rule = {
  id: "REMOVE_MULTIPLICATIVE_IDENTITY",
  apply(n) {
    if (n.type !== "mul") return null;
    const ones = n.args.filter(isOne);
    if (ones.length === 0 || n.args.length - ones.length === 0) return null;
    const rest = n.args.filter((a) => !isOne(a));
    return {
      node: rest.length === 1 ? rest[0]! : mul(rest, n.id),
      changes: [{ kind: "cancel", fromIds: ones.map((z) => z.id), toIds: [] }],
    };
  },
};

/** x * 0 -> 0 */
export const multiplyByZero: Rule = {
  id: "MULTIPLY_BY_ZERO",
  apply(n) {
    if (n.type !== "mul" || !n.args.some(isZero)) return null;
    const z = num(Rational.ZERO);
    return {
      node: z,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [z.id] }],
    };
  },
};

/** x^1 -> x */
export const powerOfOne: Rule = {
  id: "POWER_OF_ONE",
  apply(n) {
    if (n.type !== "pow" || !isOne(n.exp)) return null;
    return {
      node: n.base,
      changes: [{ kind: "cancel", fromIds: [n.exp.id], toIds: [n.base.id] }],
    };
  },
};

/** x^0 -> 1 */
export const powerOfZero: Rule = {
  id: "POWER_OF_ZERO",
  apply(n) {
    if (n.type !== "pow" || !isZero(n.exp)) return null;
    if (isZero(n.base)) return null; // 0^0 is undefined, leave it alone
    const one = num(Rational.ONE);
    return {
      node: one,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [one.id] }],
    };
  },
};

/** 1^x -> 1 */
export const oneToAnyPower: Rule = {
  id: "ONE_TO_ANY_POWER",
  apply(n) {
    if (n.type !== "pow" || !isOne(n.base)) return null;
    const one = num(Rational.ONE);
    return {
      node: one,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [one.id] }],
    };
  },
};

/** x / 1 -> x */
export const divideByOne: Rule = {
  id: "DIVIDE_BY_ONE",
  apply(n) {
    if (n.type !== "div" || !isOne(n.den)) return null;
    return {
      node: n.num,
      changes: [{ kind: "cancel", fromIds: [n.den.id], toIds: [n.num.id] }],
    };
  },
};

/** 0 / x -> 0 */
export const zeroNumerator: Rule = {
  id: "ZERO_NUMERATOR",
  apply(n) {
    if (n.type !== "div" || !isZero(n.num)) return null;
    const z: MathNode = num(Rational.ZERO);
    return {
      node: z,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [z.id] }],
    };
  },
};

export const identityRules: Rule[] = [
  multiplyByZero,
  zeroNumerator,
  removeAdditiveIdentity,
  removeMultiplicativeIdentity,
  powerOfZero,
  powerOfOne,
  oneToAnyPower,
  divideByOne,
];
