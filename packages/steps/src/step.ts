import { type MathNode, toLatex } from "@openmath/math-core";
import { explain } from "./explain.js";
import type { Step } from "./types.js";
import { verifyEquationEquivalent, verifyEquivalent } from "./verify.js";

/**
 * Step builders for the solvers that generate a whole chain of working at once
 * (the quadratic formula, the rational root theorem, a radical equation) rather
 * than one rewrite at a time through the rule engine.
 *
 * `displayStep` is for a line that is not an equation rewrite at all: writing
 * out a formula, listing candidate roots, squaring both sides. Nothing is
 * verified because there is nothing to compare; the guarantee for those chains
 * is the substitution check at the end.
 *
 * `rewriteStep` is for a line that *is* an equivalence, so it carries the after
 * tree for the animation layer and is checked the same way the engine checks
 * its own steps. A failure marks the step, which hides the whole step list.
 */

export function displayStep(
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

export function rewriteStep(
  ruleId: string,
  beforeNode: MathNode,
  afterNode: MathNode,
  vars: Record<string, string> = {},
): Step {
  const wording = explain(ruleId, vars);
  const verdict =
    beforeNode.type === "rel" && afterNode.type === "rel"
      ? verifyEquationEquivalent(beforeNode, afterNode)
      : verifyEquivalent(beforeNode, afterNode);
  return {
    ruleId,
    title: wording.title,
    explanation: wording.text,
    before: toLatex(beforeNode),
    after: toLatex(afterNode),
    beforeNode,
    afterNode,
    changes: [{ kind: "replace", fromIds: [beforeNode.id], toIds: [afterNode.id] }],
    ...(verdict === "ok" ? {} : { unverified: true }),
  };
}
