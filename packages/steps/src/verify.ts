import {
  add, asIntegral, containsIntegral, diff, div, evaluateNumeric, type Env,
  freeSymbols, type MathNode, mul, neg, sym, symbols,
} from "@openmath/math-core";

export type Verdict = "ok" | "unknown" | "mismatch";

const REL_TOLERANCE = 1e-7;

/** Deterministic sample points, so a test that passes today passes tomorrow. */
function samplePoints(count: number): number[] {
  const fixed = [0.5, 1.5, -2.25, 3.125, -0.75, 7.5, -4.5, 2.375, 11.25, -9.125];
  const out: number[] = [];
  let seed = 20260908;
  for (let i = 0; i < count; i++) {
    if (i < fixed.length) {
      out.push(fixed[i]!);
      continue;
    }
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out.push((seed / 2147483648) * 20 - 10);
  }
  return out;
}

function environments(vars: string[], count: number): Env[] {
  const pts = samplePoints(count + vars.length * 3);
  const envs: Env[] = [];
  for (let i = 0; i < count; i++) {
    const env: Env = {};
    vars.forEach((v, j) => {
      env[v] = pts[(i + j * 3) % pts.length]!;
    });
    envs.push(env);
  }
  return envs;
}

function close(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= REL_TOLERANCE * scale;
}

/**
 * Are these two expressions equal for every value of their variables?
 *
 * Sampling cannot prove equality, but it reliably catches the rewrites a rule
 * engine gets wrong. "unknown" means every sample was undefined (a division by
 * zero, say) and the caller should not claim the step was checked.
 */
export function verifyEquivalent(a: MathNode, b: MathNode, samples = 12): Verdict {
  const vars = [...new Set([...freeSymbols(a), ...freeSymbols(b)])];
  const envs = vars.length === 0 ? [{}] : environments(vars, samples);
  let compared = 0;
  for (const env of envs) {
    const va = evaluateNumeric(a, env);
    const vb = evaluateNumeric(b, env);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    compared++;
    if (!close(va, vb)) return "mismatch";
  }
  return compared === 0 ? "unknown" : "ok";
}

/**
 * Do these two equations have the same solutions?
 *
 * Every equation rule here multiplies the whole equation by a non-zero constant
 * or rearranges it, so lhs - rhs must stay proportional. Checking the ratio is
 * constant across samples catches a dropped term or a sign error, which
 * comparing the sides directly would not.
 */
export function verifyEquationEquivalent(
  before: MathNode,
  after: MathNode,
  samples = 12,
): Verdict {
  if (before.type !== "rel" || after.type !== "rel") return "unknown";
  const diffBefore: MathNode = {
    type: "add", id: -1,
    args: [before.lhs, { type: "neg", id: -2, arg: before.rhs }],
  };
  const diffAfter: MathNode = {
    type: "add", id: -3,
    args: [after.lhs, { type: "neg", id: -4, arg: after.rhs }],
  };
  const vars = [...new Set([...freeSymbols(before), ...freeSymbols(after)])];
  const envs = vars.length === 0 ? [{}] : environments(vars, samples);

  let ratio: number | null = null;
  let compared = 0;
  let bothZero = 0;
  for (const env of envs) {
    const a = evaluateNumeric(diffBefore, env);
    const b = evaluateNumeric(diffAfter, env);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) {
      bothZero++;
      continue;
    }
    if (Math.abs(a) < 1e-12 || Math.abs(b) < 1e-12) return "mismatch";
    compared++;
    const r = b / a;
    if (ratio === null) ratio = r;
    else if (!close(r, ratio)) return "mismatch";
  }
  // Both sides vanish everywhere: an identity rewritten as another identity.
  if (compared === 0 && bothZero > 0) return "ok";
  if (compared === 0) return "unknown";
  return ratio !== null && Math.abs(ratio) > 1e-12 ? "ok" : "mismatch";
}

/** Does substituting `value` for `variable` satisfy the equation? */
export function checkSolution(equation: MathNode, variable: string, value: number): Verdict {
  if (equation.type !== "rel") return "unknown";
  const env: Env = { [variable]: value };
  const l = evaluateNumeric(equation.lhs, env);
  const r = evaluateNumeric(equation.rhs, env);
  if (!Number.isFinite(l) || !Number.isFinite(r)) return "unknown";
  return close(l, r) ? "ok" : "mismatch";
}

