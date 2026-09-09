import { describe, expect, it } from "vitest";
import { normalizeLatex } from "@openmath/ocr";
import {
  CARET, closeOf, decorateForDisplay, deleteBackward, deleteForward, insertAt,
  openOf, stepLeft, stepRight,
} from "../src/lib/latex-caret.js";

/** Render a caret position as a string with | in it, so a failure reads at a glance. */
const show = (s: string, p: number) => `${s.slice(0, p)}|${s.slice(p)}`;

/** Every stop from `p` going right, until the caret no longer moves. */
function walkRight(s: string, p = 0): string[] {
  const stops = [show(s, p)];
  for (;;) {
    const next = stepRight(s, p);
    if (next === p) return stops;
    p = next;
    stops.push(show(s, p));
  }
}

function walkLeft(s: string, p = s.length): string[] {
  const stops = [show(s, p)];
  for (;;) {
    const next = stepLeft(s, p);
    if (next === p) return stops;
    p = next;
    stops.push(show(s, p));
  }
}

describe("brace matching", () => {
  it("pairs braces across nesting", () => {
    const s = "\\frac{\\sqrt{x}}{2}";
    expect(closeOf(s, 5)).toBe(14);
    expect(openOf(s, 14)).toBe(5);
    expect(closeOf(s, 11)).toBe(13);
  });

  it("ignores escaped braces", () => {
    const s = "\\{x\\}{y}";
    expect(closeOf(s, 5)).toBe(7);
    expect(openOf(s, 7)).toBe(5);
    expect(closeOf(s, 1)).toBe(-1);
  });
});

describe("stepping right", () => {
  it("enters a fraction, crosses to the denominator, and leaves it", () => {
    expect(walkRight("\\frac{1}{2}+3")).toEqual([
      "|\\frac{1}{2}+3",
      "\\frac{|1}{2}+3",
      "\\frac{1|}{2}+3",
      "\\frac{1}{|2}+3",
      "\\frac{1}{2|}+3",
      "\\frac{1}{2}|+3",
      "\\frac{1}{2}+|3",
      "\\frac{1}{2}+3|",
    ]);
  });

  it("steps over a bare control word and the space that ends it", () => {
    expect(walkRight("2\\cdot 3")).toEqual(["|2\\cdot 3", "2|\\cdot 3", "2\\cdot |3", "2\\cdot 3|"]);
  });

  it("stops between a function name and its bracket", () => {
    expect(walkRight("\\sin(x)")).toEqual(["|\\sin(x)", "\\sin|(x)", "\\sin(|x)", "\\sin(x|)", "\\sin(x)|"]);
  });

  it("enters a braced exponent and steps over a bare one", () => {
    expect(walkRight("x^{2}")).toEqual(["|x^{2}", "x|^{2}", "x^{|2}", "x^{2|}", "x^{2}|"]);
    expect(walkRight("x^2")).toEqual(["|x^2", "x|^2", "x^2|"]);
    expect(walkRight("x^\\pi")).toEqual(["|x^\\pi", "x|^\\pi", "x^\\pi|"]);
  });

  it("goes through an optional argument into the required one", () => {
    expect(walkRight("\\sqrt[3]{x}")).toEqual([
      "|\\sqrt[3]{x}", "\\sqrt[|3]{x}", "\\sqrt[3|]{x}", "\\sqrt[3]{|x}", "\\sqrt[3]{x|}", "\\sqrt[3]{x}|",
    ]);
  });

  it("treats \\left( as one thing", () => {
    expect(walkRight("\\left(x\\right)")).toEqual([
      "|\\left(x\\right)", "\\left(|x\\right)", "\\left(x|\\right)", "\\left(x\\right)|",
    ]);
  });
});

describe("stepping left", () => {
  it("retraces the same stops through a fraction", () => {
    expect(walkLeft("\\frac{1}{2}+3")).toEqual([
      "\\frac{1}{2}+3|",
      "\\frac{1}{2}+|3",
      "\\frac{1}{2}|+3",
      "\\frac{1}{2|}+3",
      "\\frac{1}{|2}+3",
      "\\frac{1|}{2}+3",
      "\\frac{|1}{2}+3",
      "|\\frac{1}{2}+3",
    ]);
  });

  it("retraces control words, exponents and optional arguments", () => {
    expect(walkLeft("2\\cdot 3")).toEqual(["2\\cdot 3|", "2\\cdot |3", "2|\\cdot 3", "|2\\cdot 3"]);
    expect(walkLeft("\\sin(x)").at(-2)).toBe("\\sin|(x)");
    expect(walkLeft("x^{2}")).toEqual(["x^{2}|", "x^{2|}", "x^{|2}", "x|^{2}", "|x^{2}"]);
    expect(walkLeft("x^2")).toEqual(["x^2|", "x|^2", "|x^2"]);
    expect(walkLeft("x^\\pi")).toEqual(["x^\\pi|", "x|^\\pi", "|x^\\pi"]);
    expect(walkLeft("\\sqrt[3]{x}")).toEqual([
      "\\sqrt[3]{x}|", "\\sqrt[3]{x|}", "\\sqrt[3]{|x}", "\\sqrt[3|]{x}", "\\sqrt[|3]{x}", "|\\sqrt[3]{x}",
    ]);
  });

  it("stays at the ends", () => {
    expect(stepLeft("x", 0)).toBe(0);
    expect(stepRight("x", 1)).toBe(1);
  });
});

