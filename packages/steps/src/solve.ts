import {
  add, asDiff, asIntegral, containsDiff, containsIntegral, evaluateNumeric,
  firstDiff, firstIntegral, freeSymbols, hasDivisionByZero, integral, type MathNode, neg,
  num, parseLatex, Rational, rel, substituteSymbol, sym, symbols, toLatex, walk,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { explain } from "./explain.js";
import { normalize } from "./normalize.js";
import { chooseVariable } from "./rules/equation.js";
import {
  allRules, differentiationRules, expressionRules, integrationRules,
} from "./rules/index.js";
import { coeff, degree, relationDegree } from "./poly.js";
import { polynomialOf, solveQuadratic } from "./quadratic.js";
import { type Solution, type Step, UnsupportedProblemError } from "./types.js";
import {
  checkSolution, verifyDerivative, verifyEquivalent, verifyIntegrationStep,
} from "./verify.js";

export type ProblemKind =
  | "simplify" | "evaluate" | "solve" | "differentiate" | "integrate";

export interface Classification {
  kind: ProblemKind;
  variable?: string;
  degree?: number;
}

/** Decide what kind of problem this is before trying to solve it. */
export function classify(node: MathNode): Classification {
  // An integral anywhere makes this an integration problem. It is checked first
  // because an integrand may contain a derivative, and the integral is the
  // outer question in that case.
  if (containsIntegral(node)) {
    const top = firstIntegral(node);
    const parts = top ? asIntegral(top) : null;
    return { kind: "integrate", ...(parts ? { variable: parts.variable } : {}) };
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

/** The symbol standing for the constant of integration. */
const INTEGRATION_CONSTANT = "C";

/**
 * Integration by parts and partial fractions both split one integral into
 * several, so the ceiling has to be higher than the algebra needs. It is still a
 * ceiling: an expression that has not settled by here is reported as incomplete
 * rather than shown half-finished.
 */
const MAX_INTEGRATION_STEPS = 120;

/** Points the interval is checked on before a definite integral is evaluated. */
const POLE_SAMPLES = 257;

/**
 * Is the integrand undefined anywhere between the limits?
 *
 * Two things are looked for: a point where the integrand itself has no value,
 * and a denominator that changes sign, which is a pole the grid may have
 * stepped straight over. Either one makes the integral improper, and an
 * improper integral is a limit problem this engine does not do — reporting a
 * number for it would be reporting a wrong number.
 */
function undefinedBetween(body: MathNode, v: string, from: number, to: number): string | null {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const denominators: MathNode[] = [];
  walk(body, (n) => {
    if (n.type === "div") denominators.push(n.den);
    if (n.type === "pow" && n.exp.type === "num" && n.exp.value.isNegative()) {
      denominators.push(n.base);
    }
  });

  let previous: number[] = [];
  for (let i = 0; i <= POLE_SAMPLES; i++) {
    const at = low + ((high - low) * i) / POLE_SAMPLES;
    if (!Number.isFinite(evaluateNumeric(body, { [v]: at }))) {
      return `the integrand has no value at ${v} = ${Number(at.toFixed(6))}, which is inside the interval, so this integral is improper`;
    }
    const values = denominators.map((d) => evaluateNumeric(d, { [v]: at }));
    for (let j = 0; j < values.length; j++) {
      const before = previous[j];
      const now = values[j];
      if (
        before !== undefined && now !== undefined &&
        Number.isFinite(before) && Number.isFinite(now) && before * now < 0
      ) {
        return "the integrand has a pole between the limits, so this integral is improper";
      }
    }
    previous = values;
  }
  return null;
}

/**
 * Run the integration rules until no integral is left standing.
 *
 * A surviving integral node is an integral this engine cannot do. The answer
 * would be partly unevaluated, which is worse than no answer, so it is refused
 * with the piece it got stuck on named.
 */
function findAntiderivative(
  node: MathNode,
  variable: string,
): { node: MathNode; steps: Step[]; incomplete: boolean } {
  const result = run(node, integrationRules, { variable }, { maxSteps: MAX_INTEGRATION_STEPS });
  const leftover = firstIntegral(result.node);
  if (leftover) {
    const inner = leftover.args[0];
    throw new UnsupportedProblemError(
      `the integral of ${inner ? toLatex(inner) : "that"} is not supported yet`,
    );
  }
  if (containsDiff(result.node)) {
    throw new UnsupportedProblemError("this contains a derivative the engine cannot take");
  }
  return { node: result.node, steps: result.steps, incomplete: result.incomplete };
}

function indefiniteIntegral(node: MathNode, variable: string): Solution {
  const problem = toLatex(node);
  const found = findAntiderivative(node, variable);
  const checked = verifyIntegrationStep(node, found.node, variable);

  // The constant goes on once, at the end. Putting it on an intermediate step
  // would carry it through the rest of the working for no reason.
  const withConstant = add([found.node, sym(INTEGRATION_CONSTANT)]);
  const answer = toLatex(withConstant);
  const steps = [
    ...found.steps,
    finalStep("INT_ADD_CONSTANT", toLatex(found.node), answer, found.node),
  ];

  return {
    kind: "integrate",
    problem,
    variable,
    answer,
    answers: [answer],
    steps,
    verified: stepsVerified(steps) && checked === "ok",
    ...(found.incomplete ? { incomplete: true } : {}),
  };
}

/**
 * A definite integral: find the antiderivative, then evaluate it at both limits
 * and subtract.
 *
 * The limits are set aside for the middle of the working and brought back for
 * the last line, which is how it is written on paper. Substituting a number for
 * the variable is exact by construction, so the step is not sampled; what is
 * checked instead is the number at the end, against numeric quadrature of the
 * original integral, which is an independent measurement of the same area.
 */
function definiteIntegral(
  node: MathNode,
  body: MathNode,
  variable: string,
  limits: { lower: MathNode; upper: MathNode },
): Solution {
  const problem = toLatex(node);
  const from = evaluateNumeric(limits.lower);
  const to = evaluateNumeric(limits.upper);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new UnsupportedProblemError("the limits of this integral are not numbers");
  }
  const improper = undefinedBetween(body, variable, from, to);
  if (improper) throw new UnsupportedProblemError(improper);

  const indefinite = integral(body, sym(variable));
  const steps: Step[] = [
    finalStep("INT_DEFINITE_SETUP", problem, toLatex(indefinite), node, {
      lower: toLatex(limits.lower),
      upper: toLatex(limits.upper),
    }),
  ];

  const found = findAntiderivative(indefinite, variable);
  steps.push(...found.steps);

  const difference = normalize(
    add([
      substituteSymbol(found.node, variable, limits.upper),
      neg(substituteSymbol(found.node, variable, limits.lower)),
    ]),
  );
  steps.push({
    ...finalStep("INT_EVALUATE_LIMITS", toLatex(found.node), toLatex(difference), found.node, {
      lower: toLatex(limits.lower),
      upper: toLatex(limits.upper),
    }),
    display: false,
    changes: [{ kind: "replace", fromIds: [found.node.id], toIds: [difference.id] }],
  });

  const evaluated = run(difference, expressionRules, {}, { maxSteps: MAX_INTEGRATION_STEPS });
  steps.push(...evaluated.steps);

  const answer = toLatex(evaluated.node);
  return {
    kind: "integrate",
    problem,
    variable,
    answer,
    answers: [answer],
    steps,
    verified: stepsVerified(steps) && verifyEquivalent(node, evaluated.node) === "ok",
    ...(found.incomplete || evaluated.incomplete ? { incomplete: true } : {}),
  };
}

/**
 * Integrate.
 *
 * The refusals matter as much as the rules. A second letter is ambiguous in
 * exactly the way it is for a derivative, so it is declined rather than guessed
 * at. A definite integral has to be the whole problem, because the limits belong
 * to one integral and carrying them through an expression would be inventing
 * notation. And an integral the rules cannot finish is refused by
 * `findAntiderivative` with the piece it stalled on named.
 */
function integrate(node: MathNode): Solution {
  if (node.type === "rel") {
    throw new UnsupportedProblemError(
      "equations containing an integral are not supported yet",
    );
  }
  const top = firstIntegral(node);
  const parts = top ? asIntegral(top) : null;
  if (!parts) throw new UnsupportedProblemError("could not tell what to integrate");
  const variable = parts.variable;

  const others = [...freeSymbols(node)].filter((s) => s !== variable).sort();
  const other = others[0];
  if (other !== undefined) {
    throw new UnsupportedProblemError(
      `${other} could be a constant or another function of ${variable}, and this integral cannot be read either way`,
    );
  }

  let nestedDefinite = false;
  walk(node, (n) => {
    const inner = asIntegral(n);
    if (inner?.bounds && n !== top) nestedDefinite = true;
  });
  if (nestedDefinite || (parts.bounds && top !== node)) {
    throw new UnsupportedProblemError(
      "a definite integral has to be the whole problem, not part of a larger expression",
    );
  }

  return parts.bounds
    ? definiteIntegral(node, parts.body, variable, parts.bounds)
    : indefiniteIntegral(node, variable);
}

/** Solve or simplify an already-parsed expression. */
export function solveNode(node: MathNode): Solution {
  if (hasDivisionByZero(node)) {
    throw new UnsupportedProblemError("this divides by zero, so it has no value");
  }
  const c = classify(node);
  const solution =
    c.kind === "solve" ? solveEquation(node)
    : c.kind === "differentiate" ? differentiate(node)
    : c.kind === "integrate" ? integrate(node)
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
