import {
  asLimit, containsDiff, countLimits, evaluateNumeric, firstLimit, freeSymbols,
  type LimitParts, type MathNode, toLatex,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { explain } from "./explain.js";
import { formLatex, indeterminateForm } from "./rules/limit.js";
import { limitRules } from "./rules/index.js";
import { type Solution, type Step, UnsupportedProblemError } from "./types.js";
import { verifyLimit } from "./verify.js";

/**
 * Limits.
 *
 * The rules do the rewriting; what happens here is the reasoning around them.
 * A student needs to be told *why* substitution was not the end of it, so the
 * indeterminate form that direct substitution runs into is announced as a step
 * of its own before any rewriting starts. And a limit the rules could not finish
 * is refused: an expression with a `lim` still standing in the middle of it is
 * not an answer, and printing it would be the same as printing the question back.
 */

/** How many times l'Hopital's rule may be applied to one problem. */
const LHOPITAL_BUDGET = 4;

/** Enough steps for a couple of rounds of l'Hopital plus the tidying after. */
const MAX_LIMIT_STEPS = 40;

function displayStep(
  ruleId: string,
  before: string,
  after: string,
  beforeNode: MathNode,
  vars: Record<string, string> = {},
): Step {
  const wording = explain(ruleId, vars);
  return {
    ruleId,
    title: wording.title,
    explanation: wording.text,
    before,
    after,
    beforeNode,
    display: true,
    changes: [],
  };
}

/**
 * Why a limit that would not resolve has no value, when that can be said with
 * confidence.
 *
 * Only asked once the rules have failed *and* the function is unbounded near the
 * point, so the sampling is choosing the wording for a divergence that is
 * already established, not deciding whether one happened. Where the two sides
 * run off in opposite directions that is worth saying, because "the two sides
 * disagree" is the whole reason the limit does not exist.
 */
function divergence(l: LimitParts): string | null {
  const at = evaluateNumeric(l.point);
  if (!Number.isFinite(at)) return null;
  const f = (x: number) => evaluateNumeric(l.body, { [l.variable]: x });
  const near = (direction: 1 | -1) => {
    const step = Math.max(1, Math.abs(at));
    const values = [1e-2, 1e-4, 1e-6].map((h) => f(at + direction * h * step));
    if (values.some((v) => !Number.isFinite(v))) return null;
    for (let i = 1; i < values.length; i++) {
      if (Math.abs(values[i]!) <= Math.abs(values[i - 1]!)) return null;
    }
    const last = values[values.length - 1]!;
    return Math.abs(last) > 1e4 ? Math.sign(last) : null;
  };

  if (l.side !== "both") {
    return near(l.side === "right" ? 1 : -1) === null
      ? null
      : `${toLatex(l.body)} grows without bound as ${l.variable} approaches ${toLatex(l.point)}, so there is no limit.`;
  }
  const right = near(1);
  const left = near(-1);
  if (right === null || left === null) return null;
  return right === left
    ? `${toLatex(l.body)} grows without bound on both sides, so there is no limit.`
    : `The two sides disagree: ${l.variable} approaching ${toLatex(l.point)} from the left and from the right send the expression in opposite directions, so the limit does not exist.`;
}

const DOES_NOT_EXIST = "\\text{does not exist}";

/** Work out a limit, or decline it. */
export function solveLimit(node: MathNode): Solution {
  const problem = toLatex(node);
  if (node.type === "rel") {
    throw new UnsupportedProblemError("equations containing a limit are not supported yet");
  }
  if (countLimits(node) > 1) {
    throw new UnsupportedProblemError("nested limits are not supported yet");
  }
  const top = firstLimit(node);
  const l = top ? asLimit(top) : null;
  if (!l) throw new UnsupportedProblemError("could not tell what the limit is of");

  const variable = l.variable;
  const others = [...freeSymbols(node)].filter((s) => s !== variable).sort();
  const other = others[0];
  if (other !== undefined) {
    throw new UnsupportedProblemError(
      `${other} is neither a number nor the variable of this limit, so this problem is not supported yet`,
    );
  }

  const steps: Step[] = [];
  const form = indeterminateForm(l);
  if (form) {
    steps.push(
      displayStep("LIMIT_INDETERMINATE", problem, formLatex(form), node, {
        form: formLatex(form),
        variable,
        point: toLatex(l.point),
      }),
    );
  }

  const result = run(node, limitRules, {
    variable,
    lhopital: { used: 0, max: LHOPITAL_BUDGET },
  }, { maxSteps: MAX_LIMIT_STEPS });
  steps.push(...result.steps);

  const leftover = firstLimit(result.node);
  if (leftover) {
    const stuck = asLimit(leftover);
    const reason = stuck ? divergence(stuck) : null;
    if (stuck && reason) {
      steps.push(
        displayStep("LIMIT_DOES_NOT_EXIST", toLatex(result.node), DOES_NOT_EXIST, result.node, {
          variable,
          point: toLatex(stuck.point),
        }),
      );
      return {
        kind: "limit",
        problem,
        variable,
        answer: DOES_NOT_EXIST,
        answers: [],
        steps,
        verified: steps.every((s) => !s.unverified),
        note: reason,
      };
    }
    throw new UnsupportedProblemError(
      `this limit is not supported yet: ${toLatex(stuck ? stuck.body : leftover)} is more than the rules here can settle as ${variable} approaches ${toLatex(stuck ? stuck.point : leftover)}`,
    );
  }
  if (containsDiff(result.node)) {
    throw new UnsupportedProblemError(
      "l'Hopital's rule left a derivative this engine cannot take, so the limit is not supported yet",
    );
  }

  const answer = toLatex(result.node);
  const numeric = verifyLimit(node, result.node);
  return {
    kind: "limit",
    problem,
    variable,
    answer,
    answers: [answer],
    steps,
    // "mismatch" is a real disagreement and must fail. "unknown" means the
    // limit could not be measured at all, which is common precisely where
    // l'Hopital is used: (1-cos x)/x^2 loses every significant digit to
    // cancellation walking in towards 0 and comes back NaN. Each step has
    // been checked on its own, l'Hopital structurally and the rest by
    // sampling, so the chain is the evidence when the measurement is silent.
    verified: steps.every((s) => !s.unverified) && numeric !== "mismatch",
    ...(result.incomplete ? { incomplete: true } : {}),
  };
}
