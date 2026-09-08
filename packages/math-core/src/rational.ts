/**
 * Exact rational arithmetic on BigInt.
 *
 * Algebra steps must be exact: 1/3 + 1/6 has to be 1/2, never 0.4999999999999999.
 * Every numeric literal in the AST is a Rational.
 */

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export class Rational {
  /** Numerator, carries the sign. */
  readonly n: bigint;
  /** Denominator, always > 0. */
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    this.n = n;
    this.d = d;
  }

  static of(n: bigint | number, d: bigint | number = 1n): Rational {
    let nn = typeof n === "number" ? BigInt(Math.trunc(n)) : n;
    let dd = typeof d === "number" ? BigInt(Math.trunc(d)) : d;
    if (dd === 0n) throw new RangeError("Rational: zero denominator");
    if (dd < 0n) {
      nn = -nn;
      dd = -dd;
    }
    const g = gcd(nn, dd) || 1n;
    return new Rational(nn / g, dd / g);
  }

  /** Parse a decimal literal like "12", "3.25", ".5". Exact, no float round-trip. */
  static parse(literal: string): Rational {
    const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(literal.trim());
    if (!m) throw new SyntaxError(`Rational: cannot parse ${JSON.stringify(literal)}`);
    const sign = m[1] === "-" ? -1n : 1n;
    const whole = m[2] || "0";
    const frac = m[3] || "";
    if (whole === "0" && frac === "" && m[2] === "" ) {
      throw new SyntaxError(`Rational: cannot parse ${JSON.stringify(literal)}`);
    }
    const num = BigInt(whole + frac);
    const den = 10n ** BigInt(frac.length);
    return Rational.of(sign * num, den);
  }

  static readonly ZERO = Rational.of(0n);
  static readonly ONE = Rational.of(1n);
  static readonly NEG_ONE = Rational.of(-1n);

  add(o: Rational): Rational {
    return Rational.of(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Rational): Rational {
    return Rational.of(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Rational): Rational {
    return Rational.of(this.n * o.n, this.d * o.d);
  }
  div(o: Rational): Rational {
    if (o.isZero()) throw new RangeError("Rational: division by zero");
    return Rational.of(this.n * o.d, this.d * o.n);
  }
  neg(): Rational {
    return Rational.of(-this.n, this.d);
  }
  abs(): Rational {
    return this.n < 0n ? this.neg() : this;
  }
  inv(): Rational {
    if (this.isZero()) throw new RangeError("Rational: inverse of zero");
    return Rational.of(this.d, this.n);
  }

  /** Integer powers only. Returns null for a fractional exponent (caller keeps it symbolic). */
  powInt(e: bigint): Rational | null {
    if (e === 0n) return Rational.ONE;
    if (e < 0n) {
      if (this.isZero()) return null;
      return this.inv().powInt(-e);
    }
    return Rational.of(this.n ** e, this.d ** e);
  }

  isZero(): boolean {
    return this.n === 0n;
  }
  isOne(): boolean {
    return this.n === 1n && this.d === 1n;
  }
  isNegative(): boolean {
    return this.n < 0n;
  }
  isInteger(): boolean {
    return this.d === 1n;
  }
  equals(o: Rational): boolean {
    return this.n === o.n && this.d === o.d;
  }
  /** -1, 0 or 1. */
  cmp(o: Rational): number {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  /**
   * Exact integer n-th root, or null when the root is irrational.
   * Used to decide whether sqrt(x) can be simplified to a number.
   */
  nthRoot(k: bigint): Rational | null {
    if (k <= 0n) return null;
    const rootOf = (v: bigint): bigint | null => {
      if (v < 0n) return null;
      if (v < 2n) return v;
      let lo = 1n;
      let hi = v;
      while (lo <= hi) {
        const mid = (lo + hi) / 2n;
        const p = mid ** k;
        if (p === v) return mid;
        if (p < v) lo = mid + 1n;
        else hi = mid - 1n;
      }
      return null;
    };
    if (this.isNegative() && k % 2n === 0n) return null;
    const sign = this.isNegative() ? -1n : 1n;
    const rn = rootOf(this.n < 0n ? -this.n : this.n);
    const rd = rootOf(this.d);
    if (rn === null || rd === null) return null;
    return Rational.of(sign * rn, rd);
  }

  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }

  toString(): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
  }

  /** LaTeX form. Fractions render as \frac, negatives keep the sign on the numerator. */
  toLatex(): string {
    if (this.d === 1n) return this.n.toString();
    const neg = this.n < 0n;
    const a = (neg ? -this.n : this.n).toString();
    const body = `\\frac{${a}}{${this.d}}`;
    return neg ? `-${body}` : body;
  }
}
