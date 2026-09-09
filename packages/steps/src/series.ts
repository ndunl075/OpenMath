import {
  add, asSummation, cloneFresh, definiteIntegral as makeDefiniteIntegral, div,
  evaluateExact, evaluateNumeric, isConstantSymbol, limitNumerically,
  type MathNode, num, Rational, substitute, sym, symbols, toLatex,
} from "@openmath/math-core";
import { run } from "./engine.js";
import { normalize } from "./normalize.js";
import { expressionRules } from "./rules/index.js";
import { coeff, degree, toPolynomial } from "./poly.js";
import { displayStep } from "./step.js";
import { type Solution, type Step, UnsupportedProblemError } from "./types.js";

/**
 * Sequences and series.
 *
 * Two different questions live here and they want different answers. A finite
 * sum, or a series with a closed form, has a *value*. Everything else has a
 * *verdict*: converges or diverges, and by which test. A Calc 2 course spends
 * far more time on the second than the first, so the tests are the substance
 * of this file and the closed forms are the smaller part.
 *
 * Every verdict names the test that produced it, because "converges" on its
 * own is not an answer to a question that asks which test settles it.
 */

const MAX_LISTED_TERMS = 6;

/** The nth term with a number in place of the index. */
function termAt(body: MathNode, index: string, k: number): MathNode {
  return normalize(substitute(cloneFresh(body), index, num(Rational.of(k))));
}

function valueAt(body: MathNode, index: string, k: number): number {
  return evaluateNumeric(body, { [index]: k });
}

/** An exact rational value for a node, or null when it is not one. */
function exactValue(n: MathNode): Rational | null {
  return evaluateExact(n);
}

// ------------------------------------------------------------------ geometric

interface Geometric {
  /** The constant multiplier in front. */
  scale: Rational;
  /** The common ratio. */
  ratio: Rational;
}

/**
 * Read `a * r^n` — the only shape whose sum has a closed form a course expects.
 *
 * Measured rather than pattern-matched: a geometric sequence is exactly one
 * whose successive ratio is constant, so that is what is checked, at several
 * places, and the ratio read off. It catches 3/4^n and 2^(n+1)/5^n alike
 * without a case for each.
 */
function asGeometric(body: MathNode, index: string, from: number): Geometric | null {
  const first = valueAt(body, index, from);
  if (!Number.isFinite(first) || first === 0) return null;

  let ratio: number | null = null;
  for (let k = from; k < from + 6; k++) {
    const a = valueAt(body, index, k);
    const b = valueAt(body, index, k + 1);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
    const r = b / a;
    if (ratio === null) ratio = r;
    else if (Math.abs(r - ratio) > 1e-9 * Math.max(1, Math.abs(ratio))) return null;
  }
  if (ratio === null) return null;

  // The ratio and the leading term have to be exact for the sum to be exact.
  const exactRatio = exactValue(div(termAt(body, index, from + 1), termAt(body, index, from)));
  const exactFirst = exactValue(termAt(body, index, from));
  if (!exactRatio || !exactFirst) return null;
  if (Math.abs(exactRatio.toNumber() - ratio) > 1e-9) return null;
  return { scale: exactFirst, ratio: exactRatio };
}

// -------------------------------------------------------------------- p-series

/** `1/n^p`, returning p. Also reads a constant multiple of it. */
function asPSeries(body: MathNode, index: string): Rational | null {
  const stripped = body.type === "mul"
    ? body.args.filter((a) => symbols(a).has(index))
    : [body];
  if (stripped.length !== 1) return null;
  const core = stripped[0]!;

  // 1/n^p
  if (core.type === "div") {
    const top = core.num;
    if (top.type !== "num") return null;
    const bottom = core.den;
    if (bottom.type === "sym" && bottom.name === index) return Rational.ONE;
    if (bottom.type === "pow" && bottom.base.type === "sym" && bottom.base.name === index) {
      return bottom.exp.type === "num" ? bottom.exp.value : null;
    }
    if (bottom.type === "fn" && bottom.name === "sqrt") {
      const inner = bottom.args[0];
      if (inner && inner.type === "sym" && inner.name === index) return Rational.of(1, 2);
    }
    return null;
  }
  // n^-p
  if (core.type === "pow" && core.base.type === "sym" && core.base.name === index) {
    if (core.exp.type !== "num") return null;
    const p = core.exp.value.neg();
    return p.isNegative() || p.isZero() ? null : p;
  }
  return null;
}

