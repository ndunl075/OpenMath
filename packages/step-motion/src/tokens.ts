/**
 * Motion tokens. Every duration in an animation reads from here so the whole
 * app shares one sense of timing, and so a single change slows everything down.
 */
export const DURATION = {
  fast: 150,
  base: 250,
  slow: 400,
} as const;

/** Gap between staggered siblings, e.g. terms appearing one after another. */
export const STAGGER = 60;

export const EASING = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  emphasized: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

export type EasingName = keyof typeof EASING;
