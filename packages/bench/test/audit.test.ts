import { describe, expect, it } from "vitest";
import { auditCorpus } from "@openmath/bench";
import type { CorpusItem } from "@openmath/bench";

function item(file: string, latex: string, answer?: string): CorpusItem {
  return {
    file,
    latex,
    category: "printed",
    path: `/c/${file}`,
    line: 1,
    ...(answer !== undefined ? { answer } : {}),
  };
}

describe("auditing the labels before blaming a model", () => {
  it("counts the ground truths the solver can answer", () => {
    const audit = auditCorpus([item("001.jpg", "2x + 3 = 7"), item("002.jpg", "\\prod_{i=1}^{n} i")]);
    expect(audit.scorable).toBe(1);
    expect(audit.unscorable).toEqual([
      { file: "002.jpg", reason: "out-of-scope", message: "products" },
    ]);
  });

  it("reports a mistyped ground truth as a parse failure, not as a model failure", () => {
    const audit = auditCorpus([item("001.jpg", "2x + = 7")]);
    expect(audit.unscorable[0]!.reason).toBe("parse");
  });

  it("flags a hand-written answer that disagrees with the solver", () => {
    const audit = auditCorpus([item("001.jpg", "2x + 3 = 7", "x = 3")]);
    expect(audit.answerMismatches).toEqual([
      { file: "001.jpg", labelled: "x = 3", solved: "x = 2" },
    ]);
  });

  it("accepts a hand-written answer in any equivalent form", () => {
    const audit = auditCorpus([
      item("001.jpg", "2x + 3 = 7", "x = 2"),
      // Someone labelling photos writes the value, not the statement.
      item("002.jpg", "2x + 3 = 7", "2"),
      item("003.jpg", "\\frac{1}{2} + \\frac{1}{4}", "0.75"),
    ]);
    expect(audit.answerMismatches).toEqual([]);
    expect(audit.scorable).toBe(3);
  });

  it("stays quiet about a label the solver cannot read at all", () => {
    // Two roots written out in prose: no evidence either way, so no complaint.
    const audit = auditCorpus([item("001.jpg", "x^{2} - 4 = 0", "x = 2 or x = -2")]);
    expect(audit.answerMismatches).toEqual([]);
  });
});