/**
 * Does `answer` really give the derivative that `problem` asks for?
 *
 * `problem` still contains the unevaluated d/dv nodes, and `evaluateNumeric`
 * works those out as a five-point central difference, so this compares the true
 * slope with the claimed one at each sample point. It is the check that catches
 * a chain rule applied to the wrong layer, or an inner derivative dropped
 * altogether: both produce an expression that reads perfectly well and is simply
 * a different function. A few usable points are required before the answer
 * counts as checked, so one that is undefined everywhere we looked comes back
 * "unknown" rather than passing by default.
 */
export function verifyDerivative(
  problem: MathNode,
  answer: MathNode,
  variable: string,
  samples = 16,
): Verdict {
  const envs = environments([variable], samples);
  let compared = 0;
  for (const env of envs) {
    const slope = evaluateNumeric(problem, env);
    const claimed = evaluateNumeric(answer, env);
    if (!Number.isFinite(slope) || !Number.isFinite(claimed)) continue;
    compared++;
    if (!close(slope, claimed)) return "mismatch";
  }
  return compared >= 3 ? "ok" : "unknown";
}

/**
 * How far apart two limits may be and still count as the same.
 *
 * Looser than the tolerance for an identity, and deliberately so: a limit is not
 * evaluated, it is *measured*, by walking in towards the point and extrapolating.
 * A slowly settling limit such as ln(x)/x carries a residue of a few parts in a
 * million after extrapolation, while a rule that got the limit wrong misses by a
 * whole number. This tolerance sits comfortably between the two.
 */
const LIMIT_TOLERANCE = 1e-4;

function closeLimit(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= LIMIT_TOLERANCE * scale;
}

/**
 * Do these two expressions, one or both of them a limit, come out the same?
 *
 * Used instead of `verifyEquivalent` for a step that rewrites a limit. Sampling
 * for equality is the wrong question there: `\frac{\sin x}{x}` and 1 are equal
 * at no point whatsoever, only in the limit, so what is compared is where each
 * side is heading rather than what each side is.
 */
export function verifyLimitEquivalent(a: MathNode, b: MathNode, samples = 4): Verdict {
  const vars = [...new Set([...freeSymbols(a), ...freeSymbols(b)])];
  const envs = vars.length === 0 ? [{}] : environments(vars, samples);
  let compared = 0;
  for (const env of envs) {
    const va = evaluateNumeric(a, env);
    const vb = evaluateNumeric(b, env);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    compared++;
    if (!closeLimit(va, vb)) return "mismatch";
  }
  return compared === 0 ? "unknown" : "ok";
}

/**
 * Does the original expression really approach the claimed answer?
 *
 * A limit is not an algebraic identity, so `verifyEquivalent` has nothing to
 * sample. This evaluates the *problem*, `lim` node and all, which
 * `evaluateNumeric` does by walking the expression in towards the point and
 * extrapolating, and compares that with the answer the rules produced.
 *
 * What it cannot catch: a function that only misbehaves closer to the point than
 * the samples reach, a divergence too slow to show over five decades of
 * approach, and a limit whose true value differs from the claimed one by less
 * than the tolerance. The first two come back "unknown", so the failure mode is
 * a correct limit reported as unchecked rather than a wrong one reported as
 * checked.
 */
export function verifyLimit(problem: MathNode, answer: MathNode): Verdict {
  if (freeSymbols(answer).size > 0) return "unknown";
  const claimed = evaluateNumeric(answer);
  if (!Number.isFinite(claimed)) return "unknown";
  const observed = evaluateNumeric(problem);
  if (!Number.isFinite(observed)) return "unknown";
  return closeLimit(observed, claimed) ? "ok" : "mismatch";
}

/**
 * Does `answer` differentiate back to `integrand`?
 *
 * This is the whole safety story for integration. Finding an antiderivative is
 * a search over heuristics that guess; checking one is a single derivative.
 * `evaluateNumeric` works a d/dv node out as a five-point central difference,
 * so no symbolic differentiation is involved and a guess that happens to be a
 * different function is caught however plausible it reads.
 */