describe("backspace", () => {
  const back = (s: string, p: number) => {
    const edit = deleteBackward(s, p);
    return edit ? show(edit.value, edit.caret) : null;
  };

  it("takes a whole fraction in one go", () => {
    expect(back("2+\\frac{1}{2}", 13)).toBe("2+|");
  });

  it("takes an exponent with its braces or without", () => {
    expect(back("x^{2}", 5)).toBe("x|");
    expect(back("x^2", 3)).toBe("x|");
    expect(back("x^\\pi", 5)).toBe("x|");
  });

  it("takes a control word with the space that ends it", () => {
    expect(back("2\\cdot 3", 7)).toBe("2|3");
    expect(back("\\cos", 4)).toBe("|");
    expect(back("2\\le 3", 5)).toBe("2|3");
  });

  it("takes \\left( and \\right) with their delimiter", () => {
    expect(back("\\left(x\\right)", 14)).toBe("\\left(x|");
    expect(back("\\left(", 6)).toBe("|");
  });

  it("takes digits one at a time", () => {
    expect(back("123", 3)).toBe("12|");
  });

  it("undoes an empty fraction from inside either argument", () => {
    expect(back("\\frac{}{}", 6)).toBe("|");
    expect(back("\\frac{}{}", 8)).toBe("|");
    expect(back("2+\\frac{}{}", 8)).toBe("2+|");
  });

  it("undoes an empty root or exponent from inside it", () => {
    expect(back("\\sqrt{}", 6)).toBe("|");
    expect(back("x^{}", 3)).toBe("x|");
  });

  it("steps out of a structure that holds something rather than delete into it", () => {
    expect(back("\\frac{1}{}", 9)).toBe("\\frac{1|}{}");
    expect(back("\\frac{1}{2}", 6)).toBe("|\\frac{1}{2}");
    expect(back("\\sqrt{9}", 6)).toBe("|\\sqrt{9}");
  });

  it("does nothing at the start", () => {
    expect(deleteBackward("x", 0)).toBeNull();
  });
});

describe("forward delete", () => {
  const del = (s: string, p: number) => {
    const edit = deleteForward(s, p);
    return edit ? show(edit.value, edit.caret) : null;
  };

  it("takes the unit ahead whole", () => {
    expect(del("\\frac{1}{2}+3", 0)).toBe("|+3");
    expect(del("x^{2}", 1)).toBe("x|");
    expect(del("\\cdot 3", 0)).toBe("|3");
  });

  it("steps out of a group instead of eating its brace", () => {
    expect(del("\\frac{1}{2}", 7)).toBe("\\frac{1}{|2}");
  });

  it("does nothing at the end", () => {
    expect(deleteForward("x", 1)).toBeNull();
  });
});

describe("insert", () => {
  it("leaves the caret inside what the keypad put in", () => {
    const edit = insertAt("2", 1, 1, "\\frac{}{}", 3);
    expect(show(edit.value, edit.caret)).toBe("2\\frac{|}{}");
  });

  it("replaces a selection", () => {
    const edit = insertAt("2x+3", 0, 2, "y");
    expect(show(edit.value, edit.caret)).toBe("y|+3");
  });

  it("keeps a letter from fusing with the control word before it", () => {
    expect(show(...pair(insertAt("\\sin", 4, 4, "x")))).toBe("\\sin x|");
    expect(show(...pair(insertAt("\\sin", 4, 4, "2")))).toBe("\\sin2|");
    expect(show(...pair(insertAt("2", 1, 1, "x")))).toBe("2x|");
  });
});

function pair(edit: { value: string; caret: number }): [string, number] {
  return [edit.value, edit.caret];
}

describe("what KaTeX is given", () => {
  it("draws the caret as a zero-width atom", () => {
    expect(decorateForDisplay(`2 + ${CARET}3`)).toBe("2 + \\htmlId{om-caret}{{}}3");
  });

  it("shows an empty argument as a slot, with the caret beside the one it is in", () => {
    expect(decorateForDisplay(`\\frac{${CARET}}{}`)).toBe(
      "\\frac{\\htmlId{om-caret}{{}}\\htmlId{om-slot-1}{\\square}}{\\htmlId{om-slot-2}{\\square}}",
    );
  });

  it("leaves escaped braces alone", () => {
    expect(decorateForDisplay("\\{\\}")).toBe("\\{\\}");
  });

  it("survives normalisation in place", () => {
    // What the reader typed is repaired for display; the caret must not move
    // relative to the characters around it while that happens.
    expect(normalizeLatex(`cos(0)${CARET}`)).toBe(`\\cos(0)${CARET}`);
    expect(normalizeLatex(`2x+${CARET}3=7`)).toBe(`2x + ${CARET}3 = 7`);
    expect(normalizeLatex(`x^2${CARET}+1`)).toBe(`x^{2}${CARET} + 1`);
    expect(normalizeLatex(`\\frac{${CARET}}{}`)).toBe(`\\frac{${CARET}}{}`);
    expect(normalizeLatex(`\\sqrt{${CARET}}`)).toBe(`\\sqrt{${CARET}}`);
  });
});
