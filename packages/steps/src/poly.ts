import { type MathNode, Rational } from "@openmath/math-core";

/** Sparse polynomial: exponent -> coefficient. */
export type Poly = Map<number, Rational>;

function addTo(p: Poly, deg: number, c: Rational): void {
  const cur = p.get(deg) ?? Rational.ZERO;
  const next = cur.add(c);
  if (next.isZero()) p.delete(deg);
  else p.set(deg, next);
}

function mulPoly(a: Poly, b: Poly): Poly {
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
