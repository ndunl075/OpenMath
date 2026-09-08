import {
  add, div, exactLog, fn, type FnNode, isValidLogBase, key, type MathNode, mul,
  num, Rational, sym, toLatex,
} from "@openmath/math-core";
import type { Rule } from "../types.js";

/**
 * Logarithms: the exact values first, then the three laws.
 *
 * `\log_2(8)` is 3 and `\ln(e)` is 1; leaving either as it arrived is not an
 * answer. `\log_2(10)` is deliberately left alone, because its value is
 * irrational and a decimal would be a worse answer than none: everything this
 * engine prints stays exact.
 */

/** `\log` with nothing underneath is base ten, as every textbook writes it. */
const DECIMAL_BASE = (): MathNode => num(Rational.of(10));

export interface LogParts {
  node: FnNode;
  argument: MathNode;
  base: MathNode;
}

/** Read a node as a logarithm, whichever of the two notations it arrived in. */
export function asLog(n: MathNode): LogParts | null {
  if (n.type !== "fn") return null;
  const argument = n.args[0];
  if (!argument) return null;
  if (n.name === "ln" && n.args.length === 1) {
    return { node: n, argument, base: sym("e") };
  }
  if (n.name === "log" && n.args.length <= 2) {
    return { node: n, argument, base: n.args[1] ?? DECIMAL_BASE() };
  }
  return null;
}

/** A logarithm over the same base as `like`, written the same way. */
function sameBase(like: LogParts, argument: MathNode): MathNode {
  const written = like.node.args[1];
  return written ? fn(like.node.name, [argument, written]) : fn(like.node.name, [argument]);
}

/** log_2(8) -> 3, ln(e) -> 1, log(100) -> 2, ln(e^{k}) -> k */
export const evaluateLogExact: Rule = {
  id: "EVALUATE_LOG",
  apply(n) {
    const l = asLog(n);
    if (!l) return null;
    const value = exactLog(l.argument, l.base);
    if (!value) return null;
    return {
      node: value,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [value.id] }],
      vars: {
        base: toLatex(l.base),
        argument: toLatex(l.argument),
        result: toLatex(value),
      },
    };
  },
};

/** ln(x) + ln(y) -> ln(xy) */
export const logOfProduct: Rule = {
  id: "LOG_PRODUCT",
  apply(n) {
    if (n.type !== "add" || n.args.length < 2) return null;
    const logs = n.args.map(asLog);
    for (let i = 0; i < logs.length; i++) {
      const a = logs[i];
      if (!a || !isValidLogBase(a.base)) continue;
      for (let j = i + 1; j < logs.length; j++) {
        const b = logs[j];
        if (!b || key(a.base) !== key(b.base)) continue;
        const merged = sameBase(a, mul([a.argument, b.argument]));
        const rest = n.args.filter((_, k) => k !== i && k !== j);
        return {
          node: rest.length === 0 ? merged : add([merged, ...rest], n.id),
          changes: [{ kind: "combine", fromIds: [a.node.id, b.node.id], toIds: [merged.id] }],
          vars: { first: toLatex(a.argument), second: toLatex(b.argument) },
        };
      }
    }
    return null;
  },
};

/** ln(x) - ln(y) -> ln(x/y) */
export const logOfQuotient: Rule = {
  id: "LOG_QUOTIENT",
  apply(n) {
    if (n.type !== "add" || n.args.length < 2) return null;
    for (let i = 0; i < n.args.length; i++) {
      const a = asLog(n.args[i]!);
      if (!a || !isValidLogBase(a.base)) continue;
      for (let j = 0; j < n.args.length; j++) {
        const subtracted = n.args[j]!;
        if (i === j || subtracted.type !== "neg") continue;
        const b = asLog(subtracted.arg);
        if (!b || key(a.base) !== key(b.base)) continue;
        const merged = sameBase(a, div(a.argument, b.argument));
        const rest = n.args.filter((_, k) => k !== i && k !== j);
        return {
          node: rest.length === 0 ? merged : add([merged, ...rest], n.id),
          changes: [{ kind: "combine", fromIds: [a.node.id, subtracted.id], toIds: [merged.id] }],
          vars: { first: toLatex(a.argument), second: toLatex(b.argument) },
        };
      }
    }
    return null;
  },
};

/**
 * ln(x^k) -> k ln(x).
 *
 * Only for an exponent that is a literal number. With a symbolic exponent the
 * identity still holds, but bringing it down turns a log into a product without
 * making anything simpler, which is the opposite of what a step is for.
 */
export const logOfPower: Rule = {
  id: "LOG_POWER",
  apply(n) {
    const l = asLog(n);
    if (!l || !isValidLogBase(l.base)) return null;
    const inner = l.argument;
    if (inner.type !== "pow" || inner.exp.type !== "num") return null;
    if (inner.exp.value.isOne() || inner.exp.value.isZero()) return null;
    // A power of the base itself has an exact value; EVALUATE_LOG says it better.
    if (key(inner.base) === key(l.base)) return null;
    const rebuilt = sameBase(l, inner.base);
    const node = mul([inner.exp, rebuilt]);
    return {
      node,
      changes: [{ kind: "move", fromIds: [inner.exp.id], toIds: [inner.exp.id] }],
      vars: { exponent: toLatex(inner.exp), argument: toLatex(inner.base) },
    };
  },
};

export const logRules: Rule[] = [
  evaluateLogExact,
  logOfProduct,
  logOfQuotient,
  logOfPower,
];
