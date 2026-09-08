import {
  add, makeTerm, type MathNode, num, pow, Rational, sym, ZERO,
} from "@openmath/math-core";

/** Sparse polynomial: exponent -> coefficient. */
export type Poly = Map<number, Rational>;

function addTo(p: Poly, deg: number, c: Rational): void {
  const cur = p.get(deg) ?? Rational.ZERO;
  const next = cur.add(c);
  if (next.isZero()) p.delete(deg);
  else p.set(deg, next);
}

export function mulPoly(a: Poly, b: Poly): Poly {
  const out: Poly = new Map();
  for (const [da, ca] of a) for (const [db, cb] of b) addTo(out, da + db, ca.mul(cb));
  return out;
}

/**
 * Read a node as a polynomial in `v`. Returns null when the expression is not a
 * polynomial in that variable, which is how the solver decides a problem is out
 * of scope rather than guessing.
 */
export function toPolynomial(n: MathNode, v: string): Poly | null {
  switch (n.type) {
    case "num":
      return n.value.isZero() ? new Map() : new Map([[0, n.value]]);
    case "sym":
      return n.name === v ? new Map([[1, Rational.ONE]]) : null;
    case "neg": {
      const p = toPolynomial(n.arg, v);
      if (!p) return null;
      const out: Poly = new Map();
      for (const [d, c] of p) out.set(d, c.neg());
      return out;
    }
    case "add": {
      const out: Poly = new Map();
      for (const a of n.args) {
        const p = toPolynomial(a, v);
        if (!p) return null;
        for (const [d, c] of p) addTo(out, d, c);
      }
      return out;
    }
    case "mul": {
      let acc: Poly = new Map([[0, Rational.ONE]]);
      for (const a of n.args) {
        const p = toPolynomial(a, v);
        if (!p) return null;
        acc = mulPoly(acc, p);
      }
      return acc;
    }
    case "div": {
      const den = toPolynomial(n.den, v);
      const numr = toPolynomial(n.num, v);
      if (!den || !numr) return null;
      // Only division by a non-zero constant keeps it polynomial.
      if (den.size !== 1 || !den.has(0)) return null;
      const d = den.get(0)!;
      if (d.isZero()) return null;
      const out: Poly = new Map();
      for (const [deg, c] of numr) out.set(deg, c.div(d));
      return out;
    }
    case "pow": {
      const base = toPolynomial(n.base, v);
      if (!base) return null;
      if (n.exp.type !== "num" || !n.exp.value.isInteger() || n.exp.value.isNegative()) return null;
      const e = Number(n.exp.value.n);
      if (e > 8) return null;
      let acc: Poly = new Map([[0, Rational.ONE]]);
      for (let i = 0; i < e; i++) acc = mulPoly(acc, base);
      return acc;
    }
    case "fn":
    case "rel":
      return null;
  }
}

export function degree(p: Poly): number {
  let d = -1;
  for (const [k, c] of p) if (!c.isZero() && k > d) d = k;
  return d;
}

export function coeff(p: Poly, d: number): Rational {
  return p.get(d) ?? Rational.ZERO;
}

/** p - q */
export function subPoly(a: Poly, b: Poly): Poly {
  const out: Poly = new Map(a);
  for (const [d, c] of b) addTo(out, d, c.neg());
  return out;
}

/**
 * Highest power of `v` in the expression, or null when `v` appears somewhere
 * that is not polynomial (a denominator, inside a function, a fractional
 * exponent). Unlike toPolynomial this tolerates other symbols, so it works on
 * an equation with more than one variable.
 */
export function degreeIn(n: MathNode, v: string): number | null {
  switch (n.type) {
    case "num":
      return 0;
    case "sym":
      return n.name === v ? 1 : 0;
    case "neg":
      return degreeIn(n.arg, v);
    case "add": {
      let d = 0;
      for (const a of n.args) {
        const x = degreeIn(a, v);
        if (x === null) return null;
        d = Math.max(d, x);
      }
      return d;
    }
    case "mul": {
      let d = 0;
      for (const a of n.args) {
        const x = degreeIn(a, v);
        if (x === null) return null;
        d += x;
      }
      return d;
    }
    case "div": {
      const dd = degreeIn(n.den, v);
      if (dd === null || dd > 0) return null;
      return degreeIn(n.num, v);
    }
    case "pow": {
      const bd = degreeIn(n.base, v);
      if (bd === null) return null;
      if (bd === 0) return degreeIn(n.exp, v) === 0 ? 0 : null;
      if (n.exp.type !== "num" || !n.exp.value.isInteger() || n.exp.value.isNegative()) return null;
      return bd * Number(n.exp.value.n);
    }
    case "fn": {
      for (const a of n.args) {
        const x = degreeIn(a, v);
        if (x === null || x > 0) return null;
      }
      return 0;
    }
    case "rel":
      return null;
  }
}

/** Degree of lhs - rhs, used to route an equation to the right solver. */
export function relationDegree(n: MathNode, v: string): number | null {
  if (n.type !== "rel") return null;
  const l = degreeIn(n.lhs, v);
  const r = degreeIn(n.rhs, v);
  if (l === null || r === null) return null;
  return Math.max(l, r);
}

