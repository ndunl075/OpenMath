import {
  add, cloneFresh, freeSymbols, key, makeTerm, type MathNode, mul, num, pow, Rational,
  splitCoefficient, toLatex,
} from "@openmath/math-core";
import { degreeIn, toPolynomial } from "../poly.js";
import type { Coefficients } from "../polysolve.js";
import {
  coefficientsToNode, evaluatePoly, linearFactor, polyDegree, rationalRootCandidates,
  syntheticDivision,
} from "../polysolve.js";
import type { Rule } from "../types.js";

/**
 * Factoring rules.
 *
 * These are deliberately kept out of `expressionRules`. Factoring and expanding
 * are inverses: (x+1)(x+2) wants to become x^2+3x+2, and x^2+3x+2 wants to
 * become (x+1)(x+2), so a rule set containing both has no fixed point and the
 * answer would be decided by whichever rule happened to sit higher in the
 * priority list. The engine's seen-set would stop the loop, but stopping is not
 * choosing. Instead the *shape of the problem* decides once, in `classify`: a
 * product asks to be multiplied out, a polynomial already written term by term
 * asks to be factored, and each direction then runs in its own pipeline with no
 * rule that could undo it. See `isFactoringProblem` in solve.ts.
 */

interface Power {
  base: MathNode;
  exp: Rational;
}

interface TermParts {
  coeff: Rational;
  powers: Map<string, Power>;
}

function readTerm(n: MathNode): TermParts | null {
  const { coeff, rest } = splitCoefficient(n);
  if (coeff.isZero()) return null;
  const powers = new Map<string, Power>();
  for (const r of rest) {
    let base = r;
    let exp = Rational.ONE;
    if (r.type === "pow") {
      if (r.exp.type !== "num" || !r.exp.value.isInteger() || r.exp.value.isNegative()) return null;
      base = r.base;
      exp = r.exp.value;
    }
    const k = key(base);
    const prev = powers.get(k);
    powers.set(k, { base, exp: prev ? prev.exp.add(exp) : exp });
  }
  return { coeff, powers };
}

function powerNode(p: Power): MathNode {
  return p.exp.isOne() ? p.base : pow(p.base, num(p.exp));
}

function rebuildTerm(coeff: Rational, powers: Map<string, Power>): MathNode {
  const rest: MathNode[] = [];
  for (const p of powers.values()) {
    if (p.exp.isZero()) continue;
    rest.push(powerNode(p));
  }
  return makeTerm(coeff, rest);
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

/** Greatest common factor of two rationals, taken over the rationals. */
function gcdRational(a: Rational, b: Rational): Rational {
  if (a.isZero()) return b.abs();
  if (b.isZero()) return a.abs();
  const n = gcdBig(a.n, b.n);
  const d = (a.d / gcdBig(a.d, b.d)) * b.d;
  return Rational.of(n, d);
}

export function singleVariable(n: MathNode): string | null {
  const vars = [...freeSymbols(n)];
  return vars.length === 1 ? vars[0]! : null;
}

/** The term a student reads the sign of: the one with the highest power. */
function leadingIndex(terms: MathNode[]): number {
  const v = singleVariable(terms.length ? add(terms) : num(Rational.ZERO));
  if (!v) return 0;
  let best = 0;
  let bestDegree = -1;
  terms.forEach((t, i) => {
    const d = degreeIn(t, v);
    if (d !== null && d > bestDegree) {
      bestDegree = d;
      best = i;
    }
  });
  return best;
}

interface CommonFactor {
  factor: MathNode;
  cofactor: MathNode;
}

/**
 * The largest factor every term shares, and what is left after dividing by it.
 * Structural rather than polynomial, so it also pulls the shared bracket out of
 * x^2(x+3) - 4(x+3), which is what makes factoring by grouping finish.
 */
export function extractCommonFactor(terms: MathNode[]): CommonFactor | null {
  if (terms.length < 2) return null;
  const parts: TermParts[] = [];
  for (const t of terms) {
    const p = readTerm(t);
    if (!p) return null;
    parts.push(p);
  }

  let g = parts[0]!.coeff.abs();
  for (const p of parts) g = gcdRational(g, p.coeff);
  const lead = parts[leadingIndex(terms)]!;
  if (lead.coeff.isNegative()) g = g.neg();

  const shared = new Map<string, Power>();
  for (const [k, p] of parts[0]!.powers) {
    let min = p.exp;
    let ok = true;
    for (const other of parts.slice(1)) {
      const q = other.powers.get(k);
      if (!q) {
        ok = false;
        break;
      }
      if (q.exp.cmp(min) < 0) min = q.exp;
    }
    if (ok && !min.isZero()) shared.set(k, { base: p.base, exp: min });
  }

  const onlyMinusOne = g.equals(Rational.NEG_ONE) && shared.size === 0;
  if (g.isOne() && shared.size === 0) return null;
  if (onlyMinusOne) {
    // Pulling out a bare minus sign is only worth a step when it exposes
    // something else to factor, so -x^2+5x-6 qualifies and -x-3 does not.
    const whole = add(terms);
    const v = singleVariable(whole);
    const d = v ? degreeIn(whole, v) : null;
    if (d === null || d < 2) return null;
  }

  // The bracket that comes out is a new term, so it gets new ids; the terms
  // left behind keep theirs, which is how the animation knows they survived.
  const factorPowers = new Map<string, Power>();
  for (const [k, p] of shared) factorPowers.set(k, { base: cloneFresh(p.base), exp: p.exp });
  const factor = rebuildTerm(g, factorPowers);

  const reduced = parts.map((p) => {
    const rest = new Map<string, Power>();
    for (const [k, q] of p.powers) {
      const s = shared.get(k);
      const exp = s ? q.exp.sub(s.exp) : q.exp;
      if (!exp.isZero()) rest.set(k, { base: q.base, exp });
    }
    return rebuildTerm(p.coeff.div(g), rest);
  });

  return { factor, cofactor: add(reduced) };
}

/** 2x^2 + 4x -> 2x(x + 2) */
export const factorCommonFactor: Rule = {
  id: "FACTOR_COMMON_FACTOR",
  apply(n) {
    if (n.type !== "add" || n.args.length < 2) return null;
    const found = extractCommonFactor(n.args);
    if (!found) return null;
    const node = mul([found.factor, found.cofactor]);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: { factor: toLatex(found.factor) },
    };
  },
};

