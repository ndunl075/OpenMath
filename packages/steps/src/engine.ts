import {
  children, containsIntegral, type MathNode, type Path, replaceAt, toLatex,
} from "@openmath/math-core";
import { normalize } from "./normalize.js";
import { explain } from "./explain.js";
import type { Rule, RuleContext, RuleResult, Step } from "./types.js";
import { verifyEquationEquivalent, verifyEquivalent, verifyIntegrationStep } from "./verify.js";

interface Application {
  path: Path;
  result: RuleResult;
}

/** Every node, deepest first, so the innermost simplification happens first. */
function postOrder(root: MathNode): Array<{ node: MathNode; path: Path }> {
  const out: Array<{ node: MathNode; path: Path }> = [];
  const visit = (n: MathNode, path: Path) => {
    children(n).forEach((c, i) => visit(c, [...path, i]));
    out.push({ node: n, path });
  };
  visit(root, []);
  return out;
}

function findApplication(
  root: MathNode,
  rule: Rule,
  ctx: RuleContext,
  accept: (candidate: MathNode) => boolean,
): { application: Application; next: MathNode } | null {
  for (const { node, path } of postOrder(root)) {
    let result: RuleResult | null = null;
    try {
      result = rule.apply(node, ctx);
    } catch {
      result = null;
    }
    if (!result) continue;
    const next = normalize(replaceAt(root, path, result.node));
    if (!accept(next)) continue;
    return { application: { path, result }, next };
  }
  return null;
}

export interface RunOptions {
  maxSteps?: number;
  /** Skip verification. Only used by tests that deliberately feed a bad rule. */
  verify?: boolean;
}

export interface RunResult {
  node: MathNode;
  steps: Step[];
  /** True when the engine hit its step ceiling instead of settling. */
  incomplete: boolean;
}

/**
 * Apply rules in priority order until nothing changes.
 *
 * Two guards keep the loop honest: a candidate whose LaTeX matches the current
 * expression is rejected (no empty step cards), and any expression already seen
 * in this run is rejected (no rule ping-pong).
 */
export function run(
  start: MathNode,
  rules: Rule[],
  ctx: RuleContext = {},
  options: RunOptions = {},
): RunResult {
  const maxSteps = options.maxSteps ?? 60;
  const shouldVerify = options.verify ?? true;

  let current = normalize(start);
  const steps: Step[] = [];
  const seen = new Set<string>([toLatex(current)]);

  for (let i = 0; i < maxSteps; i++) {
    let applied = false;
    for (const rule of rules) {
      const currentLatex = toLatex(current);
      const found = findApplication(current, rule, ctx, (candidate) => {
        const latex = toLatex(candidate);
        return latex !== currentLatex && !seen.has(latex);
      });
      if (!found) continue;

      const { result } = found.application;
      const wording = explain(result.explanationKey ?? rule.id, result.vars ?? {});
      const step: Step = {
        ruleId: rule.id,
        title: wording.title,
        explanation: wording.text,
        before: currentLatex,
        after: toLatex(found.next),
        beforeNode: current,
        afterNode: found.next,
        changes: result.changes,
      };

      if (shouldVerify) {
        // An unevaluated integral has no single value to sample, so a step that
        // still contains one is checked by differentiating both sides first.
        const verdict =
          current.type === "rel" && found.next.type === "rel"
            ? verifyEquationEquivalent(current, found.next)
            : containsIntegral(current) || containsIntegral(found.next)
              ? verifyIntegrationStep(current, found.next, ctx.variable)
              : verifyEquivalent(current, found.next);
        if (verdict !== "ok") step.unverified = true;
      }

      steps.push(step);
      seen.add(step.after);
      current = found.next;
      applied = true;
      break;
    }
    if (!applied) return { node: current, steps, incomplete: false };
  }
  return { node: current, steps, incomplete: true };
}