// ------------------------------------------------------------------ the tests

/**
 * Where the terms are heading, measured with the same extrapolation the limit
 * engine uses. Null when it cannot be measured.
 *
 * Extrapolated rather than simply read far out, because a term like n/(n+1)
 * is still visibly short of its limit at n = a million, and comparing raw
 * values there says "not settled" about a sequence that plainly settles.
 */
function termLimit(body: MathNode, index: string): number | null {
  const at = limitNumerically((k) => valueAt(body, index, Math.round(k)), Infinity);
  return Number.isFinite(at) ? at : null;
}

/**
 * A ladder of indices to sample at, doubling. Doubling rather than a fixed
 * spread because a factorial runs out of double before n = 200: n! passes the
 * largest double at 171, so 1/n! reads as exactly 0 past that and a ratio
 * taken there is meaningless.
 */
const RATIO_LADDER = [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240];

type RatioVerdict =
  | { kind: "settles"; L: number }
  | { kind: "below" }
  | { kind: "above" }
  | { kind: "unknown" };

/**
 * What the ratio test can say about |a(n+1)/a(n)|.
 *
 * Three ways to reach a verdict, and the last two matter more than they look.
 * A settled value is the easy case. Failing that, a sequence of ratios that
 * *decreases* while staying below 1 has a limit no larger than its smallest
 * member, so the limit is below 1 and the series converges — which is how
 * sum 1/n! is settled, since its ratios march off towards 0 and never settle
 * anywhere. Increasing while staying above 1 is the mirror image.
 *
 * Increasing while staying *below* 1 deliberately says nothing: that is what
 * sum 1/n does, and its ratios approach 1 from underneath while the series
 * diverges. Reading "all the ratios are below 1" as convergence would get
 * that exactly wrong.
 */
function ratioTest(body: MathNode, index: string): RatioVerdict {
  const ratios: number[] = [];
  for (const k of RATIO_LADDER) {
    const a = valueAt(body, index, k);
    const b = valueAt(body, index, k + 1);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) continue;
    ratios.push(Math.abs(b / a));
  }
  if (ratios.length < 3) return { kind: "unknown" };

  const tail = ratios.slice(-3);
  const last = tail[tail.length - 1]!;
  const settled = tail.every((r) => Math.abs(r - last) <= 1e-3 * Math.max(1, Math.abs(last)));
  if (settled) return { kind: "settles", L: last };

  const decreasing = ratios.every((r, i) => i === 0 || r <= ratios[i - 1]! + 1e-12);
  if (decreasing && ratios.every((r) => r < 1 - 1e-6)) return { kind: "below" };

  const increasing = ratios.every((r, i) => i === 0 || r >= ratios[i - 1]! - 1e-12);
  if (increasing && ratios.every((r) => r > 1 + 1e-6)) return { kind: "above" };

  return { kind: "unknown" };
}

/** Does the sign alternate from term to term? */
function alternates(body: MathNode, index: string, from: number): boolean {
  let previous: number | null = null;
  for (let k = from; k < from + 8; k++) {
    const v = valueAt(body, index, k);
    if (!Number.isFinite(v) || v === 0) return false;
    if (previous !== null && Math.sign(v) === Math.sign(previous)) return false;
    previous = v;
  }
  return true;
}

/** Do the magnitudes shrink, as the alternating series test requires? */
function magnitudesDecrease(body: MathNode, index: string, from: number): boolean {
  let previous: number | null = null;
  for (let k = from; k < from + 30; k++) {
    const v = Math.abs(valueAt(body, index, k));
    if (!Number.isFinite(v)) return false;
    if (previous !== null && v > previous + 1e-12) return false;
    previous = v;
  }
  return true;
}

// ------------------------------------------------------------- the entry point

