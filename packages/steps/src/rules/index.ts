import type { Rule } from "../types.js";
import { arithmeticRules } from "./arithmetic.js";
import { collectRules } from "./collect.js";
import { derivativeRules } from "./derivative.js";
import { distribute, distributeNegative, distributeRules } from "./distribute.js";
import { equationRules } from "./equation.js";
import { factorRules } from "./factor.js";
import { fractionRules } from "./fractions.js";
import { identityRules } from "./identities.js";
import { logRules } from "./logs.js";

export * from "./arithmetic.js";
export * from "./collect.js";
export * from "./derivative.js";
export * from "./distribute.js";
export * from "./equation.js";
export * from "./factor.js";
export * from "./fractions.js";
export * from "./identities.js";
export * from "./logs.js";

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

/**
 * Enough to get one thing on its own and tidy the other side, and nothing that
 * would reach inside a logarithm or an exponent. The radical, logarithmic and
 * exponential solvers use this to isolate before they take their one big step;
 * running the whole curriculum there would expand the very expression they are
 * about to rewrite.
 */
export const isolationRules: Rule[] = [
  ...identityRules,
  ...arithmeticRules,
  ...equationRules,
];

/**
 * Every rule in the package, whichever pipeline it belongs to. Only used to
 * check that each one has an explanation; the pipelines above are what the
 * engine actually runs.
 */
export const everyRule: Rule[] = [
  ...allRules,
  ...expressionRules,
  ...factorRules,
  ...logRules,
];
