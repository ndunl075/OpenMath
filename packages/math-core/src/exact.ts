/**
 * Exact closed-form values: the trigonometric table, the inverse table, and
 * exact logarithms.
 *
 * Everything here is exact or absent. `\sin(\frac{\pi}{4})` is a square root
 * over two, never 0.7071, and an angle with no closed form comes back null so
 * the caller leaves it alone rather than approximating it.
 */

import { children, div, fn, key, type MathNode, mul, neg, num, sym } from "./ast.js";
import { evaluateExact } from "./evaluate.js";
import { Rational } from "./rational.js";

// ------------------------------------------------------------------- surds

/**
 * `a` times the square root of `root`, with `root` a positive squarefree
 * integer. `root === 1n` is an ordinary rational.
 *
 * This is the whole value language of school trigonometry: every sine, cosine
 * and tangent of a multiple of pi/6 or pi/4 is one of these, and so is every
 * argument the inverse functions have an exact answer for. Keeping them in one
 * normal form is what makes recognising `\frac{\sqrt{2}}{2}` in an argument the
 * same operation as printing it in an answer.
 */
export interface Surd {
  a: Rational;
  root: bigint;
}

/** Pull square factors out of the radicand so every surd has one spelling. */
export function surd(a: Rational, root: bigint = 1n): Surd {
  if (root <= 0n) throw new RangeError("surd: radicand must be positive");
  if (a.isZero()) return { a: Rational.ZERO, root: 1n };
  let inside = root;
  let outside = 1n;
  for (let f = 2n; f * f <= inside; f++) {
    while (inside % (f * f) === 0n) {
      inside /= f * f;
      outside *= f;
    }
  }
  return { a: a.mul(Rational.of(outside)), root: inside };
}

const ZERO_SURD: Surd = { a: Rational.ZERO, root: 1n };

function surdNeg(s: Surd): Surd {
  return { a: s.a.neg(), root: s.root };
}
function surdMul(x: Surd, y: Surd): Surd {
  return surd(x.a.mul(y.a), x.root * y.root);
}
function surdEquals(x: Surd, y: Surd): boolean {
  return x.a.equals(y.a) && (x.a.isZero() || x.root === y.root);
}

function surdDiv(x: Surd, y: Surd): Surd | null {
  if (y.a.isZero()) return null;
  // Rationalise: √p / √q = √(pq) / q.
  return surd(x.a.div(y.a).div(Rational.of(y.root)), x.root * y.root);
}

function surdAdd(x: Surd, y: Surd): Surd | null {
  if (x.a.isZero()) return y;
  if (y.a.isZero()) return x;
  if (x.root !== y.root) return null; // √2 + √3 has no single-surd form
  return { a: x.a.add(y.a), root: x.root };
}

function surdPow(x: Surd, e: bigint): Surd | null {
  if (e < 0n) {
    const inverted = surdDiv({ a: Rational.ONE, root: 1n }, x);
    return inverted ? surdPow(inverted, -e) : null;
  }
  if (e > 8n) return null;
  let acc: Surd = { a: Rational.ONE, root: 1n };
  for (let i = 0n; i < e; i++) acc = surdMul(acc, x);
  return acc;
}

function surdSqrt(x: Surd): Surd | null {
  if (x.root !== 1n) return null; // √√2 is outside this language
  if (x.a.isNegative()) return null;
  // √(p/q) = √(pq)/q, and `surd` reduces whatever squares are in there.
  return surd(Rational.of(1n, x.a.d), x.a.n * x.a.d);
}

/**
 * Read a node as `a√r`, or null when it is anything else. This is what lets the
 * inverse trigonometric rules recognise `\frac{\sqrt{3}}{2}` however it was
 * written, without ever comparing floating point numbers.
 */
export function asSurd(n: MathNode): Surd | null {
  switch (n.type) {
    case "num":
      return { a: n.value, root: 1n };
    case "sym":
      return null;
    case "neg": {
      const inner = asSurd(n.arg);
      return inner ? surdNeg(inner) : null;
    }
    case "add": {
      let acc: Surd = ZERO_SURD;
      for (const a of n.args) {
        const s = asSurd(a);
        if (!s) return null;
        const next = surdAdd(acc, s);
        if (!next) return null;
        acc = next;
      }
      return acc;
    }
    case "mul": {
      let acc: Surd = { a: Rational.ONE, root: 1n };
      for (const a of n.args) {
        const s = asSurd(a);
        if (!s) return null;
        acc = surdMul(acc, s);
      }
      return acc;
    }
    case "div": {
      const a = asSurd(n.num);
      const b = asSurd(n.den);
      if (!a || !b) return null;
      return surdDiv(a, b);
    }
    case "pow": {
      const b = asSurd(n.base);
      if (!b || n.exp.type !== "num" || !n.exp.value.isInteger()) return null;
      return surdPow(b, n.exp.value.n);
    }
    case "fn": {
      const arg = n.args[0];
      if (!arg) return null;
      if (n.name === "sqrt") {
        const s = asSurd(arg);
        return s ? surdSqrt(s) : null;
      }
      if (n.name === "abs") {
        const s = asSurd(arg);
        return s ? { a: s.a.abs(), root: s.root } : null;
      }
      return null;
    }
    case "rel":
      return null;
  }
}