/** The polynomial view of a sum, when it has exactly one variable. */
function asPolynomial(n: MathNode): { variable: string; coeffs: Coefficients } | null {
  if (n.type !== "add") return null;
  const v = singleVariable(n);
  if (!v) return null;
  const p = toPolynomial(n, v);
  if (!p) return null;
  const coeffs: Coefficients = [];
  let d = -1;
  for (const [deg] of p) d = Math.max(d, deg);
  for (let i = 0; i <= d; i++) coeffs.push(p.get(i) ?? Rational.ZERO);
  return { variable: v, coeffs };
}

/** The exact k-th root of a monomial, or null when it does not have one. */
function monomialRoot(m: TermParts, k: bigint): TermParts | null {
  const coeff = m.coeff.abs().nthRoot(k);
  if (!coeff) return null;
  const powers = new Map<string, Power>();
  for (const [key_, p] of m.powers) {
    const exp = p.exp.div(Rational.of(k));
    if (!exp.isInteger()) return null;
    powers.set(key_, { base: p.base, exp });
  }
  return { coeff, powers };
}

function monomialMul(a: TermParts, b: TermParts): TermParts {
  const powers = new Map<string, Power>();
  for (const [k, p] of a.powers) powers.set(k, { base: p.base, exp: p.exp });
  for (const [k, p] of b.powers) {
    const prev = powers.get(k);
    powers.set(k, { base: p.base, exp: prev ? prev.exp.add(p.exp) : p.exp });
  }
  return { coeff: a.coeff.mul(b.coeff), powers };
}

function monomialNode(m: TermParts, scale: Rational = Rational.ONE): MathNode {
  return cloneFresh(rebuildTerm(m.coeff.mul(scale), m.powers));
}

/**
 * A two-term sum read as `high - low` or `high + low`, with both terms exact
 * k-th powers of a monomial. Structural rather than polynomial, so it covers
 * a^2 - b^2 in two letters as well as 4x^2 - 9 in one.
 */
function asPowerPair(
  n: MathNode,
  k: bigint,
): { high: TermParts; low: TermParts; minus: boolean } | null {
  if (n.type !== "add" || n.args.length !== 2) return null;
  const first = readTerm(n.args[0]!);
  const second = readTerm(n.args[1]!);
  if (!first || !second) return null;
  // Order so the positive term leads; 9 - x^2 has its minus sign taken out by
  // the common factor rule before it reaches here.
  const [high, low] = first.coeff.isNegative() ? [second, first] : [first, second];
  if (high.coeff.isNegative()) return null;
  if (high.powers.size === 0) return null; // 4 - 9 is arithmetic, not factoring
  const rootHigh = monomialRoot(high, k);
  const rootLow = monomialRoot(low, k);
  if (!rootHigh || !rootLow) return null;
  return { high: rootHigh, low: rootLow, minus: low.coeff.isNegative() };
}

/** x^2 - 9 -> (x - 3)(x + 3) */
export const factorDifferenceOfSquares: Rule = {
  id: "FACTOR_DIFFERENCE_OF_SQUARES",
  apply(n) {
    const parts = asPowerPair(n, 2n);
    if (!parts || !parts.minus) return null;
    const { high, low } = parts;
    const node = mul([
      add([monomialNode(high), monomialNode(low, Rational.NEG_ONE)]),
      add([monomialNode(high), monomialNode(low)]),
    ]);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: { first: toLatex(monomialNode(high)), second: toLatex(monomialNode(low)) },
    };
  },
};

