import { type MathNode, toLatex } from "@openmath/math-core";
import type { Interval } from "./types.js";

/**
 * How a textbook writes a solution set.
 *
 * School algebra writes an inequality answer in the variable, not in interval
 * notation: "-3 < x < 3" and "x < -2 or x > 2" are what a student is expected
 * to put on the line below their working, so that is what this renders. The
 * structured `Interval` behind it keeps the exact bounds, so nothing here has
 * to parse a string back to find out where a range ends.
 */

const LESS = (closed: boolean): string => (closed ? "\\le" : "<");
const GREATER = (closed: boolean): string => (closed ? "\\ge" : ">");

export function renderInterval(i: Interval, variable: string): string {
  const { lower, upper } = i;
  if (lower && upper) {
    // A single point, which is what x^2 <= 0 comes to.
    if (lower.closed && upper.closed && toLatex(lower.value) === toLatex(upper.value)) {
      return `${variable} = ${toLatex(lower.value)}`;
    }
    return `${toLatex(lower.value)} ${LESS(lower.closed)} ${variable} ${LESS(upper.closed)} ${toLatex(upper.value)}`;
  }
  if (lower) return `${variable} ${GREATER(lower.closed)} ${toLatex(lower.value)}`;
  if (upper) return `${variable} ${LESS(upper.closed)} ${toLatex(upper.value)}`;
  return `\\text{every value of } ${variable}`;
}

/** Join alternatives the way the rest of the engine joins two roots. */
export function joinAlternatives(parts: string[]): string {
  return parts.join(" \\quad \\text{or} \\quad ");
}

export const openAbove = (value: MathNode, closed = false): Interval => ({
  lower: { value, closed },
});
export const openBelow = (value: MathNode, closed = false): Interval => ({
  upper: { value, closed },
});
export const between = (
  lower: MathNode,
  upper: MathNode,
  closed = false,
): Interval => ({
  lower: { value: lower, closed },
  upper: { value: upper, closed },
});
