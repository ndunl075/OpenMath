import {
  add, asSummation, cloneFresh, definiteIntegral as makeDefiniteIntegral, div,
  evaluateExact, evaluateNumeric, isConstantSymbol, limitNumerically,
  type MathNode, num, Rational, substitute, sym, symbols, toLatex, walk,
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
    // Either one being exactly zero is underflow, not arithmetic: 1/(n*3^n)
    // at n = 641 is smaller than the smallest double, and the ratio 0/a it
    // produces would read as a sequence plunging to zero.
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) continue;
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
  if (free.length > 1) {
    throw new UnsupportedProblemError(
      `this sum contains both ${free[0]} and ${free[1]}, which is more than one unknown`,
    );
  }

  const fromExact = exactValue(parts.from);
  if (!fromExact || !fromExact.isInteger()) {
    throw new UnsupportedProblemError("the index has to start at a whole number");
  }
  const from = Number(fromExact.toNumber());

  // A letter other than the index makes this a power series, and the question
  // is then where it converges rather than what it adds up to.
  const variable = free[0];
  if (variable) {
    if (!parts.infinite) {
      throw new UnsupportedProblemError(
        `this sum still contains ${variable}, so it has no single value`,
      );
    }
    return powerSeries(node, problem, parts.body, parts.index, from, variable);
  }

  return parts.infinite
    ? infiniteSeries(node, problem, parts.body, parts.index, from)
    : finiteSum(node, problem, parts, from);
}

// --------------------------------------------------------------- power series

/**
 * The standard Maclaurin series, recognised by what they add up to.
 *
 * Matched numerically rather than by pattern: a series is this one exactly
 * when it sums to this function, and comparing values at several points
 * settles that without needing a case for every way the terms might be
 * written. It is also self-verifying — a match *is* the check.
 *
 * The other direction, being handed e^x and asked for its series, has no
 * notation to ask it in. A photograph carries mathematics, not the sentence
 * "find the Maclaurin series of", and the keypad has no way to say it either.
 * That limitation is the input model rather than the engine, and it is
 * written down in ARCHITECTURE section 5.1 rather than papered over.
 */
const KNOWN_SERIES: string[] = [
  "e^{x}",
  "\\frac{1}{1 - x}",
  "-\\ln\\left(1 - x\\right)",
  "\\ln\\left(1 + x\\right)",
  "\\sin\\left(x\\right)",
  "\\cos\\left(x\\right)",
  "\\arctan\\left(x\\right)",
  "\\frac{1}{1 + x}",
  "x e^{x}",
];

/** Points comfortably inside every radius above. */
const RECOGNITION_POINTS = [0.17, -0.23, 0.31, -0.08];

function recognise(node: MathNode, variable: string): string | null {
  for (const candidate of KNOWN_SERIES) {
    let parsed: MathNode;
    try {
      parsed = parseLatexRef!(candidate);
    } catch {
      continue;
    }
    // The candidate has to be written in the same letter the series uses.
    const inVariable = variable === "x"
      ? parsed
      : substitute(parsed, "x", sym(variable));

    let compared = 0;
    let agrees = true;
    for (const at of RECOGNITION_POINTS) {
      const summed = evaluateNumeric(node, { [variable]: at });
      const closed = evaluateNumeric(inVariable, { [variable]: at });
      if (!Number.isFinite(summed) || !Number.isFinite(closed)) continue;
      compared++;
      if (Math.abs(summed - closed) > 1e-9 * Math.max(1, Math.abs(closed))) {
        agrees = false;
        break;
      }
    }
    if (agrees && compared >= 3) {
      return variable === "x" ? candidate : toLatex(inVariable);
    }
  }
  return null;
}

/**
 * Where the series is centred: the `a` in (x - a)^n. Zero when the variable
 * appears bare, which is the usual case.
 */
function centreOf(body: MathNode, index: string, variable: string): Rational | null {
  let centre: Rational | null = Rational.ZERO;
  let seen = false;
  walk(body, (n) => {
    if (seen) return;
    if (n.type !== "pow") return;
    if (!(n.exp.type === "sym" && n.exp.name === index)) {
      // Also (x-a)^(n+1) and friends: the exponent only has to involve n.
      if (!symbols(n.exp).has(index)) return;
    }
    const base = n.base;
    if (base.type === "sym" && base.name === variable) {
      centre = Rational.ZERO;
      seen = true;
      return;
    }
    const p = toPolynomial(base, variable);
    if (p && degree(p) === 1 && coeff(p, 1).equals(Rational.ONE)) {
      centre = coeff(p, 0).neg();
      seen = true;
    }
  });
  return seen ? centre : null;
}

