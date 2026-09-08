import type { Rule } from "../types.js";
import { arithmeticRules } from "./arithmetic.js";
import { collectRules } from "./collect.js";
import { distributeRules } from "./distribute.js";
import { equationRules } from "./equation.js";
import { fractionRules } from "./fractions.js";
import { identityRules } from "./identities.js";

export * from "./arithmetic.js";
export * from "./collect.js";
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

export const allRules: Rule[] = [...expressionRules, ...equationRules];
