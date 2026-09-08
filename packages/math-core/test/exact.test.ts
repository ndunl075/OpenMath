import { describe, expect, it } from "vitest";
import {
  angleFromTwelfths, asSurd, evaluateNumeric, exactInverseTrig, exactLog,
  exactTrig, parseLatex, piMultiple, Rational, surdToNode, toLatex,
  twelfthsOfPi, undefinedReason,
} from "@openmath/math-core";

describe("exact trigonometric values", () => {
  /**
   * The table is checked against the floating point functions rather than
   * against itself. A transcription slip in one of the twenty-four entries is
   * exactly the kind of mistake that a hand-written expectation would repeat.
   */
  it("agrees with floating point everywhere it has an entry", () => {
    const reference: Record<string, (x: number) => number> = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      sec: (x) => 1 / Math.cos(x),
      csc: (x) => 1 / Math.sin(x),
      cot: (x) => 1 / Math.tan(x),
    };
    let checked = 0;
    for (let t = -24; t < 48; t++) {
      const angle = angleFromTwelfths(t);
      const radians = (t * Math.PI) / 12;
      for (const [name, f] of Object.entries(reference)) {
        const value = exactTrig(name, angle);
        if (!value) continue;
        checked++;
        expect(evaluateNumeric(value), `${name} at ${t}/12 of pi`).toBeCloseTo(f(radians), 9);
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("covers exactly the multiples of pi/6 and pi/4", () => {
    const covered: number[] = [];
    for (let t = 0; t < 24; t++) {
      if (exactTrig("sin", angleFromTwelfths(t))) covered.push(t);
    }
    // Every second twelfth is a sixth; every third is a quarter. A twelfth on
    // its own, such as pi/12, has a closed form but not one this table carries.
    expect(covered).toEqual([0, 2, 3, 4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 22]);
  });

  it("writes the answers as exact surds", () => {
    const at = (s: string) => {
      const n = parseLatex(s);
      if (n.type !== "fn") throw new Error("not a function call");
      const v = exactTrig(n.name, n.args[0]!);
      return v ? toLatex(v) : null;
    };
    expect(at("\\sin(0)")).toBe("0");
    expect(at("\\cos(0)")).toBe("1");
    expect(at("\\sin(\\pi)")).toBe("0");
    expect(at("\\sin(\\frac{\\pi}{6})")).toBe("\\frac{1}{2}");
    expect(at("\\cos(\\frac{\\pi}{4})")).toBe("\\frac{\\sqrt{2}}{2}");
    expect(at("\\tan(\\frac{\\pi}{3})")).toBe("\\sqrt{3}");
    expect(at("\\sin(\\frac{7\\pi}{6})")).toBe("-\\frac{1}{2}");
    expect(at("\\tan(\\frac{\\pi}{6})")).toBe("\\frac{\\sqrt{3}}{3}");
  });

  it("has nothing to say about an angle with no closed form", () => {
    const at = (s: string) => {
      const n = parseLatex(s);
      if (n.type !== "fn") throw new Error("not a function call");
      return exactTrig(n.name, n.args[0]!);
    };
    expect(at("\\sin(1)")).toBeNull();
    expect(at("\\sin(\\frac{\\pi}{5})")).toBeNull();
    expect(at("\\cos(\\frac{\\pi}{12})")).toBeNull();
    expect(at("\\sin(x)")).toBeNull();
    // A pole is not merely unknown; nothing is returned there either.
    expect(at("\\tan(\\frac{\\pi}{2})")).toBeNull();
  });

  it("reduces a coterminal angle onto the circle", () => {
    expect(twelfthsOfPi(parseLatex("\\frac{13\\pi}{6}"))).toBe(2);
    expect(twelfthsOfPi(parseLatex("-\\frac{\\pi}{6}"))).toBe(22);
    expect(twelfthsOfPi(parseLatex("\\frac{\\pi}{6}+\\frac{\\pi}{3}"))).toBe(6);
    expect(piMultiple(parseLatex("0"))!.equals(Rational.ZERO)).toBe(true);
    expect(piMultiple(parseLatex("1"))).toBeNull();
  });

  it("reads the inverse functions on their principal branch", () => {
    const at = (name: string, arg: string) => {
      const v = exactInverseTrig(name, parseLatex(arg));
      return v ? toLatex(v) : null;
    };
    expect(at("arcsin", "1")).toBe("\\frac{\\pi}{2}");
    expect(at("arcsin", "-1")).toBe("-\\frac{\\pi}{2}");
    expect(at("arcsin", "\\frac{\\sqrt{2}}{2}")).toBe("\\frac{\\pi}{4}");
    expect(at("arccos", "0")).toBe("\\frac{\\pi}{2}");
    expect(at("arccos", "-1")).toBe("\\pi");
    expect(at("arctan", "1")).toBe("\\frac{\\pi}{4}");
    expect(at("arctan", "\\sqrt{3}")).toBe("\\frac{\\pi}{3}");
    // Outside the branch entirely, and outside the domain.
    expect(at("arcsin", "2")).toBeNull();
    expect(at("arctan", "\\frac{1}{3}")).toBeNull();
  });
});

describe("surds", () => {
  it("recognises a value however it was written", () => {
    const same = (a: string, b: string) => {
      const x = asSurd(parseLatex(a));
      const y = asSurd(parseLatex(b));
      expect(x, a).not.toBeNull();
      expect(y, b).not.toBeNull();
      expect(x!.a.equals(y!.a) && x!.root === y!.root, `${a} vs ${b}`).toBe(true);
    };
    same("\\frac{\\sqrt{2}}{2}", "\\frac{1}{\\sqrt{2}}");
    same("\\sqrt{12}", "2\\sqrt{3}");
    same("\\sqrt{\\frac{3}{4}}", "\\frac{\\sqrt{3}}{2}");
    same("\\sqrt{2}\\sqrt{3}", "\\sqrt{6}");
    same("(\\sqrt{2})^{2}", "2");
  });

  it("prints a surd the way it is written on paper", () => {
    const show = (s: string) => toLatex(surdToNode(asSurd(parseLatex(s))!));
    expect(show("\\frac{1}{\\sqrt{2}}")).toBe("\\frac{\\sqrt{2}}{2}");
    expect(show("\\sqrt{12}")).toBe("2 \\sqrt{3}");
    expect(show("-\\frac{\\sqrt{3}}{2}")).toBe("-\\frac{\\sqrt{3}}{2}");
    expect(show("\\frac{4}{2}")).toBe("2");
  });

  it("refuses anything that is not one surd", () => {
    expect(asSurd(parseLatex("\\sqrt{2}+\\sqrt{3}"))).toBeNull();
    expect(asSurd(parseLatex("x"))).toBeNull();
    expect(asSurd(parseLatex("\\sqrt[3]{2}"))).toBeNull();
  });
});

describe("exact logarithms", () => {
  const at = (s: string) => {
    const n = parseLatex(s);
    if (n.type !== "fn") throw new Error("not a function call");
    const base = n.args[1] ?? parseLatex(n.name === "ln" ? "e" : "10");
    const v = exactLog(n.args[0]!, base);
    return v ? toLatex(v) : null;
  };

  it("answers when the answer is exact", () => {
    expect(at("\\log_{2}(8)")).toBe("3");
    expect(at("\\log(100)")).toBe("2");
    expect(at("\\ln(e)")).toBe("1");
    expect(at("\\ln(1)")).toBe("0");
    expect(at("\\ln(e^{3})")).toBe("3");
    expect(at("\\log_{2}(\\frac{1}{8})")).toBe("-3");
    expect(at("\\log_{8}(2)")).toBe("\\frac{1}{3}");
    expect(at("\\log_{2}(2^{x})")).toBe("x");
  });

  it("says nothing rather than approximating", () => {
    expect(at("\\log_{2}(10)")).toBeNull();
    expect(at("\\ln(2)")).toBeNull();
    expect(at("\\log(3)")).toBeNull();
    expect(at("\\ln(x)")).toBeNull();
  });
});

describe("expressions with no value", () => {
  const why = (s: string) => undefinedReason(parseLatex(s));

  it("names what is undefined", () => {
    expect(why("\\tan(\\frac{\\pi}{2})")).toMatch(/asymptote/);
    expect(why("\\tan(\\frac{3\\pi}{2})")).toMatch(/asymptote/);
    expect(why("\\cot(0)")).toMatch(/asymptote/);
    expect(why("\\ln(0)")).toMatch(/positive/);
    expect(why("\\log(-5)")).toMatch(/positive/);
    expect(why("\\arcsin(2)")).toMatch(/between/);
    expect(why("1+\\ln(0)")).toMatch(/positive/);
  });

  it("leaves everything with a value alone", () => {
    expect(why("\\tan(\\frac{\\pi}{4})")).toBeNull();
    expect(why("\\tan(x)")).toBeNull();
    expect(why("\\ln(x)")).toBeNull();
    expect(why("\\ln(2)")).toBeNull();
    expect(why("\\arcsin(1)")).toBeNull();
  });
});
