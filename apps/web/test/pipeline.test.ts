import { describe, expect, it } from "vitest";
import { detectOutOfScope, normalizeLatex } from "@openmath/ocr";
import { trySolve } from "@openmath/steps";
import { buildTimeline } from "@openmath/step-motion";
import { reportUrl } from "../src/lib/report.js";

/**
 * The whole chain the app runs on every scan: model output -> normalise ->
 * scope check -> solve -> animation timeline. Each package is tested on its
 * own; this checks they still fit together.
 */
describe("scan to steps", () => {
  const scans: Array<{ raw: string; answer: string }> = [
    { raw: "$2x + 3 = 7$", answer: "x = 2" },
    { raw: "\\displaystyle 5x − 3 = 2x + 9", answer: "x = 4" },
    { raw: "x² − 4 = 0", answer: "x = -2 \\quad \\text{or} \\quad x = 2" },
    { raw: "\\frac12 + \\frac13", answer: "\\frac{5}{6}" },
    { raw: "\\left(x+1\\right)\\left(x+2\\right)", answer: "x^{2} + 3 x + 2" },
    { raw: "2 × 3 + 4", answer: "10" },
    { raw: "√12", answer: "2 \\sqrt{3}" },
    { raw: "$\\frac{d}{dx}(x^{2} + 3x)$", answer: "2 x + 3" },
    { raw: "\\frac{d}{dx}\\sin(2x)", answer: "2 \\cos\\left(2 x\\right)" },
    { raw: "\\left(x^{2}+1\\right)^{3}\u2019", answer: "6 \\left(x^{2} + 1\\right)^{2} x" },
    { raw: "\\sin(\\frac{\\pi}{6})", answer: "\\frac{1}{2}" },
    { raw: "\\log_{2}(8)", answer: "3" },
    { raw: "$\\lim_{x \\to 2} \\frac{x^{2}-4}{x-2}$", answer: "4" },
    // The scan of a limit at infinity arrives with the symbols, not the commands.
    { raw: "\\displaystyle\\lim_{x → ∞} \\frac{1}{x}", answer: "0" },
    { raw: "\\lim_{x \\to 0^+} \\sqrt{x}", answer: "0" },
    { raw: "x² − 9", answer: "\\left(x - 3\\right) \\left(x + 3\\right)" },
    { raw: "√(2x+3) = x", answer: "x = 3" },
    { raw: "$\\log_2(x) = 3$", answer: "x = 8" },
    { raw: "|x| > 3", answer: "x < -3 \\quad \\text{or} \\quad x > 3" },
    { raw: "x³ − 6x² + 11x − 6 = 0", answer: "x = 1 \\quad \\text{or} \\quad x = 2 \\quad \\text{or} \\quad x = 3" },
  ];

  for (const scan of scans) {
    it(`turns ${JSON.stringify(scan.raw)} into steps`, () => {
      const latex = normalizeLatex(scan.raw);
      expect(detectOutOfScope(latex)).toBeNull();

      const outcome = trySolve(latex);
      if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
      expect(outcome.solution.answer).toBe(scan.answer);
      expect(outcome.solution.verified).toBe(true);

      for (const step of outcome.solution.steps) {
        const timeline = buildTimeline(step);
        expect(timeline.duration).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("routes an out-of-scope scan to a message instead of the solver", () => {
    // A product. \sum came off this list when the series engine landed.
    expect(detectOutOfScope(normalizeLatex("\\prod_{i=1}^{n} i"))).toBe("products");
  });

  it("sends a scanned sum to the solver rather than refusing it here", () => {
    const latex = normalizeLatex("\\sum _ { n = 1 } ^ { 1 0 } n");
    expect(detectOutOfScope(latex)).toBeNull();
  });

  it("sends a scanned integral to the solver rather than refusing it here", () => {
    const latex = normalizeLatex("\\int_0^1 x\\,dx");
    expect(detectOutOfScope(latex)).toBeNull();
    const outcome = trySolve(latex);
    if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
    expect(outcome.solution.answer).toBe("\\frac{1}{2}");
    expect(outcome.solution.verified).toBe(true);
  });

  it("lets a limit through the scope check now that the solver takes them", () => {
    const latex = normalizeLatex("\\lim_{x \\to 0}\\frac{\\sin(x)}{x}");
    expect(detectOutOfScope(latex)).toBeNull();
    const outcome = trySolve(latex);
    if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
    expect(outcome.solution.answer).toBe("1");
  });

  it("hands a limit it cannot take back as unsupported, not half-solved", () => {
    const latex = normalizeLatex("\\lim_{x → ∞} \\frac{e^{x}}{x}");
    expect(detectOutOfScope(latex)).toBeNull();
    const outcome = trySolve(latex);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsupported");
  });

  it("hands a derivative it cannot take back as unsupported, not half-solved", () => {
    const latex = normalizeLatex("\\frac{dy}{dx}");
    expect(detectOutOfScope(latex)).toBeNull();
    const outcome = trySolve(latex);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsupported");
  });

  /**
   * The typed path used to skip the repairs the scan path got, so someone
   * typing cos(0) on the keyboard was answered 0 — c*o*s*0 — while the same
   * thing photographed came back as 1. Typing "cos" without a backslash is
   * more likely than scanning it, not less.
   */
  describe("typed input gets the same repairs a scan does", () => {
    const TYPED: Array<[string, string]> = [
      ["cos(0)", "1"],
      ["log(100)", "2"],
      ["sqrt(16)", "4"],
      ["ln(e)", "1"],
      ["1 2 3 + 4 5 6", "579"],
      ["sin(0)", "0"],
    ];
    for (const [typed, answer] of TYPED) {
      it(`${typed} -> ${answer}`, () => {
        const latex = normalizeLatex(typed);
        expect(detectOutOfScope(latex)).toBeNull();
        const outcome = trySolve(latex);
        if (!outcome.ok) throw new Error(`${latex}: ${outcome.message}`);
        expect(outcome.solution.answer).toBe(answer);
      });
    }

    it("is idempotent, so the scan path passing through twice is harmless", () => {
      for (const raw of ["cos(0)", "1 2 3", "\\cos(0)", "x^{2} + 1", "\\int x \\, dx"]) {
        const once = normalizeLatex(raw);
        expect(normalizeLatex(once)).toBe(once);
      }
    });
  });

  it("keeps an unreadable scan out of the solver", () => {
    expect(normalizeLatex("   ")).toBe("");
    const outcome = trySolve("2x +");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("parse");
  });
});

describe("reportUrl", () => {
  it("prefills an issue against this repository", () => {
    const url = new URL(reportUrl({ latex: "2x+3=7", reason: "Wrong answer" }));
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/ndunl075/OpenMath/issues/new");
    expect(url.searchParams.get("title")).toContain("2x+3=7");
    expect(url.searchParams.get("body")).toContain("Wrong answer");
    expect(url.searchParams.get("labels")).toBe("bad-result");
  });

  it("includes the raw model output when it differs", () => {
    const url = new URL(
      reportUrl({ latex: "2x+3=7", raw: "$2x+3=7$", reason: "Misread" }),
    );
    expect(url.searchParams.get("body")).toContain("Raw model output");
  });

  it("says nothing is uploaded automatically", () => {
    const url = new URL(reportUrl({ latex: "x", reason: "test" }));
    expect(url.searchParams.get("body")).toContain("Nothing is uploaded automatically");
  });
});