/**
 * `\frac{\sqrt{2}}{2}`, not `\frac{1}{2}\sqrt{2}`: the form a student writes.
 * A minus sign goes in front of the whole fraction rather than on top of it,
 * which is where it belongs and where the step normalizer would move it anyway.
 */
export function surdToNode(s: Surd): MathNode {
  if (s.root === 1n) return num(s.a);
  const radical = fn("sqrt", [num(Rational.of(s.root))]);
  const size = s.a.abs();
  const top = size.n === 1n ? radical : mul([num(Rational.of(size.n)), radical]);
  const body = size.d === 1n ? top : div(top, num(Rational.of(size.d)));
  return s.a.isNegative() ? neg(body) : body;
}

// ------------------------------------------------------- angles as twelfths

/**
 * The coefficient `k` in `k·pi`, or null when the expression is not a rational
 * multiple of pi. Zero counts, because `\sin(0)` is `\sin(0·pi)`.
 */
export function piMultiple(n: MathNode): Rational | null {
  const parsed = piForm(n);
  if (!parsed) return null;
  if (parsed.degree === 1) return parsed.coeff;
  // Anything free of pi is only an exact angle when it is zero: sin(1) has no
  // closed form, sin(0) does.
  if (parsed.degree === 0 && parsed.coeff.isZero()) return Rational.ZERO;
  return null;
}

/** `coeff · pi^degree`, the only shape an exact angle can take. */
function piForm(n: MathNode): { coeff: Rational; degree: number } | null {
  switch (n.type) {
    case "num":
      return { coeff: n.value, degree: 0 };
    case "sym":
      if (n.name === "pi") return { coeff: Rational.ONE, degree: 1 };
      return null;
    case "neg": {
      const inner = piForm(n.arg);
      return inner ? { coeff: inner.coeff.neg(), degree: inner.degree } : null;
    }
    case "add": {
      let acc: { coeff: Rational; degree: number } | null = null;
      for (const a of n.args) {
        const p = piForm(a);
        if (!p) return null;
        if (p.coeff.isZero()) continue;
        if (!acc) acc = p;
        else if (acc.degree !== p.degree) return null;
        else acc = { coeff: acc.coeff.add(p.coeff), degree: acc.degree };
      }
      return acc ?? { coeff: Rational.ZERO, degree: 0 };
    }
    case "mul": {
      let coeff = Rational.ONE;
      let degree = 0;
      for (const a of n.args) {
        const p = piForm(a);
        if (!p) return null;
        coeff = coeff.mul(p.coeff);
        degree += p.degree;
      }
      return { coeff, degree };
    }
    case "div": {
      const a = piForm(n.num);
      const b = piForm(n.den);
      if (!a || !b || b.coeff.isZero()) return null;
      return { coeff: a.coeff.div(b.coeff), degree: a.degree - b.degree };
    }
    case "pow": {
      const b = piForm(n.base);
      if (!b || n.exp.type !== "num" || !n.exp.value.isInteger()) return null;
      const e = n.exp.value.n;
      if (e < 0n || e > 4n) return null;
      const c = b.coeff.powInt(e);
      return c ? { coeff: c, degree: b.degree * Number(e) } : null;
    }
    case "fn":
    case "rel":
      return null;
  }
}

/**
 * The angle measured in twelfths of pi, reduced to one turn, or null when it is
 * not a whole number of twelfths. A twelfth is the coarsest unit that holds both
 * families the tables cover: pi/6 is two of them and pi/4 is three.
 */
export function twelfthsOfPi(angle: MathNode): number | null {
  const k = piMultiple(angle);
  if (!k) return null;
  const scaled = k.mul(Rational.of(12));
  if (!scaled.isInteger()) return null;
  const t = ((scaled.n % 24n) + 24n) % 24n;
  return Number(t);
}

