import { describe, expect, it } from "vitest";
import { trySolve } from "@openmath/steps";
import { detectOutOfScope, normalizeLatex } from "@openmath/ocr";

describe("a coefficient of minus one prints as a minus sign", () => {
  it("on an irrational quadratic root", () => {
    const outcome = trySolve("x^2 = 2");
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.solution.answers).toEqual(["x = -\\sqrt{2}", "x = \\sqrt{2}"]);
  });

  it("on the other radical roots", () => {
    const outcome = trySolve("x^2 - 3 = 0");
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.solution.answers[0]).toBe("x = -\\sqrt{3}");
  });

  it("without disturbing an ordinary negative coefficient", () => {
    const outcome = trySolve("2x - 5x");
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.solution.answer).toBe("-3 x");
  });
});

describe("percentages are refused rather than silently rewritten", () => {
  it("keeps the sign instead of deleting it", () => {
    expect(normalizeLatex("x = 20\\%")).toContain("%");
  });

  it("names them as out of scope", () => {
    expect(detectOutOfScope(normalizeLatex("x = 20\\%"))).toBe("percentages");
    expect(detectOutOfScope("50\\% of 20")).toBe("percentages");
  });

  it("leaves ordinary algebra alone", () => {
    expect(detectOutOfScope("2x+3=7")).toBeNull();
  });
});
