/**
 * Edit distance, written here rather than added as a dependency. It is twenty
 * lines, and a benchmark whose headline numbers come out of code nobody in the
 * repo can read is worth less than one whose do.
 */

/** Levenshtein distance over code points, two rows at a time. */
export function editDistance(a: string, b: string): number {
  // Code points, not UTF-16 units: a stray non-ASCII symbol the model emitted
  // should count as one wrong character, not two.
  const s = [...a];
  const t = [...b];
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let prev = new Uint32Array(t.length + 1);
  let curr = new Uint32Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[t.length]!;
}

/**
 * Edits per character of ground truth. Not clamped at 1: a model that emits a
 * page of hallucinated LaTeX for a two-character problem scores far above 1,
 * and hiding that would hide the failure mode.
 */
export function characterErrorRate(reference: string, hypothesis: string): number {
  const refLength = [...reference].length;
  if (refLength === 0) return hypothesis.length === 0 ? 0 : 1;
  return editDistance(reference, hypothesis) / refLength;
}
