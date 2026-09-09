import { describe, expect, it } from "vitest";
import { detectOutOfScope, normalizeLatex } from "../src/index.js";

/*
 * A recognition model handed a photo of one line of algebra wraps it in a
 * layout environment more often than not. Every case here was refused before,
 * which meant the camera path refused most of what it was pointed at.
 */
describe("layout environments from a real recogniser", () => {
  const singleRow: [string, string][] = [
    ["\\begin{aligned} y = 6x + 2 \\end{aligned}", "y = 6x + 2"],
    ["\\begin{aligned} y &= 6x + 2 \\end{aligned}", "y = 6x + 2"],
    ["\\begin{align*} 2x + 3 &= 7 \\end{align*}", "2x + 3 = 7"],
    ["\\begin{array}{l} y = 6x + 2 \\end{array}", "y = 6x + 2"],
    ["\\begin{array}{rcl} x &=& 4 \\end{array}", "x = 4"],
    ["\\begin{gathered} x^2 - 4 = 0 \\end{gathered}", "x^{2} - 4 = 0"],
    ["\\begin{split} 3x = 9 \\end{split}", "3x = 9"],
    ["\\begin{equation} x + 1 = 2 \\end{equation}", "x + 1 = 2"],
    // A trailing separator ends the line; it does not start another one.
    ["\\begin{aligned} y = 6x + 2 \\\\ \\end{aligned}", "y = 6x + 2"],
  ];

  it.each(singleRow)("unwraps %s", (raw, expected) => {
    expect(normalizeLatex(raw)).toBe(expected);
    expect(detectOutOfScope(normalizeLatex(raw))).toBeNull();
  });

  it("unwraps a nested environment", () => {
    const raw = "\\begin{equation}\\begin{aligned} y &= 6x + 2 \\end{aligned}\\end{equation}";
    expect(normalizeLatex(raw)).toBe("y = 6x + 2");
  });

  /*
   * Two rows are two statements. Flattening them would run them together into a
   * problem the student never wrote, so these stay refused — but with a message
   * that says which thing is unsupported.
   */
  it("still refuses genuinely multi-row working, and says so accurately", () => {
    const raw = "\\begin{aligned} 2x + 3 &= 7 \\\\ 2x &= 4 \\end{aligned}";
    expect(detectOutOfScope(normalizeLatex(raw))).toBe("more than one line of working at a time");
  });

  it("still refuses matrices, and names them", () => {
    const raw = "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}";
    expect(detectOutOfScope(normalizeLatex(raw))).toBe("matrices");
  });

  it("still refuses piecewise definitions, and names them", () => {
    const raw = "f(x) = \\begin{cases} x & x > 0 \\\\ -x & x \\le 0 \\end{cases}";
    expect(detectOutOfScope(normalizeLatex(raw))).toBe("piecewise definitions");
  });
});