export function solveSeries(node: MathNode): Solution {
  const problem = toLatex(node);
  const parts = asSummation(node);
  if (!parts) throw new UnsupportedProblemError("could not tell what is being summed");

  const free = [...symbols(parts.body)]
    .filter((s) => s !== parts.index && !isConstantSymbol(s));
  if (free.length > 0) {
    throw new UnsupportedProblemError(
      `this sum still contains ${free[0]}, so it has no single value`,
    );
  }

  const fromExact = exactValue(parts.from);
  if (!fromExact || !fromExact.isInteger()) {
    throw new UnsupportedProblemError("the index has to start at a whole number");
  }
  const from = Number(fromExact.toNumber());

  return parts.infinite
    ? infiniteSeries(node, problem, parts.body, parts.index, from)
    : finiteSum(node, problem, parts, from);
}

// ------------------------------------------------------------------ finite sums

function finiteSum(
  node: MathNode,
  problem: string,
  parts: NonNullable<ReturnType<typeof asSummation>>,
  from: number,
): Solution {
  const toExact = exactValue(parts.to);
  if (!toExact || !toExact.isInteger()) {
    throw new UnsupportedProblemError("the index has to stop at a whole number");
  }
  const to = Number(toExact.toNumber());
  if (to < from) {
    return {
      kind: "series", problem, answer: "0", answers: ["0"], steps: [],
      verified: true, note: "The sum is empty, so it is zero.",
    };
  }
  if (to - from > 500) {
    throw new UnsupportedProblemError("that is too many terms to add out");
  }

  const steps: Step[] = [];
  const count = to - from + 1;

  // Write the terms out when there are few enough to read.
  if (count <= MAX_LISTED_TERMS) {
    const written = add(
      Array.from({ length: count }, (_, i) => termAt(parts.body, parts.index, from + i)),
    );
    steps.push(displayStep("SUM_WRITE_OUT", problem, toLatex(written), node, {
      index: parts.index, from: String(from), to: String(to),
    }));
    const evaluated = run(written, expressionRules, {}, { maxSteps: 60 });
    steps.push(...evaluated.steps);
    const answer = toLatex(evaluated.node);
    return {
      kind: "series", problem, answer, answers: [answer], steps,
      verified: steps.every((s) => !s.unverified) && matchesNumerically(node, evaluated.node),
    };
  }

  // Too many to write out: add them exactly, and say so.
  let total = Rational.ZERO;
  for (let k = from; k <= to; k++) {
    const value = exactValue(termAt(parts.body, parts.index, k));
    if (!value) throw new UnsupportedProblemError("a term of this sum is not an exact number");
    total = total.add(value);
  }
  const result = num(total);
  steps.push(displayStep("SUM_ADD_TERMS", problem, toLatex(result), node, {
    count: String(count), index: parts.index,
  }));
  const answer = toLatex(result);
  return {
    kind: "series", problem, answer, answers: [answer], steps,
    verified: matchesNumerically(node, result),
  };
}

