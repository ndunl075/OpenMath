import {
  evaluateNumeric, type Env, freeSymbols, type MathNode,
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