/**
 * The radius and interval of convergence.
 *
 * The ratio test does the work, exactly as it does on paper: |a(n+1)/a(n)|
 * tends to |x - a|/R, so measuring it at one point away from the centre gives
 * R. The endpoints are then put back in one at a time and settled by the
 * ordinary tests — which is the half of the question students lose marks on,
 * and the half a radius alone does not answer.
 */
function powerSeries(
  node: MathNode,
  problem: string,
  body: MathNode,
  index: string,
  from: number,
  variable: string,
): Solution {
  // A standard series has a closed form, and that is the better answer — but
  // it is not the whole answer. "Find the sum" and "find the interval of
  // convergence" are both asked of the same series, and a textbook gives both:
  // 1/(1-x) *for |x| < 1*. So the sum leads and the interval follows it.
  const known = recognise(node, variable);

  const centre = centreOf(body, index, variable);
  if (centre === null) {
    throw new UnsupportedProblemError(
      `could not tell where this series in ${variable} is centred`,
    );
  }

  // L is |x - a| / R, so at one unit from the centre it is exactly 1/R.
  const at = centre.toNumber() + 1;
  const sampled: Array<{ n: number; r: number }> = [];
  for (const k of RATIO_LADDER) {
    const a = evaluateNumeric(body, { [index]: k, [variable]: at });
    const b = evaluateNumeric(body, { [index]: k + 1, [variable]: at });
    // Zero here means the term underflowed, not that it vanished. See the
    // note in ratioTest: a ratio of 0/a would make the radius look infinite.
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) continue;
    sampled.push({ n: k, r: Math.abs(b / a) });
  }
  if (sampled.length < 3) {
    throw new UnsupportedProblemError("could not measure the ratio for this series");
  }

  const last = extrapolateRatio(sampled);
  const growing = sampled.every((s, i) => i === 0 || s.r > sampled[i - 1]!.r) &&
    sampled[sampled.length - 1]!.r > 10;
  const shrinking = sampled.every((s, i) => i === 0 || s.r < sampled[i - 1]!.r) &&
    last !== null && last < 1e-3;
  const settled = last !== null && Number.isFinite(last);
  const L = last ?? 0;

  const steps: Step[] = [];

  // L = 0 means it converges wherever you put x.
  if (shrinking || (settled && L < 1e-9)) {
    steps.push(displayStep("SERIES_RADIUS_INFINITE", problem, "\\text{all } " + variable, node, {
      variable, index,
    }));
    const reach = `The ratio shrinks to zero whatever ${variable} is, so this converges for every ${variable}.`;
    if (known) {
      steps.push(displayStep("SERIES_KNOWN", `R = \\infty`, known, node, { variable, sum: known }));
    }
    const answer = known ?? `R = \\infty`;
    return {
      kind: "series", problem, answer, answers: [answer], steps, verified: true,
      note: known ? `The Maclaurin series of ${known}. ${reach}` : reach,
    };
  }
  if (growing) {
    const answer = `${variable} = ${centre.toLatex()}`;
    steps.push(displayStep("SERIES_RADIUS_ZERO", problem, answer, node, { variable, index }));
    return {
      kind: "series", problem, answer, answers: [answer], steps, verified: true,
      note: `The ratio runs away for any ${variable} off the centre, so only ${answer} works.`,
    };
  }

  if (!settled || L <= 0) {
    throw new UnsupportedProblemError("could not settle the radius of convergence");
  }

  // Snap to an exact value. These radii are rationals with small denominators
  // and an extrapolated 0.9999999 is the number 1 with measurement noise on
  // it; reporting the noise would be worse than useless in an answer.
  const exactL = asRational(L);
  const radius = exactL ? Rational.ONE.div(exactL).toNumber() : 1 / L;
  const lower = centre.toNumber() - radius;
  const upper = centre.toNumber() + radius;

  steps.push(displayStep("SERIES_RADIUS", problem, `R = ${formatNumber(radius)}`, node, {
    variable, index, radius: formatNumber(radius), centre: centre.toLatex(),
  }));

  // The endpoints, each settled on its own by the ordinary tests.
  const ends = [lower, upper].map((end) => ({
    at: end,
    included: endpointConverges(body, index, from, variable, end),
  }));
  const [low, high] = ends as [{ at: number; included: boolean | null }, { at: number; included: boolean | null }];

  if (low.included === null || high.included === null) {
    const answer = known ?? `R = ${formatNumber(radius)}`;
    return {
      kind: "series", problem, answer, answers: [answer], steps, verified: true,
      note: known
        ? `The Maclaurin series of ${known}, with radius ${formatNumber(radius)}.`
        : `The radius is ${formatNumber(radius)}. The endpoints need checking separately and none of the tests here settle them.`,
    };
  }

  steps.push(displayStep(
    "SERIES_ENDPOINTS",
    `R = ${formatNumber(radius)}`,
    intervalLatex(low.at, high.at, low.included, high.included),
    node,
    {
      lower: formatNumber(low.at),
      upper: formatNumber(high.at),
      lowerVerdict: low.included ? "converges" : "diverges",
      upperVerdict: high.included ? "converges" : "diverges",
    },
  ));

  const interval = intervalLatex(low.at, high.at, low.included, high.included);
  if (known) {
    steps.push(displayStep("SERIES_KNOWN", interval, known, node, { variable, sum: known }));
  }
  const answer = known ?? interval;
  return {
    kind: "series", problem, answer, answers: [answer], steps, verified: true,
    note: known
      ? `The Maclaurin series of ${known}, on ${interval}.`
      : `The radius of convergence is ${formatNumber(radius)}.`,
  };
}

