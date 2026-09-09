import {
  add, div, evaluateExact, isOne, type MathNode, mul, neg, num, Rational, toLatex,
} from "@openmath/math-core";
import { run } from "../engine.js";
import { arithmeticRules } from "./arithmetic.js";
import { collectRules } from "./collect.js";
import { distribute, distributeNegative } from "./distribute.js";
import { identityRules } from "./identities.js";
import type { Rule } from "../types.js";

/**
 * Cancelling factorials against each other.
 *
 * `(n+1)!/n!` is `n+1`, and that single fact is what makes the ratio test
 * work symbolically instead of by measurement. Without it the ratio of one
 * term to the next has to be *sampled*, and a factorial passes the largest
 * double at 171, so the sampling runs out of numbers long before the ratio
 * settles. With it, the ratio simplifies to something the limit engine reads
 * exactly.
 *
 * Only a difference of a small whole number is cancelled. `(2n)!/n!` is a
 * genuine question with no short answer, and guessing at one would be worse
 * than leaving it alone.
 */

const MAX_GAP = 8;

const asFactorial = (n: MathNode): MathNode | null =>
  n.type === "fn" && n.name === "factorial" && n.args.length === 1 ? n.args[0]! : null;

/** The constant difference `a - b`, when it is one. */
function constantGap(a: MathNode, b: MathNode): number | null {
  // distributeNegative is needed, not optional: without it n - (n+1) never
  // reduces, and the reciprocal direction — n!/(n+1)! — silently declined to
  // cancel while (n+1)!/n! worked, because that one only negates a bare
  // symbol.
  const difference = run(
    add([a, neg(b)]),
    [...identityRules, ...arithmeticRules, distributeNegative, distribute, ...collectRules],
    {},
    { verify: false, maxSteps: 40 },
  ).node;
  const exact = evaluateExact(difference);
  if (!exact || !exact.isInteger()) return null;
  const gap = Number(exact.toNumber());
  return Math.abs(gap) <= MAX_GAP ? gap : null;
}

/** `(b+1)(b+2)...(b+k)`, the factors that survive the cancellation. */
function risingProduct(base: MathNode, k: number): MathNode {
  const factors: MathNode[] = [];
  for (let j = 1; j <= k; j++) {
    factors.push(add([base, num(Rational.of(j))]));
  }
  return factors.length === 1 ? factors[0]! : mul(factors);
}

/**
 * (n+1)!/n! -> n+1, and n!/(n+1)! -> 1/(n+1).
 *
 * The factorials are looked for among the *factors* on each side rather than
 * required to be the whole of it. The ratio test produces 2*n!/(n+1)! as
 * readily as it produces n!/(n+1)!, and a rule that only matched the bare
 * form left the commonest shapes — sum 2^n/n! and sum n!/2^n — to be settled
 * by sampling instead.
 */
export const cancelFactorials: Rule = {
  id: "CANCEL_FACTORIALS",
  apply(n) {
    if (n.type !== "div") return null;
    const top = n.num.type === "mul" ? [...n.num.args] : [n.num];
    const bottom = n.den.type === "mul" ? [...n.den.args] : [n.den];

    for (let i = 0; i < top.length; i++) {
      const a = asFactorial(top[i]!);
      if (!a) continue;
      for (let j = 0; j < bottom.length; j++) {
        const b = asFactorial(bottom[j]!);
        if (!b) continue;
        const gap = constantGap(a, b);
        if (gap === null || gap === 0) continue;

        // What survives goes on whichever side had the larger factorial.
        const survivors = risingProduct(gap > 0 ? b : a, Math.abs(gap));
        const keptTop = top.filter((_, k) => k !== i);
        const keptBottom = bottom.filter((_, k) => k !== j);
        if (gap > 0) keptTop.push(survivors);
        else keptBottom.push(survivors);

        const numerator = build(keptTop);
        const denominator = build(keptBottom);
        const node = isOne(denominator) ? numerator : div(numerator, denominator);
        return {
          node,
          changes: [{ kind: "cancel", fromIds: [top[i]!.id, bottom[j]!.id], toIds: [node.id] }],
          vars: {
            top: toLatex(top[i]!),
            bottom: toLatex(bottom[j]!),
            gap: String(Math.abs(gap)),
          },
        };
      }
    }
    return null;
  },
};

function build(factors: MathNode[]): MathNode {
  if (factors.length === 0) return num(Rational.ONE);
  return factors.length === 1 ? factors[0]! : mul(factors);
}

export const factorialRules: Rule[] = [cancelFactorials];
