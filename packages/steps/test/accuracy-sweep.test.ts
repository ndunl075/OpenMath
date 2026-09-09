import { describe, expect, it } from "vitest";
import { problems } from "@openmath/corpus";
import {
  asSummation, containsIntegral, containsLimit, evaluateNumeric, parseLatex,
} from "@openmath/math-core";
import { trySolve } from "@openmath/steps";
import { differentiate, resolveDerivatives } from "../src/symbolic-diff.js";

/**
 * A broad sweep for wrong answers, as opposed to missing ones.
 *
 * Everything here is checked against something that is not the solver: a
 * separately written differentiator, Simpson's rule, or substitution back into
 * the original problem. None of it uses the solver's own verifier, which is
 * what decides whether a step is shown and would therefore only be confirming
 * that it agrees with itself.
 *
 * A refusal is not a failure in this file. The question being asked is whether
 * an answer that *was* given is right.
 */

const PTS = [0.31, 0.62, 1.23, 1.87, 2.41];

function agreesAt(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

describe("derivatives agree with an independently written differentiator", () => {
  const INNER = ["x", "2x", "x^{2}", "3x+1", "x^{3}"];
  const OUTER = [
    "\\sin", "\\cos", "\\tan", "\\ln", "\\arctan", "\\arcsin", "\\sec", "\\sinh", "\\exp",
  ];
  const POWERS = ["x^{2}", "x^{5}", "x^{-2}", "x^{\\frac{1}{2}}", "x^{\\frac{1}{3}}", "\\sqrt{x}"];

  const cases: string[] = [];
  for (const o of OUTER) for (const i of INNER) cases.push(`${o}(${i})`);
  cases.push(...POWERS);
  for (const a of ["x", "\\sin(x)", "e^{x}", "\\ln(x)"]) {
    for (const b of ["x^{2}", "\\cos(x)", "e^{x}"]) {
      cases.push(`${a} ${b}`, `\\frac{${a}}{${b}}`);
    }
  }

  it(`checks ${cases.length} derivatives`, () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const f of cases) {
      const r = trySolve(`\\frac{d}{dx}(${f})`);
      if (!r.ok) continue;
      const independent = differentiate(parseLatex(f), "x");
      if (!independent) continue;
      const claimed = parseLatex(r.solution.answer);
      let compared = 0;
      for (const x of PTS) {
        const a = evaluateNumeric(independent, { x });
        const b = evaluateNumeric(claimed, { x });
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        compared++;
        if (!agreesAt(a, b)) {
          wrong.push(`d/dx(${f}) = ${r.solution.answer}; at x=${x} that is ${b}, not ${a}`);
          break;
        }
      }
      if (compared > 0) checked++;
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(60);
  });
});

describe("antiderivatives differentiate back to their integrand", () => {
  const cases = [
    "x^{2}", "x^{5}", "x^{-2}", "\\sin(x)", "\\cos(x)", "e^{x}", "\\frac{1}{x}",
    "\\tan(x)", "\\sec(x)", "\\csc(x)", "\\cot(x)", "\\sin(x)^{2}", "\\cos(x)^{2}",
    "\\sin(x)^{3}", "\\cos(x)^{3}", "\\sin(x)^{5}", "\\sin(2x)", "\\cos(3x)", "e^{2x}",
    "x e^{x}", "x^{2}e^{x}", "x\\sin(x)", "x\\cos(x)", "\\ln(x)", "x\\ln(x)", "x^{2}\\ln(x)",
    "\\frac{1}{x^{2}+1}", "\\frac{1}{x^{2}+4}", "\\frac{1}{x^{2}+2x+5}", "\\frac{x}{x^{2}+1}",
    "\\frac{1}{x^{2}-1}", "\\frac{1}{x^{2}-4}", "\\frac{x^{2}}{x^{2}+1}", "(2x+1)^{5}",
    "\\frac{\\ln(x)}{x}", "\\frac{1}{x\\ln(x)}", "2x(x^{2}+1)^{3}", "\\frac{1}{\\sqrt{1-x^{2}}}",
  ];

  it(`checks ${cases.length} antiderivatives`, () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const f of cases) {
      const r = trySolve(`\\int ${f} \\, dx`);
      if (!r.ok) continue;
      const answer = parseLatex(r.solution.answer.replace(/\s*\+\s*C$/, ""));
      const back = differentiate(answer, "x");
      if (!back) continue;
      const integrand = parseLatex(f);
      let compared = 0;
      for (const x of PTS) {
        const a = evaluateNumeric(back, { x });
        const b = evaluateNumeric(integrand, { x });
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        compared++;
        if (!agreesAt(a, b)) {
          wrong.push(`int ${f} = ${r.solution.answer}; its derivative at x=${x} is ${a}, not ${b}`);
          break;
        }
      }
      if (compared > 0) checked++;
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(25);
  });
});

