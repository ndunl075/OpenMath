import type { Rule } from "../types.js";
import { arithmeticRules } from "./arithmetic.js";
import { collectRules } from "./collect.js";
import { derivativeRules } from "./derivative.js";
import { distribute, distributeNegative, distributeRules } from "./distribute.js";
import { equationRules } from "./equation.js";
import { fractionRules } from "./fractions.js";
import { identityRules } from "./identities.js";

export * from "./arithmetic.js";
export * from "./collect.js";
export * from "./derivative.js";
export * from "./distribute.js";
export * from "./equation.js";
export * from "./fractions.js";
export * from "./identities.js";

/**
 * Priority order. The engine takes the first rule that applies anywhere, so
 * this list is the curriculum: fold numbers, tidy identities, cancel, collect,
 * expand, then handle fractions. Equation moves come last so both sides are
 * fully simplified before anything crosses the equals sign.
 */
export const expressionRules: Rule[] = [
  ...identityRules,
  ...arithmeticRules,
  ...collectRules,
  ...fractionRules,
  ...distributeRules,
];

/**
 * Differentiation ahead of the algebra, so d/dx((x^2+1)^3) shows the chain rule
 * instead of being expanded into a polynomial first. Every derivative rule only
 * matches a d/dv node, so the algebra still runs unchanged on everything else,
 * and it tidies the result once the last derivative has been taken.
 *
 * EXPAND_POWER is deliberately left out. A chain rule answer is a power of the
 * inside function, and multiplying it out turns 6x(x^2+1)^2 into a degree-five
 * polynomial: longer, less recognisable, and for a fifth power it exhausts the
 * step budget. Distributing is still wanted, because it is what tidies the
 * numerator a quotient rule leaves behind.
 */
export const differentiationRules: Rule[] = [
  ...derivativeRules,
  ...identityRules,
  ...arithmeticRules,
  ...collectRules,
  ...fractionRules,
  distributeNegative,
  distribute,
];

export const allRules: Rule[] = [...differentiationRules, ...equationRules];
