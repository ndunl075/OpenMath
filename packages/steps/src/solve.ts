import {
  evaluateNumeric, type MathNode, num, parseLatex, Rational, rel, sym, symbols, toLatex,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { explain } from "./explain.js";
import { chooseVariable } from "./rules/equation.js";
import { allRules, expressionRules } from "./rules/index.js";
import { coeff, degree, relationDegree } from "./poly.js";
import { polynomialOf, solveQuadratic } from "./quadratic.js";
import { type Solution, type Step, UnsupportedProblemError } from "./types.js";
import { checkSolution } from "./verify.js";

export type ProblemKind = "simplify" | "evaluate" | "solve";

export interface Classification {
  kind: ProblemKind;
  variable?: string;
  degree?: number;
}

/** Decide what kind of problem this is before trying to solve it. */
export function classify(node: MathNode): Classification {
  if (node.type === "rel") {
    const variable = chooseVariable(node);
    const deg = variable ? relationDegree(node, variable) ?? undefined : undefined;
    return { kind: "solve", ...(variable ? { variable } : {}), ...(deg !== undefined ? { degree: deg } : {}) };
  }
  const vars = [...symbols(node)].filter((s) => s !== "pi");
  return vars.length === 0 ? { kind: "evaluate" } : { kind: "simplify" };
}

function stepsVerified(steps: Step[]): boolean {
  return steps.every((s) => !s.unverified);
}

function simplify(node: MathNode, kind: "simplify" | "evaluate"): Solution {
  const problem = toLatex(node);
  const result = run(node, expressionRules, {});
  const answer = toLatex(result.node);
  return {
    kind,
    problem,
    answer,
    answers: [answer],
    steps: result.steps,
    verified: stepsVerified(result.steps),
    ...(result.incomplete ? { incomplete: true } : {}),
  };
}

function finalStep(
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

function solveEquation(node: MathNode): Solution {
  const problem = toLatex(node);
  const variable = chooseVariable(node);

  // A closed numeric claim like 2 + 2 = 5.
  if (!variable) {
    if (node.type !== "rel") throw new UnsupportedProblemError("not an equation");
    const l = evaluateNumeric(node.lhs);
    const r = evaluateNumeric(node.rhs);
    const holds = Number.isFinite(l) && Number.isFinite(r) && Math.abs(l - r) < 1e-9;
    const ruleId = holds ? "IDENTITY_TRUE" : "IDENTITY_FALSE";
    const wording = explain(ruleId);
    return {
      kind: "solve",
      problem,
      answer: holds ? "\\text{true}" : "\\text{false}",
      answers: [],
      steps: [finalStep(ruleId, problem, holds ? "\\text{true}" : "\\text{false}", node)],
      verified: true,
      note: wording.text,
    };
  }

  const result = run(node, allRules, { variable });
  const steps = [...result.steps];
  const settled = result.node;

  if (settled.type !== "rel") {
    throw new UnsupportedProblemError("the equation collapsed into an expression");
  }
  let current: Extract<MathNode, { type: "rel" }> = settled;

  const poly = polynomialOf(current, variable);
  const deg = poly ? degree(poly) : relationDegree(current, variable);

  // Degenerate: the variable cancelled out entirely.
  if (poly && deg !== null && deg <= 0) {
    const constant = coeff(poly, 0);
    const holds = constant.isZero();
    const ruleId = holds ? "IDENTITY_TRUE" : "IDENTITY_FALSE";
    const wording = explain(ruleId);
    steps.push(
      finalStep(ruleId, toLatex(current), holds ? "\\text{true for every } " + variable : "\\text{no solution}", current),
    );
    return {
      kind: "solve",
      problem,
      variable,
      answer: holds ? `\\text{every value of } ${variable}` : "\\text{no solution}",
      answers: [],
      steps,
      verified: stepsVerified(steps),
      note: wording.text,
    };
  }

  if (deg === 2) {
    if (!poly) throw new UnsupportedProblemError("this quadratic is out of scope");
    if (current.rel !== "=") {
      throw new UnsupportedProblemError("quadratic inequalities are not supported yet");
    }
    const q = solveQuadratic(current, variable, poly);
    if (!q) throw new UnsupportedProblemError("could not read the quadratic coefficients");
    steps.push(...q.steps);
    const verifiedRoots = q.answerValues.every(
      (v) => Number.isFinite(v) && checkSolution(node, variable, v) !== "mismatch",
    );
    return {
      kind: "solve",
      problem,
      variable,
      answer: q.answers.join(" \\quad \\text{or} \\quad ") || "\\text{no real solutions}",
      answers: q.answers,
      steps,
      verified: stepsVerified(steps) && verifiedRoots,
      ...(q.note ? { note: q.note } : {}),
    };
  }

  if (deg !== null && deg > 2) {
    throw new UnsupportedProblemError(
      `equations of degree ${deg} are not supported yet`,
    );
  }

  // Linear. The rules normally land on `x = value`; this is the safety net.
  const solved =
    current.lhs.type === "sym" &&
    current.lhs.name === variable &&
    !symbols(current.rhs).has(variable);

  if (!solved) {
    if (!poly || degree(poly) !== 1) {
      throw new UnsupportedProblemError("could not isolate the variable");
    }
    const a = coeff(poly, 1);
    const b = coeff(poly, 0);
    const value = b.neg().div(a);
    const finished = rel(current.rel, sym(variable), num(value));
    steps.push(
      finalStep("DIVIDE_BOTH_SIDES", toLatex(current), toLatex(finished), current, {
        by: a.toLatex(),
      }),
    );
    if (finished.type === "rel") current = finished;
  }

  const answerLatex = toLatex(current.rhs);
  const answerValue = evaluateNumeric(current.rhs);
  const verifiedRoot =
    !Number.isFinite(answerValue) ||
    current.rel !== "=" ||
    checkSolution(node, variable, answerValue) !== "mismatch";

  const relSymbol =
    current.rel === "<=" ? "\\le" : current.rel === ">=" ? "\\ge" : current.rel;
  const statement = `${variable} ${relSymbol} ${answerLatex}`;

  return {
    kind: "solve",
    problem,
    variable,
    answer: statement,
    answers: [statement],
    steps,
    verified: stepsVerified(steps) && verifiedRoot,
    ...(result.incomplete ? { incomplete: true } : {}),
  };
}

/** Solve or simplify an already-parsed expression. */
export function solveNode(node: MathNode): Solution {
  const c = classify(node);
  if (c.kind === "solve") return solveEquation(node);
  return simplify(node, c.kind);
}

/** Parse LaTeX and solve it. Throws ParseError or UnsupportedProblemError. */
export function solve(latex: string): Solution {
  return solveNode(parseLatex(latex));
}

/** Non-throwing wrapper for the UI. */
export type SolveOutcome =
  | { ok: true; solution: Solution }
  | { ok: false; reason: "parse" | "unsupported" | "error"; message: string };

export function trySolve(latex: string): SolveOutcome {
  try {
    return { ok: true, solution: solve(latex) };
  } catch (e) {
    if (e instanceof UnsupportedProblemError) {
      return { ok: false, reason: "unsupported", message: e.message };
    }
    if (e instanceof Error && e.name === "ParseError") {
      return { ok: false, reason: "parse", message: e.message };
    }
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export { Rational };