/** x^3 - 8 -> (x - 2)(x^2 + 2x + 4), and the sum of cubes alongside it. */
export const factorCubes: Rule = {
  id: "FACTOR_DIFFERENCE_OF_CUBES",
  apply(n) {
    const parts = asPowerPair(n, 3n);
    if (!parts) return null;
    const { high: a, low: b, minus } = parts;

    // a^3 -+ b^3 = (a -+ b)(a^2 +- ab + b^2)
    const middle = minus ? Rational.ONE : Rational.NEG_ONE;
    const linear = add([monomialNode(a), monomialNode(b, minus ? Rational.NEG_ONE : Rational.ONE)]);
    const quadratic = add([
      monomialNode(monomialMul(a, a)),
      monomialNode(monomialMul(a, b), middle),
      monomialNode(monomialMul(b, b)),
    ]);
    const node = mul([linear, quadratic]);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      explanationKey: minus ? "FACTOR_DIFFERENCE_OF_CUBES" : "FACTOR_SUM_OF_CUBES",
      vars: { first: toLatex(monomialNode(a)), second: toLatex(monomialNode(b)) },
    };
  },
};

/** x^2 + 5x + 6 -> (x + 2)(x + 3) */
export const factorTrinomial: Rule = {
  id: "FACTOR_TRINOMIAL",
  apply(n) {
    const p = asPolynomial(n);
    if (!p) return null;
    const { coeffs, variable } = p;
    if (polyDegree(coeffs) !== 2) return null;
    const a = coeffs[2]!;
    const b = coeffs[1]!;
    const c = coeffs[0]!;
    if (a.isNegative()) return null; // the common factor rule takes the sign out first
    const discriminant = b.mul(b).sub(Rational.of(4).mul(a).mul(c));
    if (discriminant.isNegative()) return null;
    const exact = discriminant.nthRoot(2n);
    if (!exact) return null;

    const twoA = Rational.of(2).mul(a);
    const roots = [b.neg().add(exact).div(twoA), b.neg().sub(exact).div(twoA)];
    // Textbooks write the smaller number first: (x + 2)(x + 3), (x - 2)(x - 3).
    roots.sort((x, y) => {
      const c1 = x.abs().cmp(y.abs());
      return c1 !== 0 ? c1 : x.cmp(y);
    });
    const leading = a.div(Rational.of(roots[0]!.d * roots[1]!.d));
    const brackets = roots.map((r) => linearFactor(r, variable));
    const same = roots[0]!.equals(roots[1]!);
    const body = same
      ? pow(brackets[0]!, num(Rational.of(2)))
      : mul(brackets);
    const node = leading.isOne() ? body : mul([num(leading), body]);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: { product: c.div(a).toLatex(), sum: b.div(a).toLatex() },
    };
  },
};

/**
 * x^3 + 3x^2 - 4x - 12 -> x^2(x + 3) - 4(x + 3)
 *
 * Only the grouping step itself; the shared bracket is then taken out by the
 * common factor rule, which is exactly how it is taught.
 */
export const factorByGrouping: Rule = {
  id: "FACTOR_BY_GROUPING",
  apply(n) {
    if (n.type !== "add" || n.args.length !== 4) return null;
    const [t0, t1, t2, t3] = n.args as [MathNode, MathNode, MathNode, MathNode];
    const pairings: Array<[MathNode[], MathNode[]]> = [
      [[t0, t1], [t2, t3]],
      [[t0, t2], [t1, t3]],
      [[t0, t3], [t1, t2]],
    ];
    for (const [left, right] of pairings) {
      const a = extractCommonFactor(left);
      const b = extractCommonFactor(right);
      if (!a || !b) continue;
      if (key(a.cofactor) !== key(b.cofactor)) continue;
      const node = add([
        mul([a.factor, a.cofactor]),
        mul([b.factor, b.cofactor]),
      ]);
      return {
        node,
        changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
        vars: { shared: toLatex(a.cofactor) },
      };
    }
    return null;
  },
};

/**
 * Anything cubic or higher that none of the named patterns match: find one
 * rational root and divide it out, leaving a smaller polynomial for the rules
 * above to finish.
 */
export const factorByRationalRoot: Rule = {
  id: "FACTOR_RATIONAL_ROOT",
  apply(n) {
    const p = asPolynomial(n);
    if (!p) return null;
    const { coeffs, variable } = p;
    if (polyDegree(coeffs) < 3) return null;
    if (coeffs[0]!.isZero()) return null; // the common factor rule takes out x
    const candidates = rationalRootCandidates(coeffs);
    if (!candidates) return null;
    const root = candidates.find((c) => evaluatePoly(coeffs, c).isZero());
    if (!root) return null;
    const { quotient } = syntheticDivision(coeffs, root);
    const rest = quotient.map((v) => v.div(Rational.of(root.d)));
    const node = mul([linearFactor(root, variable), coefficientsToNode(rest, variable)]);
    return {
      node,
      changes: [{ kind: "replace", fromIds: [n.id], toIds: [node.id] }],
      vars: { root: root.toLatex(), variable },
    };
  },
};

/**
 * Priority. Take out the common factor first, exactly as it is taught, then the
 * patterns that are recognised on sight, then grouping, and only then the
 * general search for a root.
 */
export const factorRules: Rule[] = [
  factorCommonFactor,
  factorDifferenceOfSquares,
  factorCubes,
  factorTrinomial,
  factorByGrouping,
  factorByRationalRoot,
];
