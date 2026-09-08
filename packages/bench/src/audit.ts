import { labelledAnswerMatches, read } from "./reading.js";
import type { CorpusItem, SolveFailure } from "./types.js";

export interface UnscorableItem {
  file: string;
  reason: SolveFailure;
  message?: string;
}

export interface AnswerMismatch {
  file: string;
  /** The answer written in the manifest. */
  labelled: string;
  /** What the solver makes of the ground-truth LaTeX. */
  solved: string;
}

export interface CorpusAudit {
  scorable: number;
  /** Ground truths the solver cannot answer, so no model can score on them. */
  unscorable: UnscorableItem[];
  /** Labels whose hand-written answer disagrees with the solver: one of the two is wrong. */
  answerMismatches: AnswerMismatch[];
}

/**
 * Check the corpus before blaming a model for it. A ground truth the solver
 * cannot answer scores nothing for anyone, and a hand-written answer that
 * disagrees with the solver means either the photo is mislabelled or the step
 * engine has a bug worth a corpus entry of its own.
 */
export function auditCorpus(items: readonly CorpusItem[]): CorpusAudit {
  const unscorable: UnscorableItem[] = [];
  const answerMismatches: AnswerMismatch[] = [];
  let scorable = 0;

  for (const item of items) {
    const reading = read(item.latex);
    if (!reading.solved) {
      unscorable.push({
        file: item.file,
        reason: reading.failure ?? "error",
        ...(reading.failureMessage ? { message: reading.failureMessage } : {}),
      });
      continue;
    }
    scorable++;
    if (item.answer === undefined) continue;
    // A label the solver cannot read at all (two roots written out in prose,
    // say) is not evidence of anything, so it is skipped rather than reported.
    const labelled = read(item.answer);
    if (labelled.solved && !labelledAnswerMatches(labelled, reading)) {
      answerMismatches.push({ file: item.file, labelled: item.answer, solved: reading.answer ?? "" });
    }
  }

  return { scorable, unscorable, answerMismatches };
}
