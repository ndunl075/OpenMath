import {
  add, type MathNode, makeTerm, mul, num, pow, Rational, rel, sym, toLatex,
} from "@openmath/math-core";
import { coeff, degree, type Poly } from "./poly.js";
import { polynomialOf, solveQuadratic } from "./quadratic.js";
import { displayStep, rewriteStep } from "./step.js";
import type { Step } from "./types.js";

/**
 * Polynomial equations above the second degree, solved the way a textbook does:
 * the rational root theorem to find one root, synthetic division to divide it
 * out, then the same again on what is left.
 *
 * When no rational root exists the problem is handed back unsolved. A cubic
 * with three irrational roots does have exact answers, but they need Cardano's
 * formula or a trigonometric substitution, and a student told to solve it by
 * hand cannot use either. A decimal approximation would be worse than nothing:
 * it looks like an answer and cannot be checked by substitution.
 */

/** Coefficients by degree: index 0 is the constant term. */
export type Coefficients = Rational[];

/** How large a numerator or denominator may get before candidates are refused. */
const MAX_DIVISOR_SEARCH = 1_000_000n;

/** The highest degree worth attempting; past this the working stops being readable. */
const MAX_DEGREE = 6;

export function polyCoefficients(p: Poly): Coefficients {
  const d = degree(p);
  const out: Coefficients = [];
  for (let i = 0; i <= d; i++) out.push(coeff(p, i));
  return out;
}

export function polyDegree(c: Coefficients): number {
  for (let i = c.length - 1; i >= 0; i--) if (!c[i]!.isZero()) return i;
  return -1;
}

/** Rebuild a polynomial node, highest power first, the way it is written out. */
export function coefficientsToNode(c: Coefficients, variable: string): MathNode {
  const terms: MathNode[] = [];
  for (let d = polyDegree(c); d >= 0; d--) {
    const value = c[d]!;
    if (value.isZero()) continue;
    const body =
      d === 0 ? [] : d === 1 ? [sym(variable)] : [pow(sym(variable), num(Rational.of(d)))];
    terms.push(makeTerm(value, body));
  }
  if (terms.length === 0) return num(Rational.ZERO);
  return terms.length === 1 ? terms[0]! : add(terms);
}

export function evaluatePoly(c: Coefficients, x: Rational): Rational {
  let acc = Rational.ZERO;
  for (let i = c.length - 1; i >= 0; i--) acc = acc.mul(x).add(c[i]!);
  return acc;
}

/**
 * Divide by (x - root). The remainder is zero exactly when `root` is a root,
 * which is the same arithmetic as the synthetic division table.
 */