/**
 * Where the ratios are heading, fitted rather than read off the last one.
 *
 * These ratios all approach their limit like L + c/n — n/(n+1) is the shape —
 * and even at n = ten thousand that is still short by one part in ten
 * thousand, which turns a radius of exactly 1 into 1.000098. Two points
 * determine L and c, and solving for L removes the error instead of reporting
 * it. Null when the fit is unusable.
 */
function extrapolateRatio(sampled: Array<{ n: number; r: number }>): number | null {
  const a = sampled[sampled.length - 2];
  const b = sampled[sampled.length - 1];
  if (!a || !b || a.n === b.n) return null;
  const slope = 1 / a.n - 1 / b.n;
  if (Math.abs(slope) < 1e-15) return null;
  const c = (a.r - b.r) / slope;
  const L = a.r - c / a.n;
  if (!Number.isFinite(L)) return null;
  // The fit is only trusted when it lands near the measurements it came from.
  return Math.abs(L - b.r) <= 0.5 * Math.max(1, Math.abs(b.r)) ? L : b.r;
}

/** A double back as an exact rational, when it is one with a small denominator. */
function asRational(x: number): Rational | null {
  // The tolerance is loose because the input is an extrapolated measurement,
  // not a computed value: fitting the ratios of 1/(n 3^n) lands on 0.33333
  // rather than a third. Radii of convergence in practice are rationals with
  // small denominators, so snapping to the nearest one is right, and a radius
  // that genuinely sat a ten-thousandth away from 1/3 is not a question
  // anybody sets.
  for (const d of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 32, 50, 100]) {
    const n = x * d;
    if (Math.abs(n - Math.round(n)) < 2e-4 * d) return Rational.of(Math.round(n), d);
  }
  return null;
}

/** Does the series converge at this endpoint? Null when nothing settles it. */
function endpointConverges(
  body: MathNode,
  index: string,
  from: number,
  variable: string,
  at: number,
): boolean | null {
  // The endpoint has to go in exactly, or a p-series at x = -1 turns into a
  // decimal and stops looking like one. Radii here are rationals with small
  // denominators, so reading the decimal back as a fraction is safe.
  const exact = asRational(at);
  if (!exact) return null;
  // Simplified properly, not merely tidied: putting x = 1 into x^n/n leaves
  // 1^n/n, and until the one-to-a-power is gone this does not look like the
  // p-series it is.
  const put = normalize(substitute(cloneFresh(body), variable, num(exact)));
  const fixed = run(put, expressionRules, {}, { verify: false, maxSteps: 40 }).node;

  const heading = termLimit(fixed, index);
  if (heading !== null && Math.abs(heading) > 1e-6) return false;

  const geometric = asGeometric(fixed, index, from);
  if (geometric) return Math.abs(geometric.ratio.toNumber()) < 1;

  const p = asPSeries(fixed, index);
  if (p) return p.toNumber() > 1;

  if (alternates(fixed, index, from) && magnitudesDecrease(fixed, index, from)) return true;

  const compared = limitComparison(fixed, index, from);
  if (compared) return compared.p.toNumber() > 1;

  return null;
}

function intervalLatex(lower: number, upper: number, lowIn: boolean, highIn: boolean): string {
  const open = lowIn ? "\\left[" : "\\left(";
  const close = highIn ? "\\right]" : "\\right)";
  return `${open}${formatNumber(lower)}, ${formatNumber(upper)}${close}`;
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