/** sin, cos and tan at t·pi/12 for t in 0..6, i.e. the first quadrant. */
const SINE_QUADRANT: ReadonlyArray<Surd | null> = [
  { a: Rational.ZERO, root: 1n },        // 0
  null,                                  // pi/12, not in scope
  { a: Rational.of(1, 2), root: 1n },    // pi/6
  { a: Rational.of(1, 2), root: 2n },    // pi/4
  { a: Rational.of(1, 2), root: 3n },    // pi/3
  null,                                  // 5pi/12, not in scope
  { a: Rational.ONE, root: 1n },         // pi/2
];

const TANGENT_QUADRANT: ReadonlyArray<Surd | null> = [
  { a: Rational.ZERO, root: 1n },        // 0
  null,
  { a: Rational.of(1, 3), root: 3n },    // pi/6
  { a: Rational.ONE, root: 1n },         // pi/4
  { a: Rational.ONE, root: 3n },         // pi/3
  null,
  null,                                  // pi/2 is a pole, handled separately
];

/** sin at t twelfths of pi, folded onto the first quadrant by symmetry. */
export function sineAt(t: number): Surd | null {
  const u = ((t % 24) + 24) % 24;
  if (u <= 6) return SINE_QUADRANT[u] ?? null;
  if (u <= 12) return SINE_QUADRANT[12 - u] ?? null;
  const below = u <= 18 ? SINE_QUADRANT[u - 12] : SINE_QUADRANT[24 - u];
  return below ? surdNeg(below) : null;
}

export function cosineAt(t: number): Surd | null {
  return sineAt(t + 6);
}

/** True where tan has a vertical asymptote, i.e. at an odd multiple of pi/2. */
export function isTangentPole(t: number): boolean {
  return (((t % 12) + 12) % 12) === 6;
}

export function tangentAt(t: number): Surd | null {
  const u = ((t % 12) + 12) % 12;
  if (u === 6) return null; // undefined, not merely unknown
  if (u < 6) return TANGENT_QUADRANT[u] ?? null;
  const below = TANGENT_QUADRANT[12 - u];
  return below ? surdNeg(below) : null;
}

/** 1/(a√r), written back as a surd: the reciprocal rationalises to a/(a^2 r) √r. */
function surdInverse(s: Surd): Surd | null {
  if (s.a.isZero()) return null;
  return surd(s.a.mul(Rational.of(s.root)).inv(), s.root);
}

/**
 * The exact value of `name(angle)`, or null when there is not one.
 *
 * The reciprocal three are here as well as the familiar three, because a
 * derivative rule produces them: differentiating a tangent gives a secant
 * squared, and a limit that goes through l'Hopital's rule then has one sitting
 * where its answer should be.
 */
export function exactTrig(name: string, angle: MathNode): MathNode | null {
  const t = twelfthsOfPi(angle);
  if (t === null) return null;
  const reciprocal = (v: Surd | null) => (v ? surdInverse(v) : null);
  const value =
    name === "sin" ? sineAt(t)
    : name === "cos" ? cosineAt(t)
    : name === "tan" ? tangentAt(t)
    : name === "csc" ? reciprocal(sineAt(t))
    : name === "sec" ? reciprocal(cosineAt(t))
    : name === "cot" ? reciprocal(tangentAt(t))
    : null;
  return value ? surdToNode(value) : null;
}

/** The angle in twelfths of pi whose sine, cosine or tangent is `value`. */
function twelfthsWithValue(
  at: (t: number) => Surd | null,
  value: Surd,
  range: readonly number[],
): number | null {
  for (const t of range) {
    const v = at(t);
    if (v && surdEquals(v, value)) return t;
  }
  return null;
}

/** t twelfths of pi as an expression: 0, pi, pi/2, -pi/3 and so on. */
export function angleFromTwelfths(t: number): MathNode {
  const k = Rational.of(t, 12);
  if (k.isZero()) return num(Rational.ZERO);
  const pi = sym("pi");
  const body = k.n === 1n || k.n === -1n ? pi : mul([num(Rational.of(k.n < 0n ? -k.n : k.n)), pi]);
  const positive = k.d === 1n ? body : div(body, num(Rational.of(k.d)));
  return k.isNegative() ? neg(positive) : positive;
}

/**
 * arcsin, arccos and arctan where the answer is a named angle.
 *
 * Each is read on its principal branch, which is why the ranges differ: arcsin
 * lands in [-pi/2, pi/2], arccos in [0, pi], arctan strictly inside
 * (-pi/2, pi/2). Returning the wrong branch would be a wrong answer that still
 * has the right sine.
 */
export function exactInverseTrig(name: string, argument: MathNode): MathNode | null {
  const value = asSurd(argument);
  if (!value) return null;
  const half = [-6, -4, -3, -2, 0, 2, 3, 4, 6];
  const full = [0, 2, 3, 4, 6, 8, 9, 10, 12];
  const open = [-4, -3, -2, 0, 2, 3, 4];
  const t =
    name === "arcsin" ? twelfthsWithValue(sineAt, value, half)
    : name === "arccos" ? twelfthsWithValue(cosineAt, value, full)
    : name === "arctan" ? twelfthsWithValue(tangentAt, value, open)
    : null;
  return t === null ? null : angleFromTwelfths(t);
}

