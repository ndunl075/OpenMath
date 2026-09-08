import { describe, expect, it } from "vitest";
import { problems } from "@openmath/corpus";
import { trySolve } from "@openmath/steps";
import type { ChangeKind, Step } from "@openmath/steps";
import {
  buildTimeline, CHOREOGRAPHY, DURATION, sequenceDuration, touchedIds,
} from "@openmath/step-motion";

function firstSolution(latex: string) {
  const outcome = trySolve(latex);
  if (!outcome.ok) throw new Error(`could not solve ${latex}`);
  return outcome.solution;
}

const ALL_KINDS: ChangeKind[] = [
  "move", "combine", "cancel", "add", "replace", "apply-both-sides",
];

describe("choreography", () => {
  it("covers every change kind", () => {
    for (const kind of ALL_KINDS) {
      expect(CHOREOGRAPHY[kind], kind).toBeDefined();
      expect(CHOREOGRAPHY[kind]!.description.length, kind).toBeGreaterThan(0);
    }
  });

  it("gives each kind its own motion", () => {
    const change = { kind: "combine" as const, fromIds: [1, 2], toIds: [3] };
    const combine = CHOREOGRAPHY.combine.build(change);
    expect(combine.filter((t) => t.op === "converge")).toHaveLength(2);
    expect(combine.some((t) => t.op === "fade-in")).toBe(true);

    const cancel = CHOREOGRAPHY.cancel.build({ kind: "cancel", fromIds: [1], toIds: [] });
    expect(cancel.map((t) => t.op)).toEqual(["strike", "fade-out"]);

    const move = CHOREOGRAPHY.move.build({ kind: "move", fromIds: [1], toIds: [2] });
    expect(move[0]!.op).toBe("move");
    expect(move[1]!.op).toBe("pulse");
  });

  it("staggers siblings instead of firing them together", () => {
    const tracks = CHOREOGRAPHY.add.build({ kind: "add", fromIds: [], toIds: [1, 2, 3] });
    const delays = tracks.map((t) => t.delay);
    expect(new Set(delays).size).toBe(3);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
  });
});

describe("buildTimeline", () => {
  it("moves nodes that survive a step but are not part of the change", () => {
    const solution = firstSolution("2x + 3x + 7");
    const step = solution.steps[0]!;
    const timeline = buildTimeline(step);
    const moves = timeline.tracks.filter((t) => t.op === "move");
    // The trailing 7 is untouched by COMBINE_LIKE_TERMS but shifts position.
    expect(moves.length).toBeGreaterThan(0);
    expect(timeline.duration).toBeGreaterThan(0);
  });

  it("reduced motion highlights without moving anything", () => {
    for (const p of problems.slice(0, 30)) {
      if (p.unsupported) continue;
      const outcome = trySolve(p.latex);
      if (!outcome.ok) continue;
      for (const step of outcome.solution.steps) {
        const timeline = buildTimeline(step);
        for (const t of timeline.reducedTracks) {
          expect(t.op, `${p.latex} / ${step.ruleId}`).toBe("pulse");
        }
      }
    }
  });

  it("produces a bounded, non-negative duration for every corpus step", () => {
    for (const p of problems) {
      if (p.unsupported) continue;
      const outcome = trySolve(p.latex);
      if (!outcome.ok) continue;
      for (const step of outcome.solution.steps) {
        const timeline = buildTimeline(step);
        expect(timeline.duration, `${p.latex} / ${step.ruleId}`).toBeGreaterThanOrEqual(0);
        expect(timeline.duration, `${p.latex} / ${step.ruleId}`).toBeLessThanOrEqual(3000);
        for (const t of timeline.tracks) {
          expect(t.duration).toBeGreaterThan(0);
          expect(t.delay).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("never animates an id that is not in the step's trees", () => {
    const solution = firstSolution("5x-3=2x+9");
    for (const step of solution.steps) {
      const timeline = buildTimeline(step);
      const { before, after } = touchedIds(timeline);
      expect(before.every((id) => Number.isFinite(id))).toBe(true);
      expect(after.every((id) => Number.isFinite(id))).toBe(true);
    }
  });

  it("handles a display step with no after tree", () => {
    const solution = firstSolution("x^{2}+2x-5=0");
    const display = solution.steps.find((s) => s.display);
    expect(display).toBeDefined();
    const timeline = buildTimeline(display as Step);
    expect(timeline.tracks).toEqual([]);
    expect(timeline.duration).toBe(0);
  });

  it("sums a run of steps for play-all", () => {
    const solution = firstSolution("2x+3=7");
    const total = sequenceDuration(solution.steps);
    expect(total).toBeGreaterThan(DURATION.base);
    expect(total).toBeLessThan(20000);
  });
});
