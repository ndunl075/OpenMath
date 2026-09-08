import {
  evaluateExact, evaluateNumeric, fn, key, type MathNode, num, pow, Rational, rel, sym,
  symbols, toLatex, walk,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { asLog } from "./rules/logs.js";
import { arithmeticRules, divideBothSides, identityRules, isolationRules, logRules } from "./rules/index.js";
import { displayStep, rewriteStep } from "./step.js";
import type { Finish, Resolved, Step } from "./types.js";
import { checkSolution } from "./verify.js";

/**
 * Exponential and logarithmic equations.
 *
 * The exponential direction is safe: b^u is one-to-one, so taking a logarithm
 * of both sides neither gains nor loses a solution. The logarithmic direction
 * is not: raising both sides to a power undoes the log, but it also forgets
 * that log(f) only exists where f is positive. Every candidate is therefore put
 * back into the original arguments, and one that makes any of them zero or
 * negative is rejected in a step of its own.
 */

type Relation = Extract<MathNode, { type: "rel" }>;

const MAX_BASE_MATCH = 12;

function hasVariable(n: MathNode, variable: string): boolean {
  return symbols(n).has(variable);
}

interface Exponential {
  base: MathNode;
  exponent: MathNode;
}

function asExponential(n: MathNode, variable: string): Exponential | null {
  if (n.type === "pow" && !hasVariable(n.base, variable) && hasVariable(n.exp, variable)) {
    return { base: n.base, exponent: n.exp };
  }
  const arg = n.type === "fn" && n.name === "exp" ? n.args[0] : undefined;
  if (arg && hasVariable(arg, variable)) return { base: sym("e"), exponent: arg };
  return null;
}

export function isExponentialEquation(n: MathNode, variable: string): boolean {
  if (n.type !== "rel") return false;
  let found = false;
  walk(n, (x) => {
    if (asExponential(x, variable)) found = true;
  });
  return found;
}

export function isLogarithmicEquation(n: MathNode, variable: string): boolean {
  if (n.type !== "rel") return false;
  let found = false;
  walk(n, (x) => {
    const log = asLog(x);
    if (log && hasVariable(log.argument, variable)) found = true;
  });
  return found;
}

function noSolution(steps: Step[], ruleId: string, before: MathNode, why: string): Resolved {
  return {
    steps: [...steps, displayStep(ruleId, toLatex(before), "\\text{no solution}", before)],
    answers: [],
    values: [],
    answer: "\\text{no solution}",
    note: why,
    verified: true,
  };
}

/** Put the interesting side on the left without inventing a step for it. */
function orient(
  current: Relation,
  steps: Step[],
  onLeft: (side: MathNode) => boolean,
): Relation | null {
  if (onLeft(current.lhs)) return current;
  if (!onLeft(current.rhs)) return null;
  const swapped = rel(current.rel, current.rhs, current.lhs, current.id) as Relation;
  steps.push(rewriteStep("SWAP_SIDES", current, swapped));
  return swapped;
}

export function solveExponentialEquation(
  equation: MathNode,
  variable: string,
  finish: Finish,
): Resolved | null {
  if (equation.type !== "rel" || equation.rel !== "=") return null;

  const steps: Step[] = [];
  const isolated = run(equation, isolationRules, { variable });
  steps.push(...isolated.steps);
  if (isolated.node.type !== "rel") return null;

  const oriented = orient(isolated.node, steps, (side) => !!asExponential(side, variable));
  if (!oriented) return null;
  const exponential = asExponential(oriented.lhs, variable);
  if (!exponential || hasVariable(oriented.rhs, variable)) return null;

  const { base, exponent } = exponential;
  const baseValue = evaluateNumeric(base);
  if (!Number.isFinite(baseValue) || baseValue <= 0 || baseValue === 1) return null;

  const rhsValue = evaluateNumeric(oriented.rhs);
  if (!Number.isFinite(rhsValue)) return null;
  if (rhsValue <= 0) {
    return noSolution(
      steps,
      "EXPONENTIAL_ALWAYS_POSITIVE",
      oriented,
      `${toLatex(base)} raised to any power is positive, so it can never equal ${toLatex(oriented.rhs)}.`,
    );
  }

  // Same base on both sides: the exponents must match, and no logarithm is
  // needed. This is the method the question is usually testing.
  let matchedExponent: MathNode | null = null;
  if (oriented.rhs.type === "pow" && key(oriented.rhs.base) === key(base)) {
    matchedExponent = oriented.rhs.exp;
  } else {
    const b = evaluateExact(base);
    const c = evaluateExact(oriented.rhs);
    if (b && c) {
      for (let k = -MAX_BASE_MATCH; k <= MAX_BASE_MATCH; k++) {
        const power = b.powInt(BigInt(k));
        if (power && power.equals(c)) {
          const rewritten = rel("=", oriented.lhs, pow(base, num(Rational.of(k))));
          steps.push(
            rewriteStep("MATCH_BASES", oriented, rewritten, {
              base: toLatex(base),
              exponent: String(k),
            }),
          );
          matchedExponent = num(Rational.of(k));
          break;
        }
      }
    }
  }

  let reduced: MathNode;
  if (matchedExponent) {
    reduced = rel("=", exponent, matchedExponent);
    steps.push(
      displayStep("EQUATE_EXPONENTS", toLatex(oriented), toLatex(reduced), oriented, {
        base: toLatex(base),
      }),
    );
  } else {
    const isNatural = base.type === "sym" && base.name === "e";
    const logged = isNatural
      ? fn("ln", [oriented.rhs])
      : fn("log", [oriented.rhs, base]);
    reduced = rel("=", exponent, logged);
    steps.push(
      displayStep("TAKE_LOGARITHM", toLatex(oriented), toLatex(reduced), oriented, {
        base: isNatural ? "e" : toLatex(base),
        value: toLatex(oriented.rhs),
      }),
    );
  }

  const solved = finish(reduced, variable);
  const verified =
    solved.verified &&
    steps.every((s) => !s.unverified) &&
    solved.values.every(
      (v) => !Number.isFinite(v) || checkSolution(equation, variable, v) !== "mismatch",
    );
  return { ...solved, steps: [...steps, ...solved.steps], verified };
}

/** Every logarithm argument in the problem, used for the domain check. */
function logArguments(n: MathNode): MathNode[] {
  const out: MathNode[] = [];
  walk(n, (x) => {
    const log = asLog(x);
    if (log) out.push(log.argument);
  });
  return out;
}

export function solveLogarithmicEquation(
  equation: MathNode,
  variable: string,
  finish: Finish,
): Resolved | null {
  if (equation.type !== "rel" || equation.rel !== "=") return null;

  const steps: Step[] = [];
  // Divide off a coefficient before combining: 2 ln(x) = 6 is meant to become
  // ln(x) = 3, and folding the 2 into the logarithm instead leaves x^2 = e^6,
  // which is a harder equation than the one that was asked.
  const scaled = run(equation, [divideBothSides, ...identityRules, ...arithmeticRules], {
    variable,
  });
  steps.push(...scaled.steps);
  if (scaled.node.type !== "rel") return null;
  const combined = run(scaled.node, logRules, { variable });
  steps.push(...combined.steps);
  if (combined.node.type !== "rel") return null;
  const isolated = run(combined.node, isolationRules, { variable });
  steps.push(...isolated.steps);
  if (isolated.node.type !== "rel") return null;

  const oriented = orient(isolated.node, steps, (side) => {
    const log = asLog(side);
    return !!log && hasVariable(log.argument, variable);
  });
  if (!oriented) return null;
  const log = asLog(oriented.lhs);
  if (!log || hasVariable(oriented.rhs, variable)) return null;

  const base = log.family === "ln" ? sym("e") : log.base ?? num(Rational.of(10));
  const baseValue = evaluateNumeric(base);
  if (!Number.isFinite(baseValue) || baseValue <= 0 || baseValue === 1) return null;

  const reduced = rel("=", log.argument, pow(base, oriented.rhs));
  steps.push(
    displayStep("EXPONENTIATE_BOTH_SIDES", toLatex(oriented), toLatex(reduced), oriented, {
      base: toLatex(base),
      side: toLatex(oriented.rhs),
    }),
  );

  const solved = finish(reduced, variable);
  steps.push(...solved.steps);
  if (solved.answers.length === 0) return { ...solved, steps };
  if (solved.values.some((v) => !Number.isFinite(v))) return null;

  const args = logArguments(equation);
  const kept: string[] = [];
  const keptValues: number[] = [];
  const rejected: string[] = [];
  solved.answers.forEach((answer, i) => {
    const value = solved.values[i]!;
    const inDomain = args.every((a) => {
      const v = evaluateNumeric(a, { [variable]: value });
      return Number.isFinite(v) && v > 0;
    });
    if (inDomain && checkSolution(equation, variable, value) !== "mismatch") {
      kept.push(answer);
      keptValues.push(value);
    } else rejected.push(answer);
  });

  steps.push(
    displayStep(
      rejected.length > 0 ? "REJECT_LOG_DOMAIN" : "CHECK_LOG_DOMAIN",
      toLatex(equation),
      kept.length > 0 ? kept.join(" \\quad \\text{or} \\quad ") : "\\text{no solution}",
      equation,
      {
        kept: kept.join(" and ") || "none",
        rejected: rejected.join(" and "),
      },
    ),
  );

  return {
    steps,
    answers: kept,
    values: keptValues,
    ...(kept.length === 0 ? { answer: "\\text{no solution}" } : {}),
    ...(rejected.length > 0
      ? {
          note: `${rejected.join(" and ")} would take the logarithm of a number that is not positive, so ${
            rejected.length === 1 ? "it is rejected" : "they are rejected"
          }.`,
        }
      : {}),
    verified: solved.verified && steps.every((s) => !s.unverified),
  };
}
