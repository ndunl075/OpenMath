import type { NodeId } from "@openmath/math-core";
import type { Step } from "@openmath/steps";
import { buildTimeline, type MotionTrack, type Timeline } from "./timeline.js";
import { EASING } from "./tokens.js";

export interface PlayOptions {
  /** Must be position:relative; ghosts are layered inside it. */
  container: HTMLElement;
  /** Draw the step's `before` state into the container. */
  renderBefore: () => void;
  /** Draw the step's `after` state into the container. */
  renderAfter: () => void;
  /** Element id prefix used when the LaTeX was serialised with `annotate`. */
  idPrefix: string;
  /** 1 is normal; 2 is twice as fast. */
  speed?: number;
  /** Honour prefers-reduced-motion by highlighting instead of moving. */
  reducedMotion?: boolean;
  highlightColor?: string;
  signal?: AbortSignal;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/* Teal, matching `--highlight` in the web app, for callers that pass nothing. */
const DEFAULT_HIGHLIGHT = "rgba(0, 131, 136, 0.26)";

function measure(container: HTMLElement, prefix: string): Map<NodeId, Box> {
  const base = container.getBoundingClientRect();
  const out = new Map<NodeId, Box>();
  const nodes = container.querySelectorAll<HTMLElement>(`[id^="${CSS.escape(prefix)}"]`);
  for (const el of nodes) {
    const raw = el.id.slice(prefix.length);
    const id = Number(raw);
    if (!Number.isFinite(id)) continue;
    const r = el.getBoundingClientRect();
    out.set(id, {
      left: r.left - base.left,
      top: r.top - base.top,
      width: r.width,
      height: r.height,
    });
  }
  return out;
}

function elementFor(container: HTMLElement, prefix: string, id: NodeId): HTMLElement | null {
  return container.querySelector<HTMLElement>(`#${CSS.escape(prefix + String(id))}`);
}

function makeOverlay(container: HTMLElement): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "om-motion-layer";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    overflow: "visible",
  });
  container.appendChild(layer);
  return layer;
}

/** A floating copy of a `before` element, so it can travel after the DOM moved on. */
function makeGhost(layer: HTMLElement, source: HTMLElement, box: Box): HTMLElement {
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  for (const el of ghost.querySelectorAll("[id]")) el.removeAttribute("id");
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: "0",
    pointerEvents: "none",
  });
  layer.appendChild(ghost);
  return ghost;
}

function strikeLine(ghost: HTMLElement): HTMLElement {
  const line = document.createElement("div");
  Object.assign(line.style, {
    position: "absolute",
    left: "0",
    top: "50%",
    width: "100%",
    height: "2px",
    background: "currentColor",
    transformOrigin: "left center",
    transform: "scaleX(0)",
    borderRadius: "2px",
  });
  ghost.appendChild(line);
  return line;
}

/**
 * Play one step: measure where everything is, redraw the `after` state, then
 * animate each element from where it used to be. Anything the timeline cannot
 * find in the DOM is skipped rather than throwing, so a rendering quirk
 * degrades to a plain cut instead of a broken step card.
 */
export async function playStep(step: Step, options: PlayOptions): Promise<void> {
  const timeline = buildTimeline(step);
  await playTimeline(timeline, options);
}

export async function playTimeline(timeline: Timeline, options: PlayOptions): Promise<void> {
  const {
    container, renderBefore, renderAfter, idPrefix,
    speed = 1, reducedMotion = false, highlightColor = DEFAULT_HIGHLIGHT, signal,
  } = options;

  if (typeof document === "undefined") {
    renderAfter();
    return;
  }

  renderBefore();
  const beforeBoxes = measure(container, idPrefix);
  const beforeElements = new Map<NodeId, HTMLElement>();
  for (const id of beforeBoxes.keys()) {
    const el = elementFor(container, idPrefix, id);
    if (el) beforeElements.set(id, el);
  }
  // Clone before the DOM is replaced; the ghosts outlive it.
  const snapshots = new Map<NodeId, HTMLElement>();
  for (const [id, el] of beforeElements) snapshots.set(id, el.cloneNode(true) as HTMLElement);

  renderAfter();
  const afterBoxes = measure(container, idPrefix);

  const tracks = reducedMotion ? timeline.reducedTracks : timeline.tracks;
  if (tracks.length === 0) return;

  const previousPosition = container.style.position;
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const layer = makeOverlay(container);
  const animations: Animation[] = [];
  const scale = (ms: number) => Math.max(1, ms / Math.max(0.25, speed));

  for (const track of tracks) {
    const anim = buildAnimation(track, {
      container, layer, idPrefix, snapshots, beforeBoxes, afterBoxes, highlightColor, scale,
    });
    if (anim) animations.push(...anim);
  }

  const cleanup = () => {
    layer.remove();
    container.style.position = previousPosition;
  };

  if (signal) {
    if (signal.aborted) {
      for (const a of animations) a.cancel();
      cleanup();
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        for (const a of animations) a.cancel();
      },
      { once: true },
    );
  }

  try {
    await Promise.all(animations.map((a) => a.finished.catch(() => undefined)));
  } finally {
    cleanup();
  }
}