export function verifyAntiderivative(
  answer: MathNode,
  integrand: MathNode,
  variable: string,
  samples = 16,
): Verdict {
  return verifyEquivalent(diff(answer, sym(variable)), integrand, samples);
}

/**
 * Do these two expressions differ by a constant?
 *
 * Two antiderivatives of the same function are equal up to one, so comparing
 * them for equality is the wrong test: x^2/2 and (x^2+1)/2 are both right. What
 * has to stay fixed across the samples is the gap between them.
 */
export function verifyDifferByConstant(a: MathNode, b: MathNode, samples = 16): Verdict {
  const vars = [...new Set([...freeSymbols(a), ...freeSymbols(b)])];
  const envs = vars.length === 0 ? [{}] : environments(vars, samples);
  // The gap is a difference of two values that may both be enormous, so the
  // tolerance has to be relative to those values and not to the gap: e^{34}/3
  // computed two ways agrees to twelve digits and still differs by 0.03.
  const gaps: Array<{ gap: number; scale: number }> = [];
  for (const env of envs) {
    const va = evaluateNumeric(a, env);
    const vb = evaluateNumeric(b, env);
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    gaps.push({ gap: va - vb, scale: Math.max(1, Math.abs(va), Math.abs(vb)) });
  }
  const first = gaps[0];
  if (!first || gaps.length < 2) return "unknown";
  for (const each of gaps) {
    const scale = Math.max(first.scale, each.scale);
    if (Math.abs(each.gap - first.gap) > REL_TOLERANCE * scale) return "mismatch";
  }
  return "ok";
}

/**
 * d/dv of an expression that still contains unevaluated integrals.
 *
 * Every integration rule leaves its integrals in a linear combination — split
 * off a term, pull a constant out, hand back `uv - \int v du` — so the
 * derivative can be pushed through the sum, the sign and the constant factor
 * until it lands on an integral node, where it is just the integrand again.
 * Anything else (an integral inside a power, a product of two integrals) is not
 * something a rule here produces, and null is returned rather than guessed at.
 */
function derivativeThroughIntegrals(n: MathNode, v: string): MathNode | null {
  if (!containsIntegral(n)) return diff(n, sym(v));

  const here = asIntegral(n);
  if (here) {
    // A definite integral is a number, so its derivative is zero; but nothing
    // here produces one mid-solve, so treat it as out of scope instead.
    if (here.bounds || here.variable !== v) return null;
    return here.body;
  }

  switch (n.type) {
    case "add": {
      const parts = n.args.map((a) => derivativeThroughIntegrals(a, v));
      return parts.every((p): p is MathNode => p !== null) ? add(parts) : null;
    }
    case "neg": {
      const inner = derivativeThroughIntegrals(n.arg, v);
      return inner ? neg(inner) : null;
    }
    case "mul": {
      const carrying = n.args.filter(containsIntegral);
      if (carrying.length !== 1) return null;
      const constants = n.args.filter((a) => !containsIntegral(a));
      if (constants.some((c) => symbols(c).has(v))) return null;
      const inner = derivativeThroughIntegrals(carrying[0]!, v);
      return inner ? mul([...constants, inner]) : null;
    }
    case "div": {
      if (containsIntegral(n.den) || symbols(n.den).has(v)) return null;
      const inner = derivativeThroughIntegrals(n.num, v);
      return inner ? div(inner, n.den) : null;
    }
    default:
      return null;
  }
}

/**
 * Is this step of an integration still the same problem?
 *
 * Comparing the two expressions directly is the wrong test while an integral
 * is still standing: an indefinite integral has no single value to compare.
 * Differentiating both sides first removes the integrals and leaves two
 * ordinary functions, which sampling settles. It cannot see a constant added to
 * a term that is already integrated, and does not need to: for an indefinite
 * integral that constant is absorbed into C, and a definite one is checked
 * against numeric quadrature end to end.
 */
export function verifyIntegrationStep(
  before: MathNode,
  after: MathNode,
  variable: string | undefined,
  samples = 16,
): Verdict {
  if (!variable) return "unknown";
  const db = derivativeThroughIntegrals(before, variable);
  const da = derivativeThroughIntegrals(after, variable);
  if (!db || !da) return "unknown";
  return verifyEquivalent(db, da, samples);
}
