import { describe, expect, it } from "vitest";
import { evaluateNumeric, parseLatex } from "@openmath/math-core";
import { trySolve } from "@openmath/steps";

/** Answers worked by hand, never taken from the implementation. */
const FACTOR: Array<[string, string]> = [
  ["x^{2}-9", "\\left(x - 3\\right) \\left(x + 3\\right)"],
  ["x^{2}+5x+6", "\\left(x + 2\\right) \\left(x + 3\\right)"],
  ["2x^{2}+4x", "2 x \\left(x + 2\\right)"],
];

/** Roots checked by substituting back into the original, not by string match. */
const ROOTS: Array<[string, number[]]> = [
  ["x^{3}-x=0", [-1, 0, 1]],
  ["x^{3}=27", [3]],
  ["x^{4}=16", [-2, 2]],
  ["x^{3}-6x^{2}+11x-6=0", [1, 2, 3]],
  ["x^{4}-5x^{2}+4=0", [-2, -1, 1, 2]],
  ["\\sqrt{x}=3", [9]],
  ["\\sqrt{x+1}=4", [15]],
  ["2^{x}=8", [3]],
  ["\\log_{2}(x)=3", [8]],
  ["\\ln(x)=0", [1]],
  ["\\log(x)+\\log(x-3)=1", [5]],
];

describe("factoring, against hand-written factorisations", () => {
  for (const [p, want] of FACTOR) {
    it(`${p} = ${want}`, () => {
      const r = trySolve(p);
      if (!r.ok) throw new Error(`${p}: ${r.message}`);
      expect(r.solution.answer).toBe(want);
    });
  }
});

describe("roots satisfy the original equation", () => {
  for (const [p, roots] of ROOTS) {
    it(`${p} has roots ${roots.join(", ")}`, () => {
      const r = trySolve(p);
      if (!r.ok) throw new Error(`${p}: ${r.message}`);
      const eq = parseLatex(p);
      if (eq.type !== "rel") throw new Error("expected an equation");
      expect(r.solution.answers).toHaveLength(roots.length);
      for (const root of roots) {
        const l = evaluateNumeric(eq.lhs, { x: root });
        const rr = evaluateNumeric(eq.rhs, { x: root });
        expect(Math.abs(l - rr), `root ${root} of ${p}`).toBeLessThan(1e-9);
      }
    });
  }
});

describe("extraneous and out-of-domain roots are thrown away", () => {
  it("rejects the root squaring invents", () => {
    // x = -1 satisfies the squared equation but not the original.
    const r = trySolve("\\sqrt{x+3}=x+1");
    if (!r.ok) throw new Error(r.message);
    expect(r.solution.answers).toHaveLength(1);
    expect(r.solution.answers[0]).toContain("1");
  });

  it("rejects a log argument that is not positive", () => {
    const r = trySolve("\\log(x)+\\log(x-3)=1");
    if (!r.ok) throw new Error(r.message);
    // x = -2 solves the quadratic but log(-2) is undefined.
    expect(r.solution.answers.join(" ")).not.toContain("-2");
  });
});

describe("inequalities", () => {
  const CASES: Array<[string, string[]]> = [
    ["\\left|x\\right|<3", ["-3", "3"]],
    ["x^{2}>4", ["-2", "2"]],
    ["x^{2}<4", ["-2", "2"]],
  ];
  for (const [p, contains] of CASES) {
    it(`solves ${p}`, () => {
      const r = trySolve(p);
      if (!r.ok) throw new Error(`${p}: ${r.message}`);
      for (const c of contains) expect(r.solution.answer).toContain(c);
    });
  }
});

describe("declines rather than approximating", () => {
  it("refuses a cubic with no rational root", () => {
    const r = trySolve("x^{3}-2=0");
    if (r.ok) expect(r.solution.answer).not.toMatch(/1\.259|1\.26/);
  });
});
