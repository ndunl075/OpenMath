import {
  add, evaluateExact, evaluateNumeric, fn, type MathNode, neg, num, Rational, rel,
  type Relation, symbols, toLatex, walk,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { between, joinAlternatives, openAbove, openBelow, renderInterval } from "./interval.js";
import { coeff, degree, type Poly, toPolynomial } from "./poly.js";
import { coefficientsToNode } from "./polysolve.js";
import { expressionRules, isolationRules } from "./rules/index.js";
import { displayStep, rewriteStep } from "./step.js";
import type { Finish, Interval, Resolved, Step } from "./types.js";

/**
 * Absolute value equations, and inequalities of both kinds.
 *
 * An inequality answer is a piece of the number line rather than a value, so
 * these are the solvers that produce `intervals`. |u| < c becomes one range and
 * |u| > c becomes two, and a quadratic is read off its roots: between them the
 * parabola sits on one side of the axis, outside them on the other.
 */

type Rel = Extract<MathNode, { type: "rel" }>;

const CLOSED: Record<string, boolean> = { "<=": true, ">=": true, "<": false, ">": false };

function hasVariable(n: MathNode, variable: string): boolean {
  return symbols(n).has(variable);
}

function absoluteValuesIn(n: MathNode, variable: string): MathNode[] {
  const out: MathNode[] = [];
  walk(n, (x) => {
    if (x.type === "fn" && x.name === "abs" && x.args[0] && hasVariable(x.args[0], variable)) {
      out.push(x);
    }
  });
  return out;
}

export function isAbsoluteValueProblem(n: MathNode, variable: string): boolean {
  return n.type === "rel" && absoluteValuesIn(n, variable).length > 0;
}

/** Simplify a constructed expression without recording the working. */
function tidy(n: MathNode): MathNode {
  return run(n, expressionRules, {}, { verify: false }).node;
}

function intervalsResolved(
  steps: Step[],
  intervals: Interval[],
  variable: string,
  note?: string,
): Resolved {
  const answers = intervals.map((i) => renderInterval(i, variable));
  return {
    steps,
    answers,
    values: answers.map(() => NaN),
    answer: joinAlternatives(answers),
    intervals,
    ...(note ? { note } : {}),
    verified: steps.every((s) => !s.unverified),
  };
}

function emptyResolved(steps: Step[], note: string): Resolved {
  return {
    steps,
    answers: [],
    values: [],
    answer: "\\text{no solution}",
    note,
    verified: steps.every((s) => !s.unverified),
  };
}

function everyValueResolved(steps: Step[], variable: string, note: string): Resolved {
  return {
    steps,
    answers: [],
    values: [],
    answer: `\\text{every value of } ${variable}`,
    intervals: [{}],
    note,
    verified: steps.every((s) => !s.unverified),
  };
}

/** a x + b, read off a linear expression. */
function linearParts(n: MathNode, variable: string): { a: Rational; b: Rational } | null {
  const p = toPolynomial(n, variable);
  if (!p || degree(p) !== 1) return null;
  return { a: coeff(p, 1), b: coeff(p, 0) };
}

/** Where a x + b crosses the value k. */
function crossing(a: Rational, b: Rational, k: Rational): Rational {
  return k.sub(b).div(a);
}

export function solveAbsoluteValueProblem(
  equation: MathNode,
  variable: string,
  finish: Finish,
): Resolved | null {
  if (equation.type !== "rel") return null;
  if (absoluteValuesIn(equation, variable).length !== 1) return null;

  const steps: Step[] = [];
  const isolated = run(equation, isolationRules, { variable });
  steps.push(...isolated.steps);
  if (isolated.node.type !== "rel") return null;
  let current: Rel = isolated.node;

  // The bars have to end up alone on the left; swapping an inequality would
  // also have to turn it round, and that is a different rule than this one.
  if (!(current.lhs.type === "fn" && current.lhs.name === "abs")) {
    if (current.rel !== "=") return null;
    if (!(current.rhs.type === "fn" && current.rhs.name === "abs")) return null;
    const swapped = rel("=", current.rhs, current.lhs, current.id) as Rel;
    steps.push(rewriteStep("SWAP_SIDES", current, swapped));
    current = swapped;
  }
  const inner = current.lhs.type === "fn" ? current.lhs.args[0] : undefined;
  if (!inner || hasVariable(current.rhs, variable)) return null;

  const bound = evaluateExact(current.rhs);
  if (!bound) return null;
  const closed = CLOSED[current.rel] ?? false;
  const negated = num(bound.neg());

  if (current.rel === "=") {
    if (bound.isNegative()) {
      return emptyResolved(
        [
          ...steps,
          displayStep("ABSOLUTE_NEVER_NEGATIVE", toLatex(current), "\\text{no solution}", current, {
            value: bound.toLatex(),
          }),
        ],
        "An absolute value is never negative, so this equation has no solution.",
      );
    }
    const branches = bound.isZero()
      ? [rel("=", inner, num(Rational.ZERO))]
      : [rel("=", inner, current.rhs), rel("=", inner, negated)];
    steps.push(
      displayStep(
        "SPLIT_ABSOLUTE_VALUE",
        toLatex(current),
        branches.map((b) => toLatex(b)).join(" \\quad \\text{or} \\quad "),
        current,
        { inner: toLatex(inner), value: bound.toLatex() },
      ),
    );
    const answers: string[] = [];
    const values: number[] = [];
    let verified = true;
    for (const branch of branches) {
      const solved = finish(branch, variable);
      steps.push(...solved.steps);
      verified = verified && solved.verified;
      solved.answers.forEach((a, i) => {
        if (answers.includes(a)) return;
        answers.push(a);
        values.push(solved.values[i] ?? NaN);
      });
    }
    const order = values.map((_, i) => i).sort((i, j) => (values[i]! - values[j]!));
    return {
      steps,
      answers: order.map((i) => answers[i]!),
      values: order.map((i) => values[i]!),
      verified,
    };
  }

  const parts = linearParts(inner, variable);
  // |x^2 - 1| < 3 needs the two quadratic inequalities solved separately, which
  // is past what this covers; a linear inside is the school case.
  if (!parts) return null;
  const { a, b } = parts;
  const lessThan = current.rel === "<" || current.rel === "<=";

  if (lessThan) {
    if (bound.isNegative() || (bound.isZero() && !closed)) {
      return emptyResolved(
        [
          ...steps,
          displayStep("ABSOLUTE_NEVER_NEGATIVE", toLatex(current), "\\text{no solution}", current, {
            value: bound.toLatex(),
          }),
        ],
        "An absolute value is never negative, so nothing satisfies this.",
      );
    }
    const op = closed ? "\\le" : "<";
    const compound = `${toLatex(negated)} ${op} ${toLatex(inner)} ${op} ${toLatex(current.rhs)}`;
    steps.push(
      displayStep("ABSOLUTE_LESS_THAN", toLatex(current), compound, current, {
        inner: toLatex(inner),
        value: bound.toLatex(),
      }),
    );
    const first = crossing(a, b, bound.neg());
    const second = crossing(a, b, bound);
    const [low, high] = first.cmp(second) <= 0 ? [first, second] : [second, first];
    const interval = between(num(low), num(high), closed);
    const answer = renderInterval(interval, variable);
    if (answer !== compound) {
      steps.push(
        displayStep("SOLVE_COMPOUND_INEQUALITY", compound, answer, current, {
          variable,
        }),
      );
    }
    return intervalsResolved(steps, [interval], variable);
  }

  if (bound.isNegative() || (bound.isZero() && closed)) {
    return everyValueResolved(
      [
        ...steps,
        displayStep(
          "ABSOLUTE_ALWAYS_GREATER",
          toLatex(current),
          `\\text{every value of } ${variable}`,
          current,
          { value: bound.toLatex() },
        ),
      ],
      variable,
      "An absolute value is never negative, so every value works.",
    );
  }

  const split = `${toLatex(inner)} ${closed ? "\\le" : "<"} ${toLatex(negated)} \\quad \\text{or} \\quad ${toLatex(inner)} ${closed ? "\\ge" : ">"} ${toLatex(current.rhs)}`;
  steps.push(
    displayStep("ABSOLUTE_GREATER_THAN", toLatex(current), split, current, {
      inner: toLatex(inner),
      value: bound.toLatex(),
    }),
  );
  const first = crossing(a, b, bound.neg());
  const second = crossing(a, b, bound);
  const [low, high] = first.cmp(second) <= 0 ? [first, second] : [second, first];
  const intervals = [openBelow(num(low), closed), openAbove(num(high), closed)];
  const answer = joinAlternatives(intervals.map((i) => renderInterval(i, variable)));
  if (answer !== split) {
    steps.push(displayStep("SOLVE_COMPOUND_INEQUALITY", split, answer, current, { variable }));
  }
  return intervalsResolved(steps, intervals, variable);
}

/** The two places a x^2 + b x + c is zero, kept exact. */
function quadraticRoots(
  a: Rational,
  b: Rational,
  c: Rational,
): { low: MathNode; high: MathNode; equal: boolean } | null {
  const discriminant = b.mul(b).sub(Rational.of(4).mul(a).mul(c));
  if (discriminant.isNegative()) return null;
  const exact = discriminant.nthRoot(2n);
  const twoA = Rational.of(2).mul(a);
  if (exact) {
    const r1 = b.neg().add(exact).div(twoA);
    const r2 = b.neg().sub(exact).div(twoA);
    const [low, high] = r1.cmp(r2) <= 0 ? [r1, r2] : [r2, r1];
    return { low: num(low), high: num(high), equal: r1.equals(r2) };
  }
  const radical = fn("sqrt", [num(discriminant)]);
  const build = (sign: 1 | -1): MathNode =>
    tidy({
      type: "div",
      id: -1,
      num: add([num(b.neg()), sign === 1 ? radical : neg(radical)]),
      den: num(twoA),
    });
  const plus = build(1);
  const minus = build(-1);
  return evaluateNumeric(minus) <= evaluateNumeric(plus)
    ? { low: minus, high: plus, equal: false }
    : { low: plus, high: minus, equal: false };
}

/**
 * x^2 - 5x + 6 > 0 and friends. The equation rules have already brought
 * everything to the left, so this reads the sign off the roots.
 */
export function solveQuadraticInequality(
  equation: MathNode,
  variable: string,
  poly: Poly,
): Resolved | null {
  if (equation.type !== "rel" || equation.rel === "=") return null;
  if (degree(poly) !== 2) return null;

  const steps: Step[] = [];
  let current: Rel = equation;
  let a = coeff(poly, 2);
  let b = coeff(poly, 1);
  let c = coeff(poly, 0);

  if (a.isNegative()) {
    // Multiplying by -1 turns the inequality round; leaving the negative
    // leading coefficient in place is how sign errors happen.
    const flip: Record<string, Relation> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
    a = a.neg();
    b = b.neg();
    c = c.neg();
    const next = rel(
      flip[current.rel] ?? current.rel,
      coefficientsToNode([c, b, a], variable),
      num(Rational.ZERO),
    ) as Rel;
    steps.push(rewriteStep("MULTIPLY_BY_NEGATIVE", current, next, { by: "-1" }));
    current = next;
  }

  const closed = CLOSED[current.rel] ?? false;
  const greater = current.rel === ">" || current.rel === ">=";
  const roots = quadraticRoots(a, b, c);

  if (!roots) {
    // The parabola never touches the axis, and it opens upwards.
    const note = greater
      ? "The expression is positive everywhere, so every value works."
      : "The expression is positive everywhere, so nothing satisfies this.";
    const step = displayStep(
      greater ? "INEQUALITY_ALWAYS_TRUE" : "INEQUALITY_NEVER_TRUE",
      toLatex(current),
      greater ? `\\text{every value of } ${variable}` : "\\text{no solution}",
      current,
    );
    return greater
      ? everyValueResolved([...steps, step], variable, note)
      : emptyResolved([...steps, step], note);
  }

  const rootsLatex = roots.equal
    ? `${variable} = ${toLatex(roots.low)}`
    : `${variable} = ${toLatex(roots.low)} \\quad \\text{or} \\quad ${variable} = ${toLatex(roots.high)}`;
  steps.push(
    displayStep("INEQUALITY_CRITICAL_POINTS", toLatex(current), rootsLatex, current, {
      roots: roots.equal
        ? toLatex(roots.low)
        : `${toLatex(roots.low)} and ${toLatex(roots.high)}`,
    }),
  );

  if (roots.equal) {
    // A repeated root: the parabola only touches the axis, at that one point.
    if (greater && closed) {
      return everyValueResolved(
        [
          ...steps,
          displayStep(
            "INEQUALITY_ALWAYS_TRUE",
            toLatex(current),
            `\\text{every value of } ${variable}`,
            current,
          ),
        ],
        variable,
        "The expression is a square, so it is never negative.",
      );
    }
    if (greater) {
      const intervals = [openBelow(roots.low, false), openAbove(roots.high, false)];
      return finishIntervals(steps, intervals, variable, current);
    }
    if (closed) {
      // The one point where it touches is the whole answer, and the step above
      // has already named it; a second step would only repeat it.
      return intervalsResolved(steps, [between(roots.low, roots.high, true)], variable);
    }
    return emptyResolved(
      [
        ...steps,
        displayStep("INEQUALITY_NEVER_TRUE", toLatex(current), "\\text{no solution}", current),
      ],
      "The expression is a square, so it is never negative.",
    );
  }

  const intervals = greater
    ? [openBelow(roots.low, closed), openAbove(roots.high, closed)]
    : [between(roots.low, roots.high, closed)];
  return finishIntervals(steps, intervals, variable, current);
}

function finishIntervals(
  steps: Step[],
  intervals: Interval[],
  variable: string,
  current: MathNode,
): Resolved {
  const answers = intervals.map((i) => renderInterval(i, variable));
  const answer = joinAlternatives(answers);
  steps.push(
    displayStep("INEQUALITY_TEST_INTERVALS", toLatex(current), answer, current, {
      answer,
    }),
  );
  return intervalsResolved(steps, intervals, variable);
}
