import {
  div, fn, key, type MathNode, mul, num, pow, Rational, sym, toLatex,
} from "@openmath/math-core";
import type { Rule } from "../types.js";

/**
 * The log laws, used to fold several logarithms into one before an equation is
 * solved.
 *
 * These rules are not part of `expressionRules`. log(a) + log(b) = log(ab) only
 * holds where both a and b are positive, so applying it can widen the domain
 * and hand back a value that is not a solution of the original equation. That
 * is precisely why the log solver checks every candidate against the original
 * arguments; a bare simplification has nowhere to run that check.
 */

interface LogParts {
  node: MathNode;
  argument: MathNode;
  /** Base as written, or null for the natural log. */
  base: MathNode | null;
  /** Grouping key: two logs combine only when this matches. */
  family: string;
}

export function asLogTerm(n: MathNode): LogParts | null {
  if (n.type !== "fn") return null;
  if (n.name === "ln") {
    const [a] = n.args;
    if (!a) return null;
    return { node: n, argument: a, base: null, family: "ln" };
  }
  if (n.name === "log") {
    const [a, b] = n.args;
    if (!a) return null;
    return { node: n, argument: a, base: b ?? null, family: b ? `log:${key(b)}` : "log:10" };
  }
  return null;
}

/** Rebuild a log of the same family around a new argument. */
export function logOf(parts: LogParts, argument: MathNode): MathNode {
  if (parts.family === "ln") return fn("ln", [argument]);
  return parts.base ? fn("log", [argument, parts.base]) : fn("log", [argument]);
}

/** 2 log(x) -> log(x^2) */
export const logCoefficientToPower: Rule = {
  id: "LOG_COEFFICIENT_TO_POWER",
  apply(n) {
    if (n.type !== "mul" || n.args.length !== 2) return null;
    const [a, b] = n.args as [MathNode, MathNode];
    const coefficient = a.type === "num" ? a : b.type === "num" ? b : null;
    const other = a.type === "num" ? b : a;
    if (!coefficient || coefficient.value.isOne()) return null;
    const log = asLogTerm(other);
    if (!log) return null;
    const node = logOf(log, pow(log.argument, coefficient));
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: { exponent: coefficient.value.toLatex(), argument: toLatex(log.argument) },
    };
  },
};

/** log(a) + log(b) -> log(ab), and log(a) - log(b) -> log(a/b) */
export const combineLogs: Rule = {
  id: "COMBINE_LOG_SUM",
  apply(n) {
    if (n.type !== "add" || n.args.length < 2) return null;

    interface Entry {
      log: LogParts;
      negated: boolean;
      term: MathNode;
    }
    const entries: Entry[] = [];
    const others: MathNode[] = [];
    for (const term of n.args) {
      const direct = asLogTerm(term);
      if (direct) {
        entries.push({ log: direct, negated: false, term });
        continue;
      }
      if (term.type === "neg") {
        const inner = asLogTerm(term.arg);
        if (inner) {
          entries.push({ log: inner, negated: true, term });
          continue;
        }
      }
      others.push(term);
    }
    if (entries.length < 2) return null;

    const family = entries[0]!.log.family;
    if (entries.some((e) => e.log.family !== family)) return null;

    const positives = entries.filter((e) => !e.negated).map((e) => e.log.argument);
    const negatives = entries.filter((e) => e.negated).map((e) => e.log.argument);
    if (positives.length === 0) return null;

    const top = positives.length === 1 ? positives[0]! : mul(positives);
    const argument =
      negatives.length === 0
        ? top
        : div(top, negatives.length === 1 ? negatives[0]! : mul(negatives));
    const merged = logOf(entries[0]!.log, argument);
    const node = others.length === 0 ? merged : { ...n, args: [merged, ...others] };
    return {
      node,
      changes: [
        { kind: "combine", fromIds: entries.map((e) => e.term.id), toIds: [merged.id] },
      ],
      explanationKey: negatives.length > 0 ? "COMBINE_LOG_DIFFERENCE" : "COMBINE_LOG_SUM",
      vars: {
        first: toLatex(positives[0]!),
        second: toLatex(negatives[0] ?? positives[1] ?? positives[0]!),
      },
    };
  },
};

/** log_b(b^k) -> k, which is what makes an exponential equation collapse. */
export const logOfSameBasePower: Rule = {
  id: "LOG_OF_POWER",
  apply(n) {
    const log = asLogTerm(n);
    if (!log) return null;
    const arg = log.argument;
    if (arg.type !== "pow") return null;
    const base = log.family === "ln" ? sym("e") : log.base ?? num(Rational.of(10));
    if (key(arg.base) !== key(base)) return null;
    return {
      node: arg.exp,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [arg.exp.id] }],
      vars: { base: toLatex(base) },
    };
  },
};

export const logEquationRules: Rule[] = [
  logCoefficientToPower,
  combineLogs,
  logOfSameBasePower,
];
