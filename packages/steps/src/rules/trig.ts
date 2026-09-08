import {
  add, exactInverseTrig, exactTrig, isTangentPole, key, type MathNode, num,
  Rational, toLatex, twelfthsOfPi,
} from "@openmath/math-core";
import type { Rule } from "../types.js";

/**
 * The exact values.
 *
 * Answering `\sin(0)` with `\sin(0)` teaches nothing and reads as a broken app,
 * so these rules exist to make sure the common angles come out as numbers. They
 * come out *exactly*: `\frac{\sqrt{2}}{2}`, never 0.7071. An angle with no
 * closed form, such as `\sin(1)` or `\sin(\frac{\pi}{5})`, is left alone rather
 * than approximated, and `\tan(\frac{\pi}{2})` is refused by the solver's
 * undefined-value check rather than answered with the huge number floating point
 * happens to produce there.
 */

const TRIG_NAMES = ["sin", "cos", "tan", "sec", "csc", "cot"] as const;
const INVERSE_NAMES = ["arcsin", "arccos", "arctan"] as const;

/** sin(pi/6) -> 1/2, cos(pi/4) -> sqrt(2)/2, tan(7pi/6) -> sqrt(3)/3 */
export const evaluateTrigExact: Rule = {
  id: "EVALUATE_TRIG",
  apply(n) {
    if (n.type !== "fn" || n.args.length !== 1) return null;
    if (!(TRIG_NAMES as readonly string[]).includes(n.name)) return null;
    const arg = n.args[0];
    if (!arg) return null;
    // Nothing to do at a pole: the function has no value there, and the solver
    // declines the whole problem rather than letting a rule invent one.
    const t = twelfthsOfPi(arg);
    if (t !== null) {
      if ((n.name === "tan" || n.name === "sec") && isTangentPole(t)) return null;
      if ((n.name === "cot" || n.name === "csc") && t % 12 === 0) return null;
    }
    const value = exactTrig(n.name, arg);
    if (!value) return null;
    return {
      node: value,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [value.id] }],
      vars: { function: `\\${n.name}`, angle: toLatex(arg), result: toLatex(value) },
    };
  },
};

/** arcsin(1) -> pi/2, arctan(1) -> pi/4 */
export const evaluateInverseTrigExact: Rule = {
  id: "EVALUATE_INVERSE_TRIG",
  apply(n) {
    if (n.type !== "fn" || n.args.length !== 1) return null;
    if (!(INVERSE_NAMES as readonly string[]).includes(n.name)) return null;
    const arg = n.args[0];
    if (!arg) return null;
    const value = exactInverseTrig(n.name, arg);
    if (!value) return null;
    return {
      node: value,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [value.id] }],
      vars: { function: `\\${n.name}`, value: toLatex(arg), result: toLatex(value) },
    };
  },
};

/** One squared sine and the matching squared cosine, or null. */
function pythagoreanPair(args: MathNode[]): { sin: number; cos: number } | null {
  const squared = (a: MathNode, name: string): MathNode | null => {
    if (a.type !== "pow" || a.exp.type !== "num" || !a.exp.value.equals(Rational.of(2))) {
      return null;
    }
    const inner = a.base;
    if (inner.type !== "fn" || inner.name !== name || inner.args.length !== 1) return null;
    return inner.args[0] ?? null;
  };
  for (let i = 0; i < args.length; i++) {
    const s = squared(args[i]!, "sin");
    if (!s) continue;
    for (let j = 0; j < args.length; j++) {
      if (i === j) continue;
      const c = squared(args[j]!, "cos");
      if (c && key(c) === key(s)) return { sin: i, cos: j };
    }
  }
  return null;
}

/**
 * sin(x)^2 + cos(x)^2 -> 1, for any angle, not only the exact ones.
 *
 * The two terms have different variable parts, so collecting like terms cannot
 * reach this; it is the identity itself that does the work.
 */
export const pythagoreanIdentity: Rule = {
  id: "PYTHAGOREAN_IDENTITY",
  apply(n) {
    if (n.type !== "add" || n.args.length < 2) return null;
    const pair = pythagoreanPair(n.args);
    if (!pair) return null;
    const one = num(Rational.ONE);
    const rest = n.args.filter((_, i) => i !== pair.sin && i !== pair.cos);
    const sinNode = n.args[pair.sin]!;
    const cosNode = n.args[pair.cos]!;
    const angle = sinNode.type === "pow" && sinNode.base.type === "fn"
      ? toLatex(sinNode.base.args[0]!)
      : "";
    return {
      node: rest.length === 0 ? one : add([one, ...rest], n.id),
      changes: [{ kind: "combine", fromIds: [sinNode.id, cosNode.id], toIds: [one.id] }],
      vars: { angle },
    };
  },
};

export const trigRules: Rule[] = [
  evaluateTrigExact,
  evaluateInverseTrigExact,
  pythagoreanIdentity,
];
