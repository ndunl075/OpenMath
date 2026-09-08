import { describe, expect, it } from "vitest";
import { characterErrorRate, editDistance } from "@openmath/bench";

describe("edit distance", () => {
  it("is zero for identical strings", () => {
    expect(editDistance("2x + 3 = 7", "2x + 3 = 7")).toBe(0);
  });

  it("counts a substitution, an insertion and a deletion as one edit each", () => {
    expect(editDistance("2x", "2y")).toBe(1);
    expect(editDistance("2x", "2xy")).toBe(1);
    expect(editDistance("2xy", "2x")).toBe(1);
  });

  it("is the length of the other string when one is empty", () => {
    expect(editDistance("", "abcd")).toBe(4);
    expect(editDistance("abcd", "")).toBe(4);
  });

  it("is symmetric", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("sitting", "kitten")).toBe(3);
  });

  it("counts a multi-byte character as one edit, not two", () => {
    expect(editDistance("x", "\u{1D465}")).toBe(1);
  });
});

describe("character error rate", () => {
  it("is zero for a perfect read", () => {
    expect(characterErrorRate("2x + 3 = 7", "2x + 3 = 7")).toBe(0);
  });

  it("is edits over ground-truth characters", () => {
    // One character of ten misread.
    expect(characterErrorRate("2x + 3 = 7", "2x + 3 = 1")).toBeCloseTo(0.1, 10);
    // Two of ten.
    expect(characterErrorRate("2x + 3 = 7", "2y + 3 = 1")).toBeCloseTo(0.2, 10);
  });

  it("is 1 when nothing was recognised", () => {
    expect(characterErrorRate("2x + 3 = 7", "")).toBe(1);
  });

  it("goes above 1 when the model invents more text than the photo holds", () => {
    expect(characterErrorRate("5", "5 + 5 + 5 + 5")).toBeGreaterThan(1);
  });

  it("treats two empty strings as agreement, and an empty reference as total failure", () => {
    expect(characterErrorRate("", "")).toBe(0);
    expect(characterErrorRate("", "x")).toBe(1);
  });
});