// --------------------------------------------------------------------- logs

/** Digits allowed in an exact power check, so a search cannot blow up. */
const MAX_LOG_DIGITS = 60;

/**
 * The exact value of log base `b` of `a`, or null when it is irrational.
 *
 * The candidate exponent is found with floating point and then *confirmed* with
 * exact integer arithmetic, so the answer is never a rounded logarithm: either
 * b^p equals a^q on the nose, or there is no answer to give.
 */
export function exactLogValue(a: Rational, b: Rational): Rational | null {
  if (a.isNegative() || a.isZero()) return null;
  if (b.isNegative() || b.isZero() || b.isOne()) return null;
  if (a.isOne()) return Rational.ZERO;

  const guess = Math.log(a.toNumber()) / Math.log(b.toNumber());
  if (!Number.isFinite(guess)) return null;
  const digits = (r: Rational) =>
    Math.max(r.n.toString().length, r.d.toString().length);
  for (let q = 1; q <= 8; q++) {
    const p = Math.round(guess * q);
    if (p === 0 || Math.abs(p) > 64) continue;
    if (digits(b) * Math.abs(p) > MAX_LOG_DIGITS) continue;
    if (digits(a) * q > MAX_LOG_DIGITS) continue;
    const left = b.powInt(BigInt(p));
    const right = a.powInt(BigInt(q));
    if (left && right && left.equals(right)) return Rational.of(p, q);
  }
  return null;
}

/** Is this a base a logarithm may be taken to? */
export function isValidLogBase(base: MathNode): boolean {
  if (base.type === "sym") return base.name === "e";
  const b = evaluateExact(base);
  return !!b && !b.isNegative() && !b.isZero() && !b.isOne();
}

/**
 * log base `base` of `argument`, exactly, or null.
 *
 * Three shapes have an exact answer: the base itself, any power of the base
 * (including a symbolic exponent, since log undoes the exponential whatever
 * sits up there), and a number that happens to be a rational power of the base.
 */
export function exactLog(argument: MathNode, base: MathNode): MathNode | null {
  if (!isValidLogBase(base)) return null;
  if (key(argument) === key(base)) return num(Rational.ONE);
  if (argument.type === "pow" && key(argument.base) === key(base)) return argument.exp;
  const a = evaluateExact(argument);
  if (!a) return null;
  if (a.isOne()) return num(Rational.ZERO);
  if (base.type === "sym") return null; // ln of a number that is not a power of e
  const b = evaluateExact(base);
  if (!b) return null;
  const value = exactLogValue(a, b);
  return value ? num(value) : null;
}

// -------------------------------------------------------- undefined values

/**
 * Why this expression has no value, or null when it has one.
 *
 * Checked on the way into the solver and on the way out, in the same spirit as
 * `hasDivisionByZero`: `\tan(\frac{\pi}{2})` and `\ln(0)` are not hard problems,
 * they are problems with no answer, and echoing them back as though they were
 * their own solution is worse than declining them.
 */
export function undefinedReason(n: MathNode): string | null {
  let reason: string | null = null;
  const report = (r: string) => {
    if (!reason) reason = r;
  };
  const visit = (x: MathNode): void => {
    if (x.type === "fn") {
      const arg = x.args[0];
      if (arg) {
        const t = twelfthsOfPi(arg);
        if (t !== null) {
          if ((x.name === "tan" || x.name === "sec") && isTangentPole(t)) {
            report(`\\${x.name} has no value at that angle: it is a vertical asymptote`);
          }
          if ((x.name === "cot" || x.name === "csc") && t % 12 === 0) {
            report(`\\${x.name} has no value at that angle: it is a vertical asymptote`);
          }
        }
        if (x.name === "ln" || x.name === "log") {
          const base = x.args[1];
          if (base && !isValidLogBase(base)) {
            report("a logarithm needs a positive base other than 1");
          }
          const v = evaluateExact(arg);
          if (v && (v.isZero() || v.isNegative())) {
            report("a logarithm is only defined for positive numbers");
          }
        }
        if (x.name === "arcsin" || x.name === "arccos") {
          const v = evaluateExact(arg);
          if (v && v.abs().cmp(Rational.ONE) > 0) {
            report(`\\${x.name} is only defined between -1 and 1`);
          }
        }
      }
    }
    for (const c of children(x)) visit(c);
  };
  visit(n);
  return reason;
}
