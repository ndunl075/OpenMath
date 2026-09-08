import { describe, expect, it } from "vitest";
import { Rational } from "@openmath/math-core";

describe("Rational", () => {
  it("reduces on construction", () => {
    expect(Rational.of(6, 8).toString()).toBe("3/4");
    expect(Rational.of(-6, -8).toString()).toBe("3/4");
    expect(Rational.of(6, -8).toString()).toBe("-3/4");
  });

  it("adds exactly where floats cannot", () => {
    const third = Rational.of(1, 3);
    const sixth = Rational.of(1, 6);
    expect(third.add(sixth).toString()).toBe("1/2");
    expect(Rational.parse("0.1").add(Rational.parse("0.2")).toString()).toBe("3/10");
  });

  it("parses decimals without a float round trip", () => {
    expect(Rational.parse("3.25").toString()).toBe("13/4");
    expect(Rational.parse("-0.5").toString()).toBe("-1/2");
    expect(Rational.parse("12").toString()).toBe("12");
  });

  it("does integer powers including negatives", () => {
    expect(Rational.of(2, 3).powInt(3n)!.toString()).toBe("8/27");
    expect(Rational.of(2).powInt(-2n)!.toString()).toBe("1/4");
    expect(Rational.of(5).powInt(0n)!.toString()).toBe("1");
  });

  it("takes exact roots and refuses irrational ones", () => {
    expect(Rational.of(9, 4).nthRoot(2n)!.toString()).toBe("3/2");
    expect(Rational.of(2).nthRoot(2n)).toBeNull();
    expect(Rational.of(-8).nthRoot(3n)!.toString()).toBe("-2");
    expect(Rational.of(-4).nthRoot(2n)).toBeNull();
  });

  it("renders LaTeX", () => {
    expect(Rational.of(3, 4).toLatex()).toBe("\\frac{3}{4}");
    expect(Rational.of(-3, 4).toLatex()).toBe("-\\frac{3}{4}");
    expect(Rational.of(7).toLatex()).toBe("7");
  });

  it("rejects a zero denominator", () => {
    expect(() => Rational.of(1, 0)).toThrow();
  });
});
