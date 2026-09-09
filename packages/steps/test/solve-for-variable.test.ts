import { describe, expect, it } from "vitest";
import { normalizeWithReport } from "@openmath/ocr";
import { trySolve } from "../src/index.js";

/*
 * "Solve for y" is how a worksheet states the task, and until the instruction
 * was read the preference order in chooseVariable answered a different question:
 * given y = 6x + 2 it returned x = (y - 2)/6 to a student who asked about y.
 */
describe("an instruction that names the variable", () => {
  it("reads the variable out of the words in front of the problem", () => {
    const r = normalizeWithReport("solve for y: y = 6x + 2");
    expect(r.solveFor).toBe("y");
    expect(r.latex).toBe("y = 6x + 2");
  });

  it.each([
    ["Solve for y. y = 6x + 2", "y"],
    ["solve for y, y = 6x + 2", "y"],
    ["Find t: d = 3t + 5", "t"],
    ["isolate b: a = 2b - 1", "b"],
    ["solve for y in terms of x: y = 6x + 2", "y"],
  ])("reads %s", (raw, expected) => {
    expect(normalizeWithReport(raw).solveFor).toBe(expected);
  });

  it("leaves a problem with no instruction alone", () => {
    const r = normalizeWithReport("2x + 3 = 7");
    expect(r.solveFor).toBeUndefined();
    expect(r.latex).toBe("2x + 3 = 7");
  });

  /*
   * "Solve 2x + 3 = 7" names no variable — the x matched by the pattern is the
   * maths itself. Taking it as an instruction would eat the problem.
   */
  it("does not mistake the start of the problem for an instruction", () => {
    const r = normalizeWithReport("solve x");
    expect(r.solveFor).toBeUndefined();
    expect(r.latex).toBe("solve x");
  });

  it("answers the variable that was asked for", () => {
    const r = trySolve("y = 6x + 2", "y");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solution.answer).toContain("y");
    expect(r.solution.answer).not.toMatch(/^x =/);
  });

  it("still picks a sensible variable when none is requested", () => {
    const r = trySolve("y = 6x + 2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solution.answer).toMatch(/^x =/);
  });

  /* A request for a variable the problem does not contain is not a refusal. */
  it("ignores a requested variable that is not in the problem", () => {
    const r = trySolve("2x + 3 = 7", "q");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solution.answer).toBe("x = 2");
  });

  it("solves the whole reported flow end to end", () => {
    const report = normalizeWithReport("solve for y: y = 6x + 2");
    const r = trySolve(report.latex, report.solveFor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solution.verified).toBe(true);
  });
});