interface BuildContext {
  container: HTMLElement;
  layer: HTMLElement;
  idPrefix: string;
  snapshots: Map<NodeId, HTMLElement>;
  beforeBoxes: Map<NodeId, Box>;
  afterBoxes: Map<NodeId, Box>;
  highlightColor: string;
  scale: (ms: number) => number;
}

function buildAnimation(track: MotionTrack, ctx: BuildContext): Animation[] | null {
  const timing: KeyframeAnimationOptions = {
    delay: ctx.scale(track.delay),
    duration: ctx.scale(track.duration),
    easing: EASING[track.easing],
    fill: "both",
  };

  switch (track.op) {
    case "move": {
      if (track.toId === undefined || track.fromId === undefined) return null;
      const target = elementFor(ctx.container, ctx.idPrefix, track.toId);
      const from = ctx.beforeBoxes.get(track.fromId);
      const to = ctx.afterBoxes.get(track.toId);
      if (!target || !from || !to) return null;
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
      return [
        target.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          timing,
        ),
      ];
    }

    case "converge": {
      if (track.fromId === undefined) return null;
      const snapshot = ctx.snapshots.get(track.fromId);
      const from = ctx.beforeBoxes.get(track.fromId);
      if (!snapshot || !from) return null;
      const to = track.toId !== undefined ? ctx.afterBoxes.get(track.toId) : undefined;
      const ghost = makeGhost(ctx.layer, snapshot, from);
      const dx = to ? to.left - from.left : 0;
      const dy = to ? to.top - from.top : 0;
      return [
        ghost.animate(
          [
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.72)`, opacity: 0 },
          ],
          timing,
        ),
      ];
    }

    case "fade-out": {
      if (track.fromId === undefined) return null;
      const snapshot = ctx.snapshots.get(track.fromId);
      const from = ctx.beforeBoxes.get(track.fromId);
      if (!snapshot || !from) return null;
      const ghost = makeGhost(ctx.layer, snapshot, from);
      return [ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing)];
    }

    case "strike": {
      if (track.fromId === undefined) return null;
      const snapshot = ctx.snapshots.get(track.fromId);
      const from = ctx.beforeBoxes.get(track.fromId);
      if (!snapshot || !from) return null;
      const ghost = makeGhost(ctx.layer, snapshot, from);
      const line = strikeLine(ghost);
      return [line.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], timing)];
    }

    case "fade-in": {
      if (track.toId === undefined) return null;
      const target = elementFor(ctx.container, ctx.idPrefix, track.toId);
      if (!target) return null;
      return [
        target.animate(
          [
            { opacity: 0, transform: "scale(0.88)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          timing,
        ),
      ];
    }

    case "pulse": {
      const id = track.toId ?? track.fromId;
      if (id === undefined) return null;
      const target =
        track.toId !== undefined ? elementFor(ctx.container, ctx.idPrefix, track.toId) : null;
      if (!target) return null;
      return [
        target.animate(
          [
            { backgroundColor: "transparent", transform: "scale(1)" },
            { backgroundColor: ctx.highlightColor, transform: "scale(1.08)" },
            { backgroundColor: "transparent", transform: "scale(1)" },
          ],
          { ...timing, duration: ctx.scale(track.duration * 2) },
        ),
      ];
    }
  }
}

/** Does the viewer prefer reduced motion? Safe to call outside the browser. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
