import { describe, expect, it } from "vitest";
import { labelledAnswerMatches, read } from "../src/reading.js";

/**
 * Someone labelling photos writes the answer, not the problem: "579", not
 * "the sum is 579". That label reads as an evaluate, while the ground truth it
 * is checked against reads as a limit, an integral or an equation. Comparing
 * the two by their *kind* therefore rejected every correct expression label,
 * and the audit reported a disagreement between two identical strings.
 */
describe("a hand-written label against the solver", () => {
  const agrees = (truth: string, label: string) =>
    labelledAnswerMatches(read(label), read(truth));

  it.each([
    ["\\lim_{x \\to \\frac{1}{4}} \\frac{1 - 4^{x - \\frac{1}{4}}}{1 - 4x}", "\\frac{\\ln\\left(4\\right)}{4}"],
    ["1 2 3 + 4 5 6", "579"],
    ["\\frac{1}{2} + \\frac{1}{3}", "\\frac{5}{6}"],
    ["\\sum_{n = 1}^{10} n", "55"],
    ["\\frac{d}{dx}(x^{2})", "2x"],
  ])("accepts a correct expression label for %s", (truth, label) => {
    expect(agrees(truth, label)).toBe(true);
  });

  /* Written a different way but the same number: still the same answer. */
  it("accepts a label that is equal rather than identical", () => {
    expect(agrees("\\frac{1}{2} + \\frac{1}{3}", "\\frac{10}{12}")).toBe(true);
  });

  /* The whole point of the audit is that a wrong label is still caught. */
  it.each([
    ["1 2 3 + 4 5 6", "126"],
    ["\\frac{1}{2} + \\frac{1}{3}", "\\frac{2}{5}"],
    ["\\lim_{x \\to \\frac{1}{4}} \\frac{1 - 4^{x - \\frac{1}{4}}}{1 - 4x}", "\\ln\\left(4\\right)"],
  ])("still rejects a wrong label for %s", (truth, label) => {
    expect(agrees(truth, label)).toBe(false);
  });

  /* "2" for a problem the solver answers "x = 2" was always meant to pass. */
  it("accepts a bare number against a solve statement", () => {
    expect(agrees("2x + 3 = 7", "2")).toBe(true);
    expect(agrees("2x + 3 = 7", "5")).toBe(false);
  });
});
