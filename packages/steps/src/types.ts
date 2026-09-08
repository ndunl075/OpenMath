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

export type SolutionKind = "simplify" | "solve" | "evaluate";

export interface Solution {
  kind: SolutionKind;
  /** LaTeX of the problem as parsed. */
  problem: string;
  /** LaTeX of the final answer, ready to render. */
  answer: string;
  /** One entry per solution when solving, e.g. two roots of a quadratic. */
  answers: string[];
  steps: Step[];
  /** The variable an equation was solved for. */
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

export class UnsupportedProblemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedProblemError";
  }
}
