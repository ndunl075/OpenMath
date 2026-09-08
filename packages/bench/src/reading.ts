import { parseLatex } from "@openmath/math-core";
import { detectOutOfScope, normalizeLatex } from "@openmath/ocr";
import { trySolve, verifyEquivalent } from "@openmath/steps";
import type { Reading } from "./types.js";

/**
 * Put one LaTeX string through exactly the path the app takes after a scan:
 * normalise, refuse what is out of scope, then solve. Scoring against anything
 * else would measure a pipeline we do not ship.
 */
export function read(raw: string): Reading {
  const latex = normalizeLatex(raw);
  if (!latex) return { latex, solved: false, answers: [], failure: "empty" };

  const scope = detectOutOfScope(latex);
  if (scope) {
    return { latex, solved: false, answers: [], failure: "out-of-scope", failureMessage: scope };
  }

  const outcome = trySolve(latex);
  if (!outcome.ok) {
    return { latex, solved: false, answers: [], failure: outcome.reason, failureMessage: outcome.message };
  }

  const s = outcome.solution;
  return {
    latex,
    solved: true,
    kind: s.kind,
    answer: s.answer,
    answers: s.answers,
    ...(s.variable ? { variable: s.variable } : {}),
  };
}

/** `x = 2`, `x \le -3`: the shape solve answers come out in. */
const STATEMENT = /^\s*([A-Za-z][A-Za-z0-9]*)\s*(<=|>=|\\leq|\\geq|\\le|\\ge|=|<|>)\s*([\s\S]+)$/;

function relationOf(symbol: string): string {
  if (symbol === "\\le" || symbol === "\\leq") return "<=";
  if (symbol === "\\ge" || symbol === "\\geq") return ">=";
  return symbol;
}

/**
 * Are two answers the same number, however they are written? Sampling through
 * the step engine's own verifier, so `\frac{1}{2}` and `0.5` agree and
 * `\frac{1}{2}` and `\frac{1}{3}` do not. Strings that will not parse fall back
 * to text equality, which covers answers like \text{no solution}.
 */
export function expressionsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  let left;
  let right;
  try {
    left = parseLatex(a);
    right = parseLatex(b);
  } catch {
    return false;
  }
  return verifyEquivalent(left, right) === "ok";
}

/** Compare `x = 2` with `x = \frac{4}{2}`: same variable, same relation, same value. */
export function statementsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const left = STATEMENT.exec(a);
  const right = STATEMENT.exec(b);
  if (!left || !right) return expressionsEqual(a, b);
  if (left[1] !== right[1]) return false;
  if (relationOf(left[2]!) !== relationOf(right[2]!)) return false;
  return expressionsEqual(left[3]!, right[3]!);
}

/**
 * The metric that decides whether recognition is good enough to ship: does the
 * scan lead the student to the same answer as the ground truth does?
 *
 * A read can differ character by character and still be the same problem
 * (`2x` and `2 \cdot x`), and a read can be 95% similar and worthless (one
 * digit wrong, or unparseable). Only the answer separates those two cases.
 */
export function answersMatch(expected: Reading, actual: Reading): boolean {
  if (!expected.solved || !actual.solved) return false;
  if (expected.kind !== actual.kind) return false;

  if (expected.kind !== "solve") {
    return expressionsEqual(expected.answer ?? "", actual.answer ?? "");
  }

  // Reading 2y + 3 = 7 as 2x + 3 = 7 gives the right number against the wrong
  // question, and the app would show "x = 2" over a photo that says y.
  if (expected.variable !== actual.variable) return false;
  if (expected.answers.length !== actual.answers.length) return false;
  // An identity ("true", "no solution") carries no roots to compare.
  if (expected.answers.length === 0) return (expected.answer ?? "") === (actual.answer ?? "");

  // Roots are a set: two of them in the other order is the same answer.
  const remaining = [...actual.answers];
  for (const want of expected.answers) {
    const index = remaining.findIndex((got) => statementsEqual(want, got));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

/**
 * The manifest's optional hand-written answer against the solver's. Looser than
 * answersMatch on purpose: someone labelling photos writes "2", not "x = 2".
 */
export function labelledAnswerMatches(labelled: Reading, solved: Reading): boolean {
  if (answersMatch(labelled, solved)) return true;
  if (labelled.answer === undefined || solved.answers.length !== 1) return false;
  const statement = STATEMENT.exec(solved.answers[0]!);
  if (!statement) return false;
  return expressionsEqual(statement[3]!, labelled.answer);
}