export function syntheticDivision(
  c: Coefficients,
  root: Rational,
): { quotient: Coefficients; remainder: Rational } {
  const d = polyDegree(c);
  if (d < 1) return { quotient: [], remainder: evaluatePoly(c, root) };
  const quotient: Coefficients = new Array(d).fill(Rational.ZERO);
  let carry = c[d]!;
  quotient[d - 1] = carry;
  for (let i = d - 1; i >= 1; i--) {
    carry = c[i]!.add(carry.mul(root));
    quotient[i - 1] = carry;
  }
  return { quotient, remainder: c[0]!.add(carry.mul(root)) };
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function lcmBig(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  const l = (a / gcdBig(a, b)) * b;
  return l < 0n ? -l : l;
}

/**
 * The same polynomial with integer coefficients and no common factor. The
 * rational root theorem is stated for that form, and clearing the denominators
 * is what a student does before listing any candidates.
 */
export function primitiveIntegerCoefficients(c: Coefficients): bigint[] | null {
  let den = 1n;
  for (const v of c) den = lcmBig(den, v.d);
  if (den === 0n) return null;
  const ints = c.map((v) => (v.n * den) / v.d);
  let content = 0n;
  for (const v of ints) content = gcdBig(content, v);
  if (content === 0n) return null;
  const out = ints.map((v) => v / content);
  for (const v of out) if ((v < 0n ? -v : v) > MAX_DIVISOR_SEARCH) return null;
  return out;
}

function divisors(value: bigint): bigint[] | null {
  const v = value < 0n ? -value : value;
  if (v === 0n || v > MAX_DIVISOR_SEARCH) return null;
  const out: bigint[] = [];
  for (let i = 1n; i * i <= v; i++) {
    if (v % i === 0n) {
      out.push(i);
      if (i !== v / i) out.push(v / i);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Every p/q the theorem allows, in the order a student would try them: whole
 * numbers before fractions, small before large, plus before minus.
 */
export function rationalRootCandidates(c: Coefficients): Rational[] | null {
  const ints = primitiveIntegerCoefficients(c);
  if (!ints) return null;
  const constant = ints[0]!;
  const leading = ints[ints.length - 1]!;
  if (constant === 0n) return null; // zero is a root; factoring out x finds it
  const ps = divisors(constant);
  const qs = divisors(leading);
  if (!ps || !qs) return null;

  const seen = new Set<string>();
  const out: Rational[] = [];
  for (const q of qs) {
    for (const p of ps) {
      for (const sign of [1n, -1n]) {
        const r = Rational.of(sign * p, q);
        const k = r.toString();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
    }
  }
  return out.sort((a, b) => {
    if (a.d !== b.d) return a.d < b.d ? -1 : 1;
    const ma = a.n < 0n ? -a.n : a.n;
    const mb = b.n < 0n ? -b.n : b.n;
    if (ma !== mb) return ma < mb ? -1 : 1;
    return a.n > b.n ? -1 : 1;
  });
}

/** `\pm 1, \pm 2, \pm 3` — the candidate list as it gets written down. */
function candidateLatex(candidates: Rational[]): string {
  return candidates.filter((c) => !c.isNegative()).map((c) => `\\pm ${c.toLatex()}`).join(", ");
}

/** (x - r), or (q x - p) when the root is a fraction, so the factor stays integral. */
export function linearFactor(root: Rational, variable: string): MathNode {
  const scaled = root.d === 1n ? sym(variable) : mul([num(Rational.of(root.d)), sym(variable)]);
  if (root.isZero()) return scaled;
  return add([scaled, num(Rational.of(-root.n))]);
}

export interface PolynomialSolution {
  steps: Step[];
  answers: string[];
  answerValues: number[];
  note?: string;
}

interface Root {
  latex: string;
  value: number;
}

/**
 * Solve a polynomial equation of degree three or more, or return null when it
 * has no rational root and therefore no solution a student could write down.
 */
export function solveByRationalRoots(
  equation: MathNode,
  variable: string,
  poly: Poly,
): PolynomialSolution | null {
  if (equation.type !== "rel" || equation.rel !== "=") return null;
  const start = polyCoefficients(poly);
  const startDegree = polyDegree(start);
  if (startDegree < 3 || startDegree > MAX_DEGREE) return null;

  const steps: Step[] = [];
  const roots: Root[] = [];
  const factors: MathNode[] = [];
  let constantFactor = Rational.ONE;
  let current = start;
  let currentNode: MathNode = equation;

  const addRoot = (r: Rational) => {
    const latex = `${variable} = ${r.toLatex()}`;
    if (!roots.some((x) => x.latex === latex)) roots.push({ latex, value: r.toNumber() });
  };

  /** Show the factorisation found so far, times whatever is left to factor. */
  const advance = (
    ruleId: string,
    rest: Coefficients | null,
    vars: Record<string, string> = {},
  ) => {
    const parts: MathNode[] = [];
    if (!constantFactor.isOne()) parts.push(num(constantFactor));
    parts.push(...factors);
    if (rest && polyDegree(rest) >= 1) parts.push(coefficientsToNode(rest, variable));
    const shown = parts.length === 1 ? parts[0]! : mul(parts);
    const next = rel("=", shown, num(Rational.ZERO));
    steps.push(rewriteStep(ruleId, currentNode, next, vars));
    currentNode = next;
  };

  // A zero constant term means x itself is a factor. Taking it out is both the
  // first thing a student does and the only way the root x = 0 is ever found:
  // the rational root theorem cannot see it.
  if (current[0]!.isZero()) {
    let k = 0;
    while (k < current.length && current[k]!.isZero()) k++;
    const factor = k === 1 ? sym(variable) : pow(sym(variable), num(Rational.of(k)));
    factors.push(factor);
    addRoot(Rational.ZERO);
    current = current.slice(k);
    advance("FACTOR_OUT_VARIABLE", current, { factor: toLatex(factor) });
  }

  let listedCandidates = false;
  while (polyDegree(current) >= 3) {
    const candidates = rationalRootCandidates(current);
    if (!candidates || candidates.length === 0) return null;
    if (!listedCandidates) {
      const ints = primitiveIntegerCoefficients(current)!;
      steps.push(
        displayStep(
          "RATIONAL_ROOT_CANDIDATES",
          toLatex(currentNode),
          `${variable} = ${candidateLatex(candidates)}`,
          currentNode,
          {
            constant: Rational.of(ints[0]!).toLatex(),
            leading: Rational.of(ints[ints.length - 1]!).toLatex(),
            candidates: candidateLatex(candidates),
          },
        ),
      );
      listedCandidates = true;
    }
    const found = candidates.find((c) => evaluatePoly(current, c).isZero());
    if (!found) return null;
    // (x - p/q) Q = (q x - p) (Q / q), and by Gauss's lemma the second factor
    // keeps integer coefficients, so the working never grows a stray fraction.
    const { quotient } = syntheticDivision(current, found);
    current = quotient.map((v) => v.div(Rational.of(found.d)));
    factors.push(linearFactor(found, variable));
    addRoot(found);
    advance("SYNTHETIC_DIVISION", current, { root: found.toLatex(), variable });
  }

  let note: string | undefined;
  const remaining = polyDegree(current);

  if (remaining === 1) {
    const root = current[0]!.neg().div(current[1]!);
    constantFactor = constantFactor.mul(current[1]!.div(Rational.of(root.d)));
    factors.push(linearFactor(root, variable));
    addRoot(root);
    advance("LINEAR_FACTOR", null, { root: root.toLatex(), variable });
  } else if (remaining === 2) {
    const a = current[2]!;
    const b = current[1]!;
    const c = current[0]!;
    const discriminant = b.mul(b).sub(Rational.of(4).mul(a).mul(c));
    const exact = discriminant.isNegative() ? null : discriminant.nthRoot(2n);
    if (exact) {
      const twoA = Rational.of(2).mul(a);
      const r1 = b.neg().add(exact).div(twoA);
      const r2 = b.neg().sub(exact).div(twoA);
      const ordered = r1.cmp(r2) <= 0 ? [r1, r2] : [r2, r1];
      // a x^2 + b x + c = (a / q1 q2)(q1 x - p1)(q2 x - p2).
      constantFactor = constantFactor.mul(a.div(Rational.of(ordered[0]!.d * ordered[1]!.d)));
      for (const r of ordered) {
        factors.push(linearFactor(r, variable));
        addRoot(r);
      }
      advance("FACTOR_QUADRATIC", null, {
        product: c.div(a).toLatex(),
        sum: b.div(a).toLatex(),
      });
    } else if (discriminant.isNegative()) {
      const quadratic = coefficientsToNode(current, variable);
      steps.push(
        displayStep(
          "NO_REAL_SOLUTIONS",
          `${toLatex(quadratic)} = 0`,
          "\\text{no real solutions}",
          currentNode,
          { discriminant: discriminant.toLatex() },
        ),
      );
      note = `The factor ${toLatex(quadratic)} has no real roots, so it adds no solutions.`;
    } else {
      // Irrational roots: the quadratic formula is what keeps them exact.
      const quadratic = rel("=", coefficientsToNode(current, variable), num(Rational.ZERO));
      const quadraticPoly = polynomialOf(quadratic, variable);
      if (!quadraticPoly) return null;
      const q = solveQuadratic(quadratic, variable, quadraticPoly);
      if (!q) return null;
      steps.push(...q.steps);
      q.answers.forEach((latex, i) => {
        if (!roots.some((x) => x.latex === latex)) {
          roots.push({ latex, value: q.answerValues[i] ?? NaN });
        }
      });
    }
  }

  if (roots.length === 0) {
    return { steps, answers: [], answerValues: [], note: note ?? "No real solutions." };
  }

  roots.sort((x, y) => x.value - y.value);
  const answers = roots.map((r) => r.latex);
  steps.push(
    displayStep(
      "ZERO_PRODUCT",
      toLatex(currentNode),
      answers.join(" \\quad \\text{or} \\quad "),
      currentNode,
    ),
  );

  return {
    steps,
    answers,
    answerValues: roots.map((r) => r.value),
    ...(note ? { note } : {}),
  };
}
