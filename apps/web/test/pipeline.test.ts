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
    const latex = normalizeLatex("\\int_0^1 x\\,dx");
    expect(detectOutOfScope(latex)).toBe("integrals");
  });

  it("hands a derivative it cannot take back as unsupported, not half-solved", () => {
    const latex = normalizeLatex("\\frac{dy}{dx}");
    expect(detectOutOfScope(latex)).toBeNull();
    const outcome = trySolve(latex);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("unsupported");
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