function matchesNumerically(problem: MathNode, answer: MathNode): boolean {
  const a = evaluateNumeric(problem);
  const b = evaluateNumeric(answer);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

// -------------------------------------------------------------- infinite series

function verdict(
  node: MathNode,
  problem: string,
  steps: Step[],
  answer: string,
  note: string,
): Solution {
  return {
    kind: "series", problem, answer, answers: [answer], steps,
    verified: steps.every((s) => !s.unverified), note,
  };
}

function infiniteSeries(
  node: MathNode,
  problem: string,
  body: MathNode,
  index: string,
  from: number,
): Solution {
  const steps: Step[] = [];

  // 1. The nth-term test. It is first because it is the cheapest thing that
  //    can settle the question, and a course teaches it first for that reason.
  const heading = termLimit(body, index);
  if (heading !== null && Math.abs(heading) > 1e-6) {
    steps.push(displayStep("SERIES_NTH_TERM_DIVERGES", problem, "\\text{diverges}", node, {
      index, limit: formatNumber(heading), term: toLatex(body),
    }));
    return verdict(node, problem, steps, "\\text{diverges}",
      "The terms do not approach zero, so the sum cannot settle.");
  }

  // 2. Geometric, which is the one shape with a value rather than a verdict.
  const geometric = asGeometric(body, index, from);
  if (geometric) {
    const r = geometric.ratio;
    const magnitude = Math.abs(r.toNumber());
    if (magnitude >= 1) {
      steps.push(displayStep("SERIES_GEOMETRIC_DIVERGES", problem, "\\text{diverges}", node, {
        ratio: r.toLatex(),
      }));
      return verdict(node, problem, steps, "\\text{diverges}",
        "A geometric series with ratio at least 1 in size grows without bound.");
    }
    const sum = geometric.scale.div(Rational.ONE.sub(r));
    const result = num(sum);
    steps.push(displayStep("SERIES_GEOMETRIC", problem, toLatex(result), node, {
      first: geometric.scale.toLatex(), ratio: r.toLatex(), result: sum.toLatex(),
    }));
    const answer = toLatex(result);
    return {
      kind: "series", problem, answer, answers: [answer], steps,
      verified: matchesNumerically(node, result),
    };
  }

  // 3. p-series, which a course expects to be quoted rather than derived.
  const p = asPSeries(body, index);
  if (p) {
    const converges = p.toNumber() > 1;
    const text = converges ? "\\text{converges}" : "\\text{diverges}";
    steps.push(displayStep("SERIES_P_TEST", problem, text, node, {
      p: p.toLatex(), index,
    }));
    return verdict(node, problem, steps, text, converges
      ? `A p-series converges when p > 1, and here p = ${p.toLatex()}.`
      : `A p-series diverges when p is at most 1, and here p = ${p.toLatex()}.`);
  }

  // 4. The alternating series test, before the ratio test: for an alternating
  //    series the ratio test usually comes back inconclusive, and this does not.
  if (alternates(body, index, from) && magnitudesDecrease(body, index, from)) {
    steps.push(displayStep("SERIES_ALTERNATING", problem, "\\text{converges}", node, { index }));
    return verdict(node, problem, steps, "\\text{converges}",
      "The signs alternate and the terms shrink towards zero, so the partial sums close in on a value.");
  }

  // 5. The ratio test.
  const ratio = ratioTest(body, index);
  const settledAwayFromOne =
    ratio.kind === "settles" && Math.abs(ratio.L - 1) > 1e-3;
  if (settledAwayFromOne || ratio.kind === "below" || ratio.kind === "above") {
    const converges = ratio.kind === "below" ||
      (ratio.kind === "settles" && ratio.L < 1);
    const text = converges ? "\\text{converges}" : "\\text{diverges}";
    steps.push(displayStep("SERIES_RATIO_TEST", problem, text, node, {
      L: ratio.kind === "settles" ? formatNumber(ratio.L) : converges ? "less than 1" : "more than 1",
      index,
    }));
    return verdict(node, problem, steps, text, converges
      ? "Each term is a shrinking fraction of the one before, so the tail dies away fast enough to sum."
      : "Each term outgrows the one before, so the terms cannot approach zero.");
  }

  // 6. Limit comparison against the power that dominates. A rational function
  //    of n behaves like n^(deg top - deg bottom) far out, and comparing with
  //    that power is exactly the textbook move.
  const compared = limitComparison(body, index, from);
  if (compared) {
    const converges = compared.p.toNumber() > 1;
    const text = converges ? "\\text{converges}" : "\\text{diverges}";
    steps.push(displayStep("SERIES_LIMIT_COMPARISON", problem, text, node, {
      index, p: compared.p.toLatex(), L: formatNumber(compared.L),
    }));
    return verdict(node, problem, steps, text, converges
      ? `Far out the terms behave like 1 over ${index} to the power ${compared.p.toLatex()}, and that p-series converges.`
      : `Far out the terms behave like 1 over ${index} to the power ${compared.p.toLatex()}, and that p-series diverges.`);
  }

  // 7. The integral test, last because it is the most work: it hands the
  //    problem to the integration engine and asks whether the area under the
  //    same curve is finite.
  const byIntegral = integralTest(body, index, from);
  if (byIntegral) {
    const text = byIntegral.converges ? "\\text{converges}" : "\\text{diverges}";
    steps.push(displayStep("SERIES_INTEGRAL_TEST", problem, text, node, {
      index, from: String(from), integral: byIntegral.integral,
    }));
    return verdict(node, problem, steps, text, byIntegral.converges
      ? "The terms are positive and shrinking, and the area under the matching curve is finite, so the sum is too."
      : "The terms are positive and shrinking, and the area under the matching curve is infinite, so the sum is too.");
  }

  throw new UnsupportedProblemError(
    "none of the tests here settle this series",
  );
}

/**
 * Compare with the power of n that dominates far out.
 *
 * For a rational function of n the dominant power is the difference of the
 * degrees, and comparing against it turns the question into a p-series, which
 * is settled. The comparison is only valid when the ratio settles somewhere
 * finite and non-zero, so that is measured before the verdict is given.
 */
function limitComparison(
  body: MathNode,
  index: string,
  from: number,
): { p: Rational; L: number } | null {
  if (body.type !== "div") return null;
  const top = toPolynomial(body.num, index);
  const bottom = toPolynomial(body.den, index);
  if (!top || !bottom) return null;
  const p = Rational.of(degree(bottom) - degree(top));
  if (p.isNegative() || p.isZero()) return null;

  // The ratio a(n) / n^-p must settle somewhere finite and non-zero for the
  // comparison to say anything at all.
  const ratio = (k: number): number => valueAt(body, index, k) * Math.pow(k, p.toNumber());
  const L = limitNumerically((k) => ratio(Math.round(k)), Infinity);
  if (!Number.isFinite(L) || Math.abs(L) < 1e-9) return null;

  // Positive terms, which is what the comparison assumes.
  for (let k = from; k < from + 10; k++) {
    const v = valueAt(body, index, k);
    if (!Number.isFinite(v) || v < 0) return null;
  }
  return { p, L };
}

/**
 * The integral test: is the area under the same curve finite?
 *
 * Reuses the integration engine, improper integrals and all, which is the
 * whole reason this test is cheap to offer here. It only applies to terms that
 * are positive and decreasing, so that is checked first rather than assumed.
 */
function integralTest(
  body: MathNode,
  index: string,
  from: number,
): { converges: boolean; integral: string } | null {
  // The test only needs the terms to be *eventually* positive and decreasing,
  // and dropping finitely many terms cannot change whether a series converges.
  // ln(n)/n is the case that matters: it is zero at n = 1 and rises until
  // n = 3 before it starts falling, and demanding good behaviour from the
  // first term would refuse it.
  const start = firstSettledIndex(body, index, from);
  if (start === null) return null;
  const improper = makeDefiniteIntegral(
    cloneFresh(body), sym(index), num(Rational.of(start)), sym("infinity"),
  );
  const latex = toLatex(improper);
  const outcome = trySolveIntegral(improper);
  if (outcome === "unknown") return null;
  return { converges: outcome === "finite", integral: latex };
}

/**
 * The first index from which the terms are positive and decreasing, or null if
 * they are not within a reasonable distance.
 */
function firstSettledIndex(body: MathNode, index: string, from: number): number | null {
  for (let start = Math.max(from, 1); start < Math.max(from, 1) + 20; start++) {
    let good = true;
    for (let k = start; k < start + 30; k++) {
      const a = valueAt(body, index, k);
      const b = valueAt(body, index, k + 1);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b > a + 1e-12) {
        good = false;
        break;
      }
    }
    if (good) return start;
  }
  return null;
}

