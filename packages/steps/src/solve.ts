import {
  add, asDiff, asIntegral, asLimit, asSummation, cloneFresh, containsDiff,
  containsInfinity, containsIntegral, containsLimit, containsSummation,
  definiteIntegral as makeDefiniteIntegral,
  evaluateNumeric, firstDiff, firstIntegral, firstLimit, firstSummation, freeSymbols,
  hasDivisionByZero, integral, isInfinity, key, limit, type MathNode, neg, num,
  parseLatex, Rational, rel, splitCoefficient, substitute, sym, symbols, toLatex,
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
import { connectSeriesToSolver, solveSeries } from "./series.js";
import { solveTaylor } from "./taylor.js";
import { normalize } from "./normalize.js";
import { chooseVariable } from "./rules/equation.js";
import {
  allRules, differentiationRules, expressionRules, factorRules, integrationRules,
} from "./rules/index.js";
import { coeff, degree, relationDegree } from "./poly.js";
import { solveByRationalRoots } from "./polysolve.js";
import { polynomialOf, solveQuadratic } from "./quadratic.js";
import { isRadicalEquation, solveRadicalEquation } from "./radical.js";
import { displayStep } from "./step.js";
import {
  type Finish, type Resolved, type Solution, type Step, UnsupportedProblemError,
} from "./types.js";
import {
  checkSolution, verifyDerivative, verifyEquivalent, verifyIntegrationStep,
} from "./verify.js";

export type ProblemKind =
  | "simplify"
  | "evaluate"
  | "solve"
  | "differentiate"
  | "factor"
  | "limit"
  | "integrate"
  | "series";

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
  // A Taylor expansion is asked for by name, so it is unambiguous and comes
  // first.
  if (node.type === "fn" && node.name === "taylor") {
    const v = node.args[1];
    return { kind: "series", ...(v && v.type === "sym" ? { variable: v.name } : {}) };
  }
  // A summation anywhere makes this a series problem, checked first because a
  // convergence test may put a limit or an integral inside one.
  if (containsSummation(node)) {
    const top = firstSummation(node);
    const parts = top ? asSummation(top) : null;
    return { kind: "series", ...(parts ? { variable: parts.index } : {}) };
  }
  // An integral anywhere makes this an integration problem. It is checked first
  // because an integrand may contain a derivative, and the integral is the
  // outer question in that case.
  if (containsIntegral(node)) {
    const top = firstIntegral(node);
    const parts = top ? asIntegral(top) : null;
    return { kind: "integrate", ...(parts ? { variable: parts.variable } : {}) };
  }
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
    displayStep("INT_ADD_CONSTANT", toLatex(found.node), answer, found.node),
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
  if (isInfinity(limits.lower) || isInfinity(limits.upper)) {
    return improperIntegral(node, body, variable, limits);
  }
  const from = evaluateNumeric(limits.lower);
  const to = evaluateNumeric(limits.upper);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new UnsupportedProblemError("the limits of this integral are not numbers");
  }
  const improper = undefinedBetween(body, variable, from, to);
  if (improper) throw new UnsupportedProblemError(improper);

  const indefinite = integral(body, sym(variable));
  const steps: Step[] = [
    displayStep("INT_DEFINITE_SETUP", problem, toLatex(indefinite), node, {
      lower: toLatex(limits.lower),
      upper: toLatex(limits.upper),
    }),
  ];

  const found = findAntiderivative(indefinite, variable);
  steps.push(...found.steps);

  const difference = normalize(
    add([
      substitute(found.node, variable, limits.upper),
      neg(substitute(found.node, variable, limits.lower)),
    ]),
  );
  steps.push({
    ...displayStep("INT_EVALUATE_LIMITS", toLatex(found.node), toLatex(difference), found.node, {
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
 * An integral with an infinite bound, answered the way it is defined: replace
 * the infinity with a letter, integrate between finite bounds, and see where
 * the result goes as that letter runs off.
 *
 * Nothing new is needed to do this. The antiderivative comes from the same
 * search as any other integral, and where it heads is a question the limit
 * engine already answers, l'Hopital and all. Only one bound may be infinite:
 * an integral infinite at both ends has to be split at a point of the
 * student's choosing, and picking one for them would be putting words in
 * their mouth.
 */
function improperIntegral(
  node: MathNode,
  body: MathNode,
  variable: string,
  limits: { lower: MathNode; upper: MathNode },
): Solution {
  const problem = toLatex(node);
  if (isInfinity(limits.lower) && isInfinity(limits.upper)) {
    throw new UnsupportedProblemError(
      "an integral infinite at both ends has to be split in two first",
    );
  }

  const upperIsInfinite = isInfinity(limits.upper);
  const finiteBound = upperIsInfinite ? limits.lower : limits.upper;
  const infiniteBound = upperIsInfinite ? limits.upper : limits.lower;
  const bound = boundName(body, variable);

  const proper = makeDefiniteIntegral(
    cloneFresh(body),
    sym(variable),
    upperIsInfinite ? cloneFresh(finiteBound) : sym(bound),
    upperIsInfinite ? sym(bound) : cloneFresh(finiteBound),
  );
  const asLimitOfProper = limit(proper, sym(bound), cloneFresh(infiniteBound));

  const steps: Step[] = [
    displayStep("INT_IMPROPER_SETUP", problem, toLatex(asLimitOfProper), node, {
      bound,
      infinite: toLatex(infiniteBound),
      variable,
    }),
  ];

  // The antiderivative first, then the bounds, then where the result heads.
  const indefinite = integral(cloneFresh(body), sym(variable));
  const found = findAntiderivative(indefinite, variable);
  steps.push(...found.steps);

  const upperNode = upperIsInfinite ? sym(bound) : cloneFresh(finiteBound);
  const lowerNode = upperIsInfinite ? cloneFresh(finiteBound) : sym(bound);
  const difference = normalize(
    add([
      substitute(found.node, variable, upperNode),
      neg(substitute(found.node, variable, lowerNode)),
    ]),
  );
  const target = limit(difference, sym(bound), cloneFresh(infiniteBound));
  steps.push({
    ...displayStep("INT_EVALUATE_LIMITS", toLatex(found.node), toLatex(target), found.node, {
      lower: toLatex(lowerNode),
      upper: toLatex(upperNode),
    }),
    display: false,
    changes: [{ kind: "replace", fromIds: [found.node.id], toIds: [target.id] }],
  });

  // A divergent one has no number to report, and "diverges" is the answer a
  // student is after rather than a complaint about the rules. Said here, in
  // the language of the integral, instead of leaving the limit engine to
  // report that it could not settle ln|b|.
  if (divergesAt(difference, bound, isInfinity(infiniteBound) && !upperIsInfinite ? -1 : 1)) {
    throw new UnsupportedProblemError(
      "this integral diverges: the area keeps growing without settling on a value",
    );
  }
  const settled = solveLimit(target);
  steps.push(...settled.steps);

  return {
    kind: "integrate",
    problem,
    variable,
    answer: settled.answer,
    answers: settled.answers,
    steps,
    verified: stepsVerified(steps) && settled.verified,
    ...(found.incomplete || settled.incomplete ? { incomplete: true } : {}),
  };
}

/**
 * Does this keep climbing as the bound runs off, rather than settling?
 *
 * The limit engine reports an unsettled limit as "could not do it", which is
 * the wrong thing to tell someone evaluating an improper integral: for
 * integral 1 to infinity of 1/x, that it diverges *is* the answer.
 */
function divergesAt(expression: MathNode, bound: string, sign: number): boolean {
  // The ladder reaches absurdly far out on purpose. ln(ln b) diverges, and at
  // b = a trillion it has only reached 3.3; anything judging it against a
  // fixed threshold nearer than 1e200 would call it settled and report a
  // finite area under a curve whose area is infinite.
  const magnitudes = [1e3, 1e12, 1e30, 1e80, 1e200].map((t) =>
    Math.abs(evaluateNumeric(expression, { [bound]: sign * t })),
  );
  if (magnitudes.some((m) => Number.isNaN(m))) return false;
  if (magnitudes.some((m) => !Number.isFinite(m))) return true;
  for (let i = 1; i < magnitudes.length; i++) {
    if (magnitudes[i]! <= magnitudes[i - 1]!) return false;
  }
  return magnitudes[magnitudes.length - 1]! > 5;
}

/** An integral whose infinity sits in a bound, where it is allowed to be. */
function isImproperIntegral(node: MathNode): boolean {
  const found = firstIntegral(node);
  if (!found) return false;
  const parts = asIntegral(found);
  if (!parts?.bounds) return false;
  // Only in the bounds. Infinity inside the integrand is still refused.
  return (
    (isInfinity(parts.bounds.lower) || isInfinity(parts.bounds.upper)) &&
    !containsInfinity(parts.body)
  );
}

/** A letter for the moving bound that does not collide with anything in scope. */
function boundName(body: MathNode, variable: string): string {
  const taken = symbols(body);
  for (const candidate of ["b", "t", "R", "M", "N"]) {
    if (candidate !== variable && !taken.has(candidate)) return candidate;
  }
  return "b";
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
  // \tan(\pi/2) and \ln(0) are not hard problems, they are problems with no
  // answer. Echoing one back as though it were its own solution is worse than
  // saying so.
  const undefinedInput = undefinedReason(node);
  if (undefinedInput) throw new UnsupportedProblemError(undefinedInput);

  const c = classify(node);
  // Infinity is a place a limit heads towards, not a quantity to compute with,
  // so it is refused everywhere else rather than folded into arithmetic. The
  // bound of an improper integral is the other place it may legitimately
  // stand, and that is answered by rewriting it as a limit.
  if (
    c.kind !== "limit" && c.kind !== "series" &&
    !isImproperIntegral(node) && containsInfinity(node)
  ) {
    throw new UnsupportedProblemError(
      "infinity is only supported as the point a limit approaches",
    );
  }
  const solution =
    c.kind === "series"
      ? (node.type === "fn" && node.name === "taylor" ? solveTaylor(node) : solveSeries(node))
    : c.kind === "limit" ? solveLimit(node)
    : c.kind === "solve" ? solveEquation(node)
    : c.kind === "differentiate" ? differentiate(node)
    : c.kind === "factor" ? factorExpression(node)
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

// The integral test in series.ts needs to ask for an integral, and this module
// routes summations there. Handing over the two functions here rather than
// importing them the other way keeps the cycle out of module initialisation.
connectSeriesToSolver(solveNode, parseLatex);

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
