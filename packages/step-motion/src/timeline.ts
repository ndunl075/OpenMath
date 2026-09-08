import { idOrder, type NodeId } from "@openmath/math-core";
import type { Change, ChangeKind, Step } from "@openmath/steps";
import { DURATION, type EasingName, STAGGER } from "./tokens.js";

export type MotionOp =
  /** Element exists in both renders: translate from its old box to its new one. */
  | "move"
  /** Element travels to a destination and dissolves into it. */
  | "converge"
  | "fade-in"
  | "fade-out"
  /** Brief scale-and-highlight to draw the eye. */
  | "pulse"
  /** Line drawn through the element, then it fades. */
  | "strike";

export interface MotionTrack {
  op: MotionOp;
  /** Node id in the step's `before` tree. */
  fromId?: NodeId;
  /** Node id in the step's `after` tree. */
  toId?: NodeId;
  /** Milliseconds from the start of the step. */
  delay: number;
  duration: number;
  easing: EasingName;
}

export interface Timeline {
  ruleId: string;
  tracks: MotionTrack[];
  /** Highlight-only version for prefers-reduced-motion. */
  reducedTracks: MotionTrack[];
  duration: number;
}

export interface ChoreographySpec {
  /** Human note explaining the intent, shown in the docs and dev tools. */
  description: string;
  build(change: Change): MotionTrack[];
}

/**
 * How each kind of change is danced, per ARCHITECTURE section 6.1.
 *
 * Adding a rule means the rule reports one of these change kinds. Adding a new
 * kind means adding a line here; the type checker enforces that this table is
 * exhaustive.
 */
export const CHOREOGRAPHY: Record<ChangeKind, ChoreographySpec> = {
  move: {
    description: "Slide across the equals sign, then pulse as the sign flips.",
    build: (c) => {
      const tracks: MotionTrack[] = [];
      c.fromIds.forEach((from, i) => {
        const to = c.toIds[i] ?? c.toIds[0];
        tracks.push({
          op: "move",
          fromId: from,
          ...(to !== undefined ? { toId: to } : {}),
          delay: i * STAGGER,
          duration: DURATION.slow,
          easing: "emphasized",
        });
        if (to !== undefined) {
          tracks.push({
            op: "pulse",
            toId: to,
            delay: i * STAGGER + DURATION.slow,
            duration: DURATION.fast,
            easing: "spring",
          });
        }
      });
      return tracks;
    },
  },

  combine: {
    description: "Sources converge on the destination and merge into the result.",
    build: (c) => {
      const target = c.toIds[0];
      const tracks: MotionTrack[] = c.fromIds.map((from, i) => ({
        op: "converge" as const,
        fromId: from,
        ...(target !== undefined ? { toId: target } : {}),
        delay: i * (STAGGER / 2),
        duration: DURATION.base,
        easing: "emphasized" as const,
      }));
      if (target !== undefined) {
        tracks.push({
          op: "fade-in",
          toId: target,
          delay: DURATION.base,
          duration: DURATION.fast,
          easing: "standard",
        });
      }
      return tracks;
    },
  },

  cancel: {
    description: "Strike through, fade out, then the gap closes.",
    build: (c) => {
      const tracks: MotionTrack[] = [];
      c.fromIds.forEach((from, i) => {
        tracks.push({
          op: "strike",
          fromId: from,
          delay: i * (STAGGER / 2),
          duration: DURATION.fast,
          easing: "standard",
        });
        tracks.push({
          op: "fade-out",
          fromId: from,
          delay: i * (STAGGER / 2) + DURATION.fast,
          duration: DURATION.fast,
          easing: "standard",
        });
      });
      return tracks;
    },
  },

  add: {
    description: "The new term fades in with a pulse.",
    build: (c) =>
      c.toIds.map((to, i) => ({
        op: "fade-in" as const,
        toId: to,
        delay: i * STAGGER,
        duration: DURATION.base,
        easing: "spring" as const,
      })),
  },

  replace: {
    description: "The source pulses, then the results fan out and fade in.",
    build: (c) => {
      const tracks: MotionTrack[] = [];
      const source = c.fromIds[0];
      if (source !== undefined) {
        tracks.push({
          op: "pulse",
          fromId: source,
          delay: 0,
          duration: DURATION.fast,
          easing: "standard",
        });
      }
      c.toIds.forEach((to, i) => {
        tracks.push({
          op: "fade-in",
          toId: to,
          delay: DURATION.fast + i * STAGGER,
          duration: DURATION.base,
          easing: "emphasized",
        });
      });
      return tracks;
    },
  },

  "apply-both-sides": {
    description: "The operation appears under both sides at once, then simplifies.",
    build: (c) => {
      const tracks: MotionTrack[] = c.fromIds.map((from) => ({
        op: "pulse" as const,
        fromId: from,
        delay: 0,
        duration: DURATION.fast,
        easing: "standard" as const,
      }));
      c.toIds.forEach((to) => {
        tracks.push({
          op: "fade-in",
          toId: to,
          delay: DURATION.fast,
          duration: DURATION.base,
          easing: "emphasized",
        });
      });
      return tracks;
    },
  },
};

function trackEnd(t: MotionTrack): number {
  return t.delay + t.duration;
}

/**
 * Turn one solver step into an animation timeline.
 *
 * Nodes present in both renders and not named by any change simply travel to
 * their new position, which is what makes an expression look like it rearranged
 * rather than being redrawn.
 */
export function buildTimeline(step: Step): Timeline {
  const tracks: MotionTrack[] = [];

  const beforeIds = new Set(idOrder(step.beforeNode));
  const afterIds = step.afterNode ? new Set(idOrder(step.afterNode)) : new Set<NodeId>();

  const named = new Set<NodeId>();
  for (const change of step.changes) {
    for (const id of change.fromIds) named.add(id);
    for (const id of change.toIds) named.add(id);
  }

  for (const id of beforeIds) {
    if (named.has(id) || !afterIds.has(id)) continue;
    tracks.push({
      op: "move",
      fromId: id,
      toId: id,
      delay: 0,
      duration: DURATION.base,
      easing: "standard",
    });
  }

  for (const change of step.changes) {
    tracks.push(...CHOREOGRAPHY[change.kind].build(change));
  }

  const reducedTracks: MotionTrack[] = step.changes.flatMap((change) => {
    const ids = change.toIds.length > 0 ? change.toIds : change.fromIds;
    const isTo = change.toIds.length > 0;
    return ids.map((id) => ({
      op: "pulse" as const,
      ...(isTo ? { toId: id } : { fromId: id }),
      delay: 0,
      duration: DURATION.fast,
      easing: "standard" as const,
    }));
  });

  const duration = tracks.reduce((max, t) => Math.max(max, trackEnd(t)), 0);
  return { ruleId: step.ruleId, tracks, reducedTracks, duration };
}

/** Total time to play a run of steps back to back. */
export function sequenceDuration(steps: Step[], gap = STAGGER * 2): number {
  return steps.reduce((total, s) => total + buildTimeline(s).duration + gap, 0);
}

/** The ids an animation touches, for the renderer to pre-resolve. */
export function touchedIds(timeline: Timeline): { before: NodeId[]; after: NodeId[] } {
  const before = new Set<NodeId>();
  const after = new Set<NodeId>();
  for (const t of [...timeline.tracks, ...timeline.reducedTracks]) {
    if (t.fromId !== undefined) before.add(t.fromId);
    if (t.toId !== undefined) after.add(t.toId);
  }
  return { before: [...before], after: [...after] };
}
