import {
  add, div, type MathNode, num, pow, Rational, rel, splitCoefficient, symbols, toLatex, walk,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { negate, termsOf } from "./rules/equation.js";
import { expressionRules } from "./rules/index.js";
import { displayStep, rewriteStep } from "./step.js";
import type { Finish, Resolved, Step } from "./types.js";
import { checkSolution } from "./verify.js";

/**
 * Radical equations.
 *
 * Squaring both sides is the only way forward and it is not reversible: every
 * x that satisfies sqrt(f) = g also satisfies f = g^2, but the reverse is false
 * whenever g is negative. So the squared equation is solved and then every
 * candidate is put back into the *original* equation. The check is a visible
 * step because it is the part of the method students are taught and forget.
 */

type Relation = Extract<MathNode, { type: "rel" }>;
type Fn = Extract<MathNode, { type: "fn" }>;

function radicalsIn(n: MathNode, variable: string): Fn[] {
  const out: Fn[] = [];
  walk(n, (x) => {
    if (x.type !== "fn") return;
    if (x.name !== "sqrt" && x.name !== "root") return;
    const inner = x.args[0];
    if (inner && symbols(inner).has(variable)) out.push(x);
  });
  return out;
}

export function isRadicalEquation(n: MathNode, variable: string): boolean {
  return n.type === "rel" && radicalsIn(n, variable).length > 0;
}

function contains(haystack: MathNode, needle: MathNode): boolean {
  let found = false;
  walk(haystack, (x) => {
    if (x === needle) found = true;
  });
  return found;
}

/** The index of the root: 2 for a square root, n for an nth root. */
function radicalDegree(f: Fn): bigint | null {
  if (f.name === "sqrt") return 2n;
  const d = f.args[1];
  if (!d || d.type !== "num" || !d.value.isInteger() || d.value.n < 2n) return null;
  return d.value.n;
}

export function solveRadicalEquation(
  equation: MathNode,
  variable: string,
  finish: Finish,
): Resolved | null {
  if (equation.type !== "rel" || equation.rel !== "=") return null;
  const radicals = radicalsIn(equation, variable);
  // Two radicals need repeated squaring with a cross term in between, which is
  // a different method; one is what school algebra asks for.
  if (radicals.length !== 1) return null;
  const radical = radicals[0]!;

  const steps: Step[] = [];
  let current: Relation = equation;

  if (contains(current.rhs, radical)) {
    const swapped = rel("=", current.rhs, current.lhs, current.id);
    steps.push(rewriteStep("SWAP_SIDES", current, swapped));
    current = swapped as Relation;
  }

  const terms = termsOf(current.lhs);
  const index0 = terms.findIndex((t) => contains(t, radical));
  if (index0 < 0) return null;
  const radicalTerm = terms[index0]!;
  const others = terms.filter((_, i) => i !== index0);

  if (others.length > 0) {
    const moved = others.map(negate);
    const rhsTerms = [...termsOf(current.rhs), ...moved];
    const next = rel("=", radicalTerm, rhsTerms.length === 1 ? rhsTerms[0]! : add(rhsTerms));
    steps.push(
      rewriteStep("ISOLATE_RADICAL", current, next, {
        terms: others.map((t) => toLatex(t)).join(" and "),
      }),
    );
    const folded = run(next, expressionRules, {});
    steps.push(...folded.steps);
    if (folded.node.type !== "rel") return null;
    current = folded.node;
  }

  const { coeff, rest } = splitCoefficient(current.lhs);
  if (rest.length !== 1) return null;
  if (!coeff.isOne()) {
    const next = rel("=", rest[0]!, div(current.rhs, num(coeff)));
    steps.push(rewriteStep("DIVIDE_BOTH_SIDES", current, next, { by: coeff.toLatex() }));
    const folded = run(next, expressionRules, {});
    steps.push(...folded.steps);
    if (folded.node.type !== "rel") return null;
    current = folded.node;
  }

  // Re-find rather than compare against the node we started with: tidying the
  // right-hand side rebuilds the tree, so only identity inside `current` holds.
  const isolated = radicalsIn(current, variable);
  if (isolated.length !== 1 || current.lhs !== isolated[0]) return null;
  const index = radicalDegree(isolated[0]!);
  const radicand = isolated[0]!.args[0];
  if (index === null || !radicand) return null;

  const powered = rel("=", radicand, pow(current.rhs, num(Rational.of(index))));
  steps.push(
    displayStep(
      index === 2n ? "SQUARE_BOTH_SIDES" : "RAISE_BOTH_SIDES",
      toLatex(current),
      toLatex(powered),
      current,
      { index: index.toString(), side: toLatex(current.rhs) },
    ),
  );

  const solved = finish(powered, variable);
  steps.push(...solved.steps);
  if (solved.answers.length === 0) {
    return { ...solved, steps, verified: solved.verified };
  }
  if (solved.values.some((v) => !Number.isFinite(v))) return null;

  const kept: string[] = [];
  const keptValues: number[] = [];
  const rejected: string[] = [];
  solved.answers.forEach((answer, i) => {
    const value = solved.values[i]!;
    if (checkSolution(equation, variable, value) === "ok") {
      kept.push(answer);
      keptValues.push(value);
    } else rejected.push(answer);
  });

  const survivors = kept.join(" \\quad \\text{or} \\quad ");
  steps.push(
    displayStep(
      rejected.length > 0 ? "CHECK_EXTRANEOUS" : "CHECK_NO_EXTRANEOUS",
      toLatex(equation),
      kept.length > 0 ? survivors : "\\text{no solution}",
      equation,
      {
        kept: kept.join(" and ") || "none",
        rejected: rejected.join(" and "),
        candidates: solved.answers.join(" and "),
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
          note: `${rejected.join(" and ")} ${
            rejected.length === 1 ? "does" : "do"
          } not satisfy the original equation, so ${
            rejected.length === 1 ? "it is" : "they are"
          } extraneous.`,
        }
      : {}),
    verified: solved.verified && steps.every((s) => !s.unverified),
  };
}
