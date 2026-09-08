import { type MathNode } from "./ast.js";
import { Rational } from "./rational.js";

export type Env = Record<string, number>;

const CONSTANTS: Env = { pi: Math.PI, e: Math.E };

/**
 * Step size for the numeric derivative, scaled by the size of the point. Paired
 * with the five-point formula below it keeps the relative error near 1e-12,
 * comfortably inside the verifier's 1e-7 tolerance even for a function as stiff
 * as tan close to a pole.
 */
const DERIVATIVE_STEP = 1e-4;

/** How far halving the step may move the answer before it stops being trusted. */
const DERIVATIVE_CONVERGENCE = 1e-7;

function fivePoint(f: (x: number) => number, at: number, h: number): number {
  return (f(at - 2 * h) - 8 * f(at - h) + 8 * f(at + h) - f(at + 2 * h)) / (12 * h);
}

/**
 * Five-point central difference, at two step sizes.
 *
 * A rule engine that gets the chain rule subtly wrong emits an expression that
 * looks entirely plausible, so evaluating the derivative numerically is the only
 * cheap check that catches it. The five-point form is used rather than the
 * two-point one because its error falls off as h^4, which leaves the shared
 * verification tolerance alone.
 *
 * Halving the step should then barely move the answer. Where it does, the
 * function is too steep for any difference quotient to resolve — a sample point
 * that lands a few hundredths away from a pole of tan is enough — and NaN is
 * returned so the verifier skips that point rather than calling a correct
 * derivative wrong.
 */
export function differentiateNumerically(
  f: (x: number) => number,
  at: number,
  step = DERIVATIVE_STEP,
): number {
  const h = step * Math.max(1, Math.abs(at));
  const coarse = fivePoint(f, at, h);
  const fine = fivePoint(f, at, h / 2);
  if (!Number.isFinite(coarse) || !Number.isFinite(fine)) return NaN;
  const scale = Math.max(1, Math.abs(coarse), Math.abs(fine));
  if (Math.abs(coarse - fine) > DERIVATIVE_CONVERGENCE * scale) return NaN;
  return fine;
}

function evaluateDerivative(n: Extract<MathNode, { type: "fn" }>, env: Env): number {
  const [body, variable] = n.args;
  if (!body || !variable || variable.type !== "sym") return NaN;
  const at = env[variable.name];
  if (at === undefined || !Number.isFinite(at)) return NaN;
  return differentiateNumerically(
    (x) => evaluateNumeric(body, { ...env, [variable.name]: x }),
    at,
  );
}

/**
 * Floating point evaluation. Returns NaN when the expression is undefined at
 * this point (division by zero, sqrt of a negative, unknown symbol). The step
 * verifier treats NaN on both sides as "no information" rather than a mismatch.
 */
export function evaluateNumeric(n: MathNode, env: Env = {}): number {
  switch (n.type) {
    case "num":
      return n.value.toNumber();
    case "sym": {
      const v = env[n.name] ?? CONSTANTS[n.name];
      return v === undefined ? NaN : v;
    }
    case "add":
      return n.args.reduce((acc, a) => acc + evaluateNumeric(a, env), 0);
    case "mul":
      return n.args.reduce((acc, a) => acc * evaluateNumeric(a, env), 1);
    case "div": {
      const d = evaluateNumeric(n.den, env);
      if (d === 0) return NaN;
      return evaluateNumeric(n.num, env) / d;
    }
    case "pow": {
      const b = evaluateNumeric(n.base, env);
      const e = evaluateNumeric(n.exp, env);
      if (b < 0 && !Number.isInteger(e)) return NaN;
      if (b === 0 && e < 0) return NaN;
      return Math.pow(b, e);
    }
    case "neg":
      return -evaluateNumeric(n.arg, env);
    case "fn":
      // A derivative cannot evaluate its argument first: it has to re-evaluate
      // the body at shifted points, so it is handled before the generic path.
      if (n.name === "diff") return evaluateDerivative(n, env);
      return evaluateFunction(n.name, n.args.map((a) => evaluateNumeric(a, env)));
    case "rel":
      return NaN;
  }
}

function evaluateFunction(name: string, a: number[]): number {
  const x = a[0] ?? NaN;
  switch (name) {
    case "sqrt": return x < 0 ? NaN : Math.sqrt(x);
    case "root": {
      const d = a[1] ?? NaN;
      if (!Number.isFinite(d) || d === 0) return NaN;
      if (x < 0) return Number.isInteger(d) && d % 2 === 1 ? -Math.pow(-x, 1 / d) : NaN;
      return Math.pow(x, 1 / d);
    }
    case "abs": return Math.abs(x);
    case "sin": return Math.sin(x);
    case "cos": return Math.cos(x);
    case "tan": return Math.tan(x);
    case "sec": return 1 / Math.cos(x);
    case "csc": return 1 / Math.sin(x);
    case "cot": return 1 / Math.tan(x);
    case "arcsin": return Math.asin(x);
    case "arccos": return Math.acos(x);
    case "arctan": return Math.atan(x);
    case "sinh": return Math.sinh(x);
    case "cosh": return Math.cosh(x);
    case "tanh": return Math.tanh(x);
    case "ln": return x <= 0 ? NaN : Math.log(x);
    case "log": {
      const base = a[1];
      if (x <= 0) return NaN;
      if (base === undefined) return Math.log10(x);
      if (base <= 0 || base === 1) return NaN;
      return Math.log(x) / Math.log(base);
    }
    case "exp": return Math.exp(x);
    default: return NaN;
  }
}

/**
 * Exact evaluation for expressions built only from rational literals and
 * +, -, *, /, integer powers, and exact roots. Returns null when the value is
 * irrational or symbolic, so a caller can leave it alone rather than approximate.
 */
export function evaluateExact(n: MathNode): Rational | null {
  switch (n.type) {
    case "num":
      return n.value;
    case "sym":
      return null;
    case "add": {
      let acc = Rational.ZERO;
      for (const a of n.args) {
        const v = evaluateExact(a);
        if (!v) return null;
        acc = acc.add(v);
      }
      return acc;
    }
    case "mul": {
      let acc = Rational.ONE;
      for (const a of n.args) {
        const v = evaluateExact(a);
        if (!v) return null;
        acc = acc.mul(v);
      }
      return acc;
    }
    case "div": {
      const a = evaluateExact(n.num);
      const b = evaluateExact(n.den);
      if (!a || !b || b.isZero()) return null;
      return a.div(b);
    }
    case "pow": {
      const b = evaluateExact(n.base);
      const e = evaluateExact(n.exp);
      if (!b || !e || !e.isInteger()) return null;
      if (b.isZero() && e.isNegative()) return null;
      return b.powInt(e.n);
    }
    case "neg": {
      const v = evaluateExact(n.arg);
      return v ? v.neg() : null;
    }
    case "fn": {
      if (n.name === "sqrt") {
        const v = evaluateExact(n.args[0]!);
        return v ? v.nthRoot(2n) : null;
      }
      if (n.name === "root") {
        const v = evaluateExact(n.args[0]!);
        const d = evaluateExact(n.args[1]!);
        if (!v || !d || !d.isInteger() || d.n <= 0n) return null;
        return v.nthRoot(d.n);
      }
      if (n.name === "abs") {
        const v = evaluateExact(n.args[0]!);
        return v ? v.abs() : null;
      }
      return null;
    }
    case "rel":
      return null;
  }
}
