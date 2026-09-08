import {
  asDiff, asLimit, containsDiff, containsInfinity, containsLimit, evaluateNumeric,
  firstDiff, firstLimit, freeSymbols, hasDivisionByZero, key, type MathNode, num,
  parseLatex, Rational, rel, splitCoefficient, sym, symbols, toLatex,
  undefinedReason, walk,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { explain } from "./explain.js";
import {
  isExponentialEquation, isLogarithmicEquation, solveExponentialEquation,
  solveLogarithmicEquation,
} from "./explog.js";
import {
  isAbsoluteValueProblem, solveAbsoluteValueProblem, solveQuadraticInequality,
} from "./inequality.js";
import { solveLimit } from "./limit.js";
import { chooseVariable } from "./rules/equation.js";
import { allRules, differentiationRules, expressionRules, factorRules } from "./rules/index.js";
import { coeff, degree, relationDegree } from "./poly.js";
import { solveByRationalRoots } from "./polysolve.js";
import { polynomialOf, solveQuadratic } from "./quadratic.js";
import { isRadicalEquation, solveRadicalEquation } from "./radical.js";
import { displayStep } from "./step.js";
import {
  type Finish, type Resolved, type Solution, type Step, UnsupportedProblemError,
} from "./types.js";
import { checkSolution, verifyDerivative } from "./verify.js";

export type ProblemKind =
  | "simplify"
  | "evaluate"
  | "solve"
  | "differentiate"
  | "factor"
  | "limit";

export interface Classification {
  kind: ProblemKind;
  variable?: string;
  degree?: number;
}

function containsSum(n: MathNode): boolean {
  let found = false;
  walk(n, (x) => {
    if (x.type === "add") found = true;
  });
  return found;
}

/**
 * The variable part of a single term, as a comparable string: 3x^2y and -x^2y
 * share one. Null when the term is not a monomial at all, which a fraction, a
 * function call or a bracket all are.
 */
function monomialKey(n: MathNode): string | null {
  if (containsSum(n)) return null;
  const { rest } = splitCoefficient(n);
  const parts: string[] = [];
  for (const r of rest) {
    if (r.type === "sym") parts.push(key(r));
    else if (
      r.type === "pow" && r.base.type === "sym" &&
      r.exp.type === "num" && r.exp.value.isInteger() && !r.exp.value.isNegative()
    ) {
      parts.push(key(r));
    } else return null;
  }
  return parts.sort().join("*");
}

/**
 * Is this expression one to *factor* rather than one to simplify?
 *
 * Factoring and expanding undo each other, so the two cannot both be rules in
 * one pipeline: whichever ran first would decide the answer, and running them
 * together would loop. The shape of what the student wrote settles it instead,
 * once, here. A product, or a power of a bracket, is written that way because
 * the exercise is to multiply it out. A polynomial already written term by
 * term, with its like terms collected, is written that way because the exercise
 * is to put it back into factors. Anything else — two variables, a fraction,
 * terms still waiting to be combined — is an ordinary simplification.
 *
 * The two directions then run in separate rule sets (`expressionRules` and
 * `factorRules`), neither of which contains a rule that could undo the other,
 * so there is no cycle for the engine's seen-set to have to catch.
 */
export function isFactoringProblem(n: MathNode): boolean {
  if (n.type !== "add" || n.args.length < 2) return false;
  const seen = new Set<string>();
  let hasVariableTerm = false;
  for (const term of n.args) {
    const k = monomialKey(term);
    if (k === null || seen.has(k)) return false;
    if (k !== "") hasVariableTerm = true;
    seen.add(k);
  }
  return hasVariableTerm;
}

/** Decide what kind of problem this is before trying to solve it. */
export function classify(node: MathNode): Classification {
  // A limit anywhere makes this a limit problem, and it is checked before the
  // derivative because l'Hopital's rule puts derivatives inside limits.
  if (containsLimit(node)) {
    const top = firstLimit(node);
    const l = top ? asLimit(top) : null;
    return { kind: "limit", ...(l ? { variable: l.variable } : {}) };
  }
  // A derivative anywhere makes this a differentiation problem, equals sign or
  // not; `differentiate` is what refuses the equation form with a real reason.
  if (containsDiff(node)) {
    const top = firstDiff(node);
    const d = top ? asDiff(top) : null;
    return { kind: "differentiate", ...(d ? { variable: d.variable } : {}) };
  }
  if (node.type === "rel") {
    const variable = chooseVariable(node);
    const deg = variable ? relationDegree(node, variable) ?? undefined : undefined;
    return { kind: "solve", ...(variable ? { variable } : {}), ...(deg !== undefined ? { degree: deg } : {}) };
  }
  const vars = [...freeSymbols(node)];
  if (vars.length === 0) return { kind: "evaluate" };
  if (isFactoringProblem(node)) return { kind: "factor", variable: vars[0]! };
  return { kind: "simplify" };
}

/** Matches the ceiling in polysolve; past it the working stops being readable. */
const MAX_SOLVABLE_DEGREE = 6;

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

/**
 * Factor an expression.
 *
 * Nothing factoring is not a failure: x^2 + 1 does not come apart over the
 * rationals, and the honest answer is the expression itself. That case falls
 * back to the ordinary simplification, and reports that kind, rather than
 * claiming to have factored something.
 */
function factorExpression(node: MathNode): Solution {
  const problem = toLatex(node);
  const result = run(node, factorRules, {});
  if (result.steps.length === 0) return simplify(node, "simplify");
  const answer = toLatex(result.node);
  return {
    kind: "factor",
    problem,
    answer,
    answers: [answer],
    steps: result.steps,
    verified: stepsVerified(result.steps),
    ...(result.incomplete ? { incomplete: true } : {}),
  };
}

/**
 * Solve an equation that is polynomial in the variable, or already isolated.
 * Every specialised solver funnels back into this once it has reduced its
 * problem to an ordinary one.
 */
function solvePolynomialForm(node: MathNode, variable: string): Resolved {
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
      displayStep(ruleId, toLatex(current), holds ? "\\text{true for every } " + variable : "\\text{no solution}", current),
    );
    return {
      steps,
      answers: [],
      values: [],
      answer: holds ? `\\text{every value of } ${variable}` : "\\text{no solution}",
      note: wording.text,
      verified: stepsVerified(steps),
    };
  }

  if (deg === 2) {
    if (!poly) throw new UnsupportedProblemError("this quadratic is out of scope");
    if (current.rel !== "=") {
      const solved = solveQuadraticInequality(current, variable, poly);
      if (!solved) throw new UnsupportedProblemError("could not solve this quadratic inequality");
      return { ...solved, steps: [...steps, ...solved.steps] };
    }
    const q = solveQuadratic(current, variable, poly);
    if (!q) throw new UnsupportedProblemError("could not read the quadratic coefficients");
    steps.push(...q.steps);
    const verifiedRoots = q.answerValues.every(
      (v) => Number.isFinite(v) && checkSolution(node, variable, v) !== "mismatch",
    );
    return {
      steps,
      answers: q.answers,
      values: q.answerValues,
      ...(q.answers.length === 0 ? { answer: "\\text{no real solutions}" } : {}),
      ...(q.note ? { note: q.note } : {}),
      verified: stepsVerified(steps) && verifiedRoots,
    };
  }

  if (deg !== null && deg > 2) {
    if (current.rel !== "=") {
      throw new UnsupportedProblemError(`inequalities of degree ${deg} are not supported yet`);
    }
    if (!poly || deg > MAX_SOLVABLE_DEGREE) {
      throw new UnsupportedProblemError(
        `equations of degree ${deg} are past what this solver does`,
      );
    }
    const higher = solveByRationalRoots(current, variable, poly);
    if (!higher) {
      throw new UnsupportedProblemError(
        `this degree ${deg} equation has no rational root, so it cannot be solved by factoring`,
      );
    }
    steps.push(...higher.steps);
    const verifiedRoots = higher.answerValues.every(
      (v) => Number.isFinite(v) && checkSolution(node, variable, v) !== "mismatch",
    );
    return {
      steps,
      answers: higher.answers,
      values: higher.answerValues,
      ...(higher.answers.length === 0 ? { answer: "\\text{no real solutions}" } : {}),
      ...(higher.note ? { note: higher.note } : {}),
      verified: stepsVerified(steps) && verifiedRoots,
    };
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
      displayStep("DIVIDE_BOTH_SIDES", toLatex(current), toLatex(finished), current, {
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

  const linear: Resolved = {
    steps,
    answers: [statement],
    values: [answerValue],
    verified: stepsVerified(steps) && verifiedRoot,
    ...(result.incomplete ? { incomplete: true } : {}),
  };
  if (current.rel === "=") return linear;
  // A linear inequality is a half-line. It reads the same either way, but
  // saying so structurally means every inequality answer has the same shape.
  const closed = current.rel === "<=" || current.rel === ">=";
  const bound = { value: current.rhs, closed };
  const upper = current.rel === "<" || current.rel === "<=";
  return { ...linear, intervals: [upper ? { upper: bound } : { lower: bound }] };
}

interface Shape {
  label: string;
  solve: () => Resolved | null;
}

/**
 * Equations that are not polynomial and need a method of their own. Each solver
 * reduces the problem to an ordinary equation, hands it back to
 * `solvePolynomialForm`, and then checks what comes out against the original.
 */
function specialShape(node: MathNode, variable: string): Shape | null {
  const finish: Finish = (n, v) => solvePolynomialForm(n, v);
  if (isAbsoluteValueProblem(node, variable)) {
    return {
      label: "absolute value",
      solve: () => solveAbsoluteValueProblem(node, variable, finish),
    };
  }
  if (isRadicalEquation(node, variable)) {
    return { label: "radical", solve: () => solveRadicalEquation(node, variable, finish) };
  }
  if (isLogarithmicEquation(node, variable)) {
    return {
      label: "logarithmic",
      solve: () => solveLogarithmicEquation(node, variable, finish),
    };
  }
  if (isExponentialEquation(node, variable)) {
    return {
      label: "exponential",
      solve: () => solveExponentialEquation(node, variable, finish),
    };
  }
  return null;
}

function toSolution(problem: string, variable: string, r: Resolved): Solution {
  const joined = r.answers.join(" \\quad \\text{or} \\quad ");
  return {
    kind: "solve",
    problem,
    variable,
    answer: r.answer ?? (joined || "\\text{no solution}"),
    answers: r.answers,
    ...(r.intervals ? { intervals: r.intervals } : {}),
    steps: r.steps,
    verified: r.verified && stepsVerified(r.steps),
    ...(r.note ? { note: r.note } : {}),
    ...(r.incomplete ? { incomplete: true } : {}),
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
      steps: [displayStep(ruleId, problem, holds ? "\\text{true}" : "\\text{false}", node)],
      verified: true,
      note: wording.text,
    };
  }

  const shape = specialShape(node, variable);
  if (shape) {
    // Declining rather than falling through: the ordinary rules would rearrange
    // a radical or a logarithm into something they cannot finish, and report a
    // half-solved answer as though it were the whole one.
    const solved = shape.solve();
    if (!solved) {
      throw new UnsupportedProblemError(
        `${shape.label} equations of this shape are not supported yet`,
      );
    }
    return toSolution(problem, variable, solved);
  }

  return toSolution(problem, variable, solvePolynomialForm(node, variable));
}

/**
 * Differentiate.
 *
 * Two refusals matter more than anything the rules do. A second letter is
 * ambiguous: in d/dx(a x^2), `a` reads as a constant, but in d/dx(y) written by
 * a student doing implicit differentiation, `y` is a function of x, and the two
 * readings give different answers. Guessing would produce a confidently wrong
 * result, so the problem is declined instead. And any d/dv node still standing
 * once the rules have run is a derivative this engine does not know; the answer
 * would be partly unevaluated, which is worse than no answer at all.
 */
function differentiate(node: MathNode): Solution {
  const problem = toLatex(node);
  if (node.type === "rel") {
    throw new UnsupportedProblemError(
      "equations containing a derivative are not supported yet",
    );
  }

  const top = firstDiff(node);
  const d = top ? asDiff(top) : null;
  if (!d) {
    throw new UnsupportedProblemError("could not tell what to differentiate");
  }
  const variable = d.variable;

  const others = [...freeSymbols(node)].filter((sm) => sm !== variable).sort();
  const other = others[0];
  if (other !== undefined) {
    throw new UnsupportedProblemError(
      `${other} could be a constant or a function of ${variable}, and implicit differentiation is not supported yet`,
    );
  }

  const result = run(node, differentiationRules, { variable });

  const leftover = firstDiff(result.node);
  if (leftover) {
    const inner = leftover.args[0];
    throw new UnsupportedProblemError(
      `the derivative of ${inner ? toLatex(inner) : "that"} is not supported yet`,
    );
  }

  const answer = toLatex(result.node);
  const numeric = verifyDerivative(node, result.node, variable);
  return {
    kind: "differentiate",
    problem,
    variable,
    answer,
    answers: [answer],
    steps: result.steps,
    verified: stepsVerified(result.steps) && numeric === "ok",
    ...(result.incomplete ? { incomplete: true } : {}),
  };
}

/** Solve or simplify an already-parsed expression. */
export function solveNode(node: MathNode): Solution {
  if (hasDivisionByZero(node)) {
    throw new UnsupportedProblemError("this divides by zero, so it has no value");
  }
  // \tan(\pi/2) and \ln(0) are not hard problems, they are problems with no
  // answer. Echoing one back as though it were its own solution is worse than
  // saying so.
  const undefinedInput = undefinedReason(node);
  if (undefinedInput) throw new UnsupportedProblemError(undefinedInput);

  const c = classify(node);
  // Infinity is a place a limit heads towards, not a quantity to compute with,
  // so it is refused everywhere else rather than folded into arithmetic.
  if (c.kind !== "limit" && containsInfinity(node)) {
    throw new UnsupportedProblemError(
      "infinity is only supported as the point a limit approaches",
    );
  }
  const solution =
    c.kind === "limit" ? solveLimit(node)
    : c.kind === "solve" ? solveEquation(node)
    : c.kind === "differentiate" ? differentiate(node)
    : c.kind === "factor" ? factorExpression(node)
    : simplify(node, c.kind);

  // Cancelling terms can produce a zero denominator the problem did not start
  // with, as in 1/(x-x). Reporting that as an answer is worse than declining.
  const undefinedResult = (latex: string) => /\\frac\{[^{}]*\}\{0\}/.test(latex);
  if (undefinedResult(solution.answer) || solution.answers.some(undefinedResult)) {
    throw new UnsupportedProblemError("this works out to a division by zero, so it has no value");
  }
  return solution;
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