/** Quadratics, linears and the named equation forms. */
function equationCases(): string[] {
  const out: string[] = [];
  for (const a of [1, 2, 3, -2]) {
    for (const b of [0, 1, -5, 7]) {
      for (const c of [-6, 0, 4, -12]) {
        out.push(`${a}x^{2}${b >= 0 ? "+" : ""}${b}x${c >= 0 ? "+" : ""}${c}=0`);
      }
    }
  }
  for (const k of [3, -4, 11, 0]) out.push(`2x+3=${k}`, `\\frac{x}{3}-1=${k}`, `x^{3}=${k}`);
  out.push("\\sqrt{x}=3", "\\sqrt{x+1}=4", "\\ln(x)=2", "e^{x}=5", "2^{x}=8", "|x|=3");
  return out;
}

describe("every root satisfies the equation it came from", () => {
  it("substitutes each answer back into the original", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const latex of equationCases()) {
      const r = trySolve(latex);
      if (!r.ok) continue;
      const equation = parseLatex(r.solution.problem);
      if (equation.type !== "rel") continue;
      for (const answer of r.solution.answers) {
        const m = /^\s*[a-zA-Z]\s*=\s*(.+)$/.exec(answer);
        if (!m) continue;
        const value = evaluateNumeric(parseLatex(m[1]!));
        if (!Number.isFinite(value)) continue;
        const lhs = evaluateNumeric(equation.lhs, { x: value });
        const rhs = evaluateNumeric(equation.rhs, { x: value });
        if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) continue;
        checked++;
        if (!agreesAt(lhs, rhs)) {
          wrong.push(`${latex} gives ${answer}, but that leaves ${lhs} = ${rhs}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(80);
  });
});

describe("a claim of no solution is not hiding a root", () => {
  it("finds no sign change anywhere the solver reported nothing", () => {
    const extra = ["x^{2}+1=0", "x^{2}=-4", "e^{x}=-1", "\\sqrt{x}=-2", "|x|=-3", "x^{2}+x+1=0"];
    const wrong: string[] = [];
    let claims = 0;
    for (const latex of [...equationCases(), ...extra]) {
      const r = trySolve(latex);
      if (!r.ok) continue;
      // A repeated root is still a root; only an empty answer set is a claim
      // that nothing at all solves the equation.
      if (r.solution.answers.some((a) => /=/.test(a))) continue;
      claims++;
      const equation = parseLatex(r.solution.problem);
      if (equation.type !== "rel") continue;
      let previous: number | null = null;
      for (let x = -50; x <= 50; x += 0.05) {
        const lhs = evaluateNumeric(equation.lhs, { x });
        const rhs = evaluateNumeric(equation.rhs, { x });
        if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) { previous = null; continue; }
        const gap = lhs - rhs;
        if (Math.abs(gap) < 1e-9) {
          wrong.push(`${latex} reports no solution, but x=${x.toFixed(2)} solves it`);
          break;
        }
        if (previous !== null && Math.sign(gap) !== Math.sign(previous)) {
          wrong.push(`${latex} reports no solution, but one sits near x=${x.toFixed(2)}`);
          break;
        }
        previous = gap;
      }
    }
    expect(wrong).toEqual([]);
    expect(claims).toBeGreaterThan(15);
  });
});

describe("definite integrals match independent quadrature", () => {
  const cases: Array<[string, number, number]> = [
    ["x^{2}", 0, 1], ["\\sin(x)", 0, 3], ["e^{x}", 0, 2], ["\\frac{1}{x}", 1, 5],
    ["\\cos(x)", 0, 1], ["\\sin(x)^{2}", 0, 3], ["\\cos(x)^{2}", 0, 2], ["x^{3}", 1, 4],
    ["\\frac{1}{x^{2}+1}", 0, 1], ["x e^{x}", 0, 1], ["\\sqrt{x}", 1, 4], ["\\tan(x)", 0, 1],
  ];

  it("compares each against Simpson's rule on the original integrand", () => {
    const wrong: string[] = [];
    for (const [f, from, to] of cases) {
      const r = trySolve(`\\int_{${from}}^{${to}} ${f} \\, dx`);
      if (!r.ok) continue;
      const got = evaluateNumeric(parseLatex(r.solution.answer));
      const body = parseLatex(f);
      const n = 2000;
      const h = (to - from) / n;
      let sum = 0;
      for (let i = 0; i <= n; i++) {
        const weight = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
        sum += weight * evaluateNumeric(body, { x: from + i * h });
      }
      const want = (sum * h) / 3;
      if (!Number.isFinite(got) || Math.abs(got - want) > 1e-4 * Math.max(1, Math.abs(want))) {
        wrong.push(`int ${from}..${to} ${f} = ${r.solution.answer} = ${got}, quadrature says ${want}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * Series verdicts, checked one direction only.
 *
 * Partial sums cannot prove convergence — enough terms of sum 1/n look
 * perfectly settled — but they can disprove it. A series claimed convergent
 * whose partial sums march past a million is wrong, and no amount of slow
 * convergence explains it away. The other direction, a claimed divergence
 * that actually converges, is caught by the hand-written list in
 * series-independent.test.ts.
 */
describe("no series is called convergent while its partial sums run away", () => {
  const SERIES = [
    "\\sum_{n=1}^{\\infty} \\frac{1}{n}", "\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}}",
    "\\sum_{n=1}^{\\infty} \\frac{1}{\\sqrt{n}}", "\\sum_{n=1}^{\\infty} \\frac{1}{n^{3}}",
    "\\sum_{n=1}^{\\infty} \\frac{n}{n+1}", "\\sum_{n=1}^{\\infty} \\frac{n}{2^{n}}",
    "\\sum_{n=1}^{\\infty} 2^{n}", "\\sum_{n=1}^{\\infty} \\frac{1}{2^{n}}",
    "\\sum_{n=1}^{\\infty} \\frac{1}{n!}", "\\sum_{n=1}^{\\infty} \\frac{n!}{2^{n}}",
    "\\sum_{n=1}^{\\infty} \\frac{1}{n(n+1)}", "\\sum_{n=1}^{\\infty} \\frac{2n}{n^{3}+1}",
    "\\sum_{n=1}^{\\infty} \\frac{\\ln(n)}{n}", "\\sum_{n=2}^{\\infty} \\frac{1}{n\\ln(n)}",
    "\\sum_{n=1}^{\\infty} n e^{-n}", "\\sum_{n=1}^{\\infty} \\frac{n^{2}}{3^{n}}",
  ];

  it("adds a hundred thousand terms of each and checks the claim", () => {
    const wrong: string[] = [];
    for (const problem of SERIES) {
      const r = trySolve(problem);
      if (!r.ok) continue;
      const claimsConvergence = !r.solution.answer.includes("diverges");
      if (!claimsConvergence) continue;

      const parsed = parseLatex(problem);
      const parts = asSummation(parsed);
      if (!parts) continue;
      const from = Math.round(evaluateNumeric(parts.from));
      let total = 0;
      for (let k = from; k < from + 100000; k++) {
        const term = evaluateNumeric(parts.body, { [parts.index]: k });
        if (!Number.isFinite(term)) break;
        total += term;
      }
      if (Math.abs(total) > 1e6) {
        wrong.push(`${problem} is called convergent, but 100000 terms come to ${total}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every value it reports matches the partial sums", () => {
    const VALUED = [
      "\\sum_{n=1}^{\\infty} \\frac{1}{2^{n}}", "\\sum_{n=0}^{\\infty} \\frac{1}{3^{n}}",
      "\\sum_{n=1}^{\\infty} \\frac{3}{4^{n}}", "\\sum_{n=1}^{\\infty} \\frac{1}{5^{n}}",
      "\\sum_{n=1}^{10} n", "\\sum_{n=1}^{100} n", "\\sum_{n=1}^{5} n^{2}",
    ];
    const wrong: string[] = [];
    for (const problem of VALUED) {
      const r = trySolve(problem);
      if (!r.ok) continue;
      const claimed = evaluateNumeric(parseLatex(r.solution.answer));
      if (!Number.isFinite(claimed)) continue;

      const parts = asSummation(parseLatex(problem));
      if (!parts) continue;
      const from = Math.round(evaluateNumeric(parts.from));
      const to = parts.infinite ? from + 200000 : Math.round(evaluateNumeric(parts.to));
      let total = 0;
      for (let k = from; k <= to; k++) {
        const term = evaluateNumeric(parts.body, { [parts.index]: k });
        if (!Number.isFinite(term)) break;
        total += term;
      }
      if (Math.abs(total - claimed) > 1e-6 * Math.max(1, Math.abs(claimed))) {
        wrong.push(`${problem} = ${r.solution.answer} = ${claimed}, partial sums give ${total}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("every step of every corpus problem preserves value", () => {
  it("samples before against after, without the solver's verifier", () => {
    const points = [0.37, 0.83, 1.41, 2.29, -0.58, -1.66, 3.14];
    const wrong: string[] = [];
    let sampled = 0;

    for (const p of problems) {
      if (p.unsupported) continue;
      const r = trySolve(p.latex);
      if (!r.ok) continue;
      for (const s of r.solution.steps) {
        if (s.display || !s.afterNode) continue;
        // A limit is not an identity and an unevaluated integral has no single
        // value; both have their own checks elsewhere.
        if (containsLimit(s.beforeNode) || containsIntegral(s.beforeNode)) continue;
        const before = resolveDerivatives(s.beforeNode);
        const after = resolveDerivatives(s.afterNode);
        if (!before || !after) continue;

        // An equation step rearranges rather than preserves, so what has to
        // hold is that lhs - rhs stays proportional.
        const asEquation = before.type === "rel" && after.type === "rel";
        let compared = 0;
        let ratio: number | null = null;
        let problem = "";
        for (const x of points) {
          const a = asEquation && before.type === "rel"
            ? evaluateNumeric(before.lhs, { x }) - evaluateNumeric(before.rhs, { x })
            : evaluateNumeric(before, { x });
          const b = asEquation && after.type === "rel"
            ? evaluateNumeric(after.lhs, { x }) - evaluateNumeric(after.rhs, { x })
            : evaluateNumeric(after, { x });
          if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
          compared++;
          if (asEquation) {
            if (Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9) continue;
            if (Math.abs(a) < 1e-9 || Math.abs(b) < 1e-9) {
              problem = `one side vanishes at x=${x}`;
              break;
            }
            const k = b / a;
            if (ratio === null) ratio = k;
            else if (Math.abs(k - ratio) > 1e-6 * Math.max(1, Math.abs(ratio))) {
              problem = `the multiple drifts at x=${x}: ${k} against ${ratio}`;
              break;
            }
          } else if (!agreesAt(a, b)) {
            problem = `at x=${x}: ${a} before, ${b} after`;
            break;
          }
        }
        if (compared > 0) sampled++;
        if (problem) {
          wrong.push(`[${s.ruleId}] in ${p.latex}: ${s.before} -> ${s.after} (${problem})`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(sampled).toBeGreaterThan(400);
  });
});