// ------------------------------------------------------- factoring and division

export function addPoly(a: Poly, b: Poly): Poly {
  const out: Poly = new Map(a);
  for (const [d, c] of b) addTo(out, d, c);
  return out;
}

export function scalePoly(p: Poly, k: Rational): Poly {
  const out: Poly = new Map();
  if (k.isZero()) return out;
  for (const [d, c] of p) out.set(d, c.mul(k));
  return out;
}

export function evalPoly(p: Poly, at: Rational): Rational {
  let acc = Rational.ZERO;
  for (const [d, c] of p) {
    const power = at.powInt(BigInt(d));
    if (!power) return Rational.ZERO;
    acc = acc.add(c.mul(power));
  }
  return acc;
}

/** Turn a polynomial back into an expression, highest power first. */
export function polyToNode(p: Poly, v: string): MathNode {
  const degrees = [...p.keys()].filter((d) => !coeff(p, d).isZero()).sort((a, b) => b - a);
  if (degrees.length === 0) return ZERO();
  const terms = degrees.map((d) => {
    const c = coeff(p, d);
    if (d === 0) return num(c);
    const body = d === 1 ? sym(v) : pow(sym(v), num(Rational.of(BigInt(d))));
    return makeTerm(c, [body]);
  });
  return terms.length === 1 ? terms[0]! : add(terms);
}

/** Long division: a = quotient * b + remainder, with deg(remainder) < deg(b). */
export function divmodPoly(a: Poly, b: Poly): { quotient: Poly; remainder: Poly } | null {
  const db = degree(b);
  if (db < 0) return null;
  const lead = coeff(b, db);
  const quotient: Poly = new Map();
  let remainder: Poly = new Map(a);
  for (let guard = 0; guard < 64; guard++) {
    const dr = degree(remainder);
    if (dr < db) return { quotient, remainder };
    const factor = coeff(remainder, dr).div(lead);
    const shift: Poly = new Map([[dr - db, factor]]);
    addTo(quotient, dr - db, factor);
    remainder = subPoly(remainder, mulPoly(shift, b));
  }
  return null;
}

/** Divide by (x - r), which is exact when r really is a root. */
export function divideByRoot(p: Poly, r: Rational): Poly {
  const n = degree(p);
  const out: Poly = new Map();
  let carry = Rational.ZERO;
  for (let d = n; d >= 1; d--) {
    carry = coeff(p, d).add(carry.mul(r));
    addTo(out, d - 1, carry);
  }
  return out;
}

/** Every positive divisor of n, or null when n is too big to enumerate. */
function divisors(n: bigint): bigint[] | null {
  const abs = n < 0n ? -n : n;
  if (abs === 0n || abs > 1000000n) return null;
  const out: bigint[] = [];
  for (let i = 1n; i * i <= abs; i++) {
    if (abs % i === 0n) {
      out.push(i);
      if (i !== abs / i) out.push(abs / i);
    }
  }
  return out;
}

/**
 * A rational root, by the rational root theorem: after clearing denominators
 * every root p/q has p dividing the constant term and q the leading one. A
 * search, not a formula, which is why the caller has to be ready for null.
 */
export function rationalRoot(p: Poly): Rational | null {
  const deg = degree(p);
  if (deg < 1) return null;
  if (coeff(p, 0).isZero()) return Rational.ZERO;

  let scale = 1n;
  for (const [, c] of p) scale = (scale / gcdBig(scale, c.d)) * c.d;
  const integral: Poly = scalePoly(p, Rational.of(scale));

  const constants = divisors(coeff(integral, 0).n);
  const leaders = divisors(coeff(integral, deg).n);
  if (!constants || !leaders) return null;

  for (const q of leaders) {
    for (const numerator of constants) {
      for (const sign of [1n, -1n]) {
        const candidate = Rational.of(sign * numerator, q);
        if (evalPoly(p, candidate).isZero()) return candidate;
      }
    }
  }
  return null;
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1n;
}

export interface LinearFactorisation {
  lead: Rational;
  /** One entry per distinct root, in the order they were found. */
  factors: Array<{ root: Rational; multiplicity: number }>;
}

/**
 * Split a polynomial into linear factors over the rationals, or return null.
 *
 * Null is the answer for x^2 + 1 and for anything whose roots are irrational:
 * both are real polynomials, neither has a partial-fraction decomposition this
 * engine can write down, and inventing one would be worse than declining.
 */
export function factorOverRationals(p: Poly): LinearFactorisation | null {
  const deg = degree(p);
  if (deg < 1) return null;
  const lead = coeff(p, deg);
  const found: Rational[] = [];
  let work = p;
  for (let guard = 0; guard < 16 && degree(work) > 0; guard++) {
    const root = rationalRoot(work);
    if (!root) return null;
    found.push(root);
    work = divideByRoot(work, root);
  }
  if (degree(work) !== 0) return null;

  const factors: LinearFactorisation["factors"] = [];
  for (const root of found) {
    const seen = factors.find((f) => f.root.equals(root));
    if (seen) seen.multiplicity++;
    else factors.push({ root, multiplicity: 1 });
  }
  return { lead, factors };
}