/**
 * Does this improper integral come to a number, run away, or defeat us?
 *
 * Imported lazily to keep series.ts and solve.ts from importing each other at
 * module load; the two genuinely do depend on one another, since a series test
 * can ask an integral question and the solver routes both.
 */
function trySolveIntegral(node: MathNode): "finite" | "infinite" | "unknown" {
  try {
    const solution = solveNodeRef!(node);
    return Number.isFinite(evaluateNumeric(parseLatexRef!(solution.answer)))
      ? "finite"
      : "unknown";
  } catch (e) {
    if (e instanceof UnsupportedProblemError && /diverges/.test(e.message)) return "infinite";
    return "unknown";
  }
}

/**
 * Set by solve.ts at module load. A plain import would be a cycle: solve.ts
 * routes a summation here, and the integral test asks solve.ts to do an
 * integral.
 */
let solveNodeRef: ((n: MathNode) => Solution) | null = null;
let parseLatexRef: ((s: string) => MathNode) | null = null;

export function connectSeriesToSolver(
  solveNode: (n: MathNode) => Solution,
  parseLatex: (s: string) => MathNode,
): void {
  solveNodeRef = solveNode;
  parseLatexRef = parseLatex;
}

/** A measured quantity, shown to a readable number of places. */
function formatNumber(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 1e6) / 1e6);
}
