import type { MathNode, NodeId } from "@openmath/math-core";

/**
 * What a rule did, in terms the animation layer can choreograph.
 * Ids refer to nodes in the `before` tree (fromIds) and `after` tree (toIds).
 */
export type ChangeKind =
  | "move"              // a term crossed the equals sign
  | "combine"           // several terms merged into one
  | "cancel"            // terms or factors vanished
  | "add"               // a term appeared
  | "replace"           // a sub-expression was rewritten in place
  | "apply-both-sides"; // an operation was applied to both sides

export interface Change {
  kind: ChangeKind;
  fromIds: NodeId[];
  toIds: NodeId[];
}

export interface Step {
  ruleId: string;
  /** Plain-English label, e.g. "Combine like terms". */
  title: string;
  /** Full sentence shown when a step is expanded. */
  explanation: string;
  before: string;
  after: string;
  beforeNode: MathNode;
  afterNode?: MathNode;
  /** Presentation-only step, such as writing out the quadratic formula. */
  display?: boolean;
  changes: Change[];
  /** Set when the step could not be confirmed by the verifier. */
  unverified?: boolean;
  substeps?: Step[];
}

export interface RuleContext {
  /** The variable an equation is being solved for. */
  variable?: string;
  /**
   * How many times l'Hopital's rule has been used, and how many times it may be.
   * Shared and mutable, because a limit that never resolves would otherwise
   * differentiate forever; spending the budget makes it decline instead.
   */
  lhopital?: { used: number; max: number };
}

export interface RuleResult {
  node: MathNode;
  changes: Change[];
  /** Values substituted into the explanation template. */
  vars?: Record<string, string>;
  /** Overrides the rule's default explanation key. */
  explanationKey?: string;
}

export interface Rule {
  id: string;
  /** Returns a replacement for `n`, or null when the rule does not apply. */
  apply(n: MathNode, ctx: RuleContext): RuleResult | null;
}

export type SolutionKind =
  | "simplify"
  | "solve"
  | "evaluate"
  | "differentiate"
  | "factor"
  | "limit"
  | "integrate";

/**
 * One end of an interval. The bound is kept as an expression rather than a
 * number so the answer to x^2 > 2 stays exact, and `closed` is what separates
 * x < 2 from x \le 2.
 */
export interface IntervalBound {
  value: MathNode;
  closed: boolean;
}

/**
 * A stretch of the number line. Omitting a bound means unbounded in that
 * direction, so x > 3 is `{ lower: { value: 3, closed: false } }`.
 *
 * An inequality answer is a set, not a value, and `answers: string[]` alone
 * cannot say whether two strings are alternatives or the two ends of one range.
 * The rendered LaTeX still goes in `answers` for anything that only wants to
 * print it; this is the structured form, so a caller can test a boundary or
 * decide how to draw it.
 */
export interface Interval {
  lower?: IntervalBound;
  upper?: IntervalBound;
}


export interface Solution {
  kind: SolutionKind;
  /** LaTeX of the problem as parsed. */
  problem: string;
  /** LaTeX of the final answer, ready to render. */
  answer: string;
  /** One entry per solution when solving, e.g. two roots of a quadratic. */
  answers: string[];
  /**
   * Set when the answer is a range rather than a list of values, as it is for
   * every inequality. Ascending and disjoint; two entries mean a union, which
   * is what |x| > 3 and x^2 > 4 both come to.
   */
  intervals?: Interval[];
  steps: Step[];
  /** The variable an equation was solved for, or differentiated or integrated with respect to. */
  variable?: string;
  /**
   * False when at least one step, or the final answer, failed verification.
   * The UI hides the step list when this is false and shows the answer only.
   */
  verified: boolean;
  /** Set when the engine stopped early. */
  incomplete?: boolean;
  /** Human-readable note, e.g. "no real solutions". */
  note?: string;
}

/**
 * What a specialised solver hands back: everything a Solution needs except the
 * problem it started from. Radical, logarithmic, exponential and absolute value
 * equations all reduce to an ordinary one and finish through the same code, so
 * they pass this shape around rather than each building a Solution of its own.
 */
export interface Resolved {
  steps: Step[];
  answers: string[];
  /** Numeric value of each answer; NaN when the answer is not a single number. */
  values: number[];
  /** Overrides the joined answer line, e.g. "no solution". */
  answer?: string;
  intervals?: Interval[];
  note?: string;
  verified: boolean;
  incomplete?: boolean;
}

/**
 * Finishes off an equation that has been reduced to an ordinary one. Passed in
 * rather than imported so the specialised solvers do not have to depend on the
 * module that dispatches to them.
 */
export type Finish = (node: MathNode, variable: string) => Resolved;

export class UnsupportedProblemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedProblemError";
  }
}
