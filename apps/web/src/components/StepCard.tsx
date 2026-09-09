import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Step } from "@openmath/steps";
import { playStep } from "@openmath/step-motion";
import { renderLatex, renderNode, stepIdPrefix } from "../lib/math-render.js";
import { Icon } from "./Icon.js";

export interface StepCardProps {
  step: Step;
  index: number;
  solutionId: string;
  speed: number;
  reducedMotion: boolean;
  /** Lets the parent drive play-all without prop-drilling a queue. */
  register?: (index: number, play: () => Promise<void>) => void;
}

/** The same teal as `--highlight` in tokens.css, for when the stylesheet is not there. */
const FALLBACK_HIGHLIGHT = "rgba(0, 131, 136, 0.26)";

function highlightColor(): string {
  if (typeof window === "undefined") return FALLBACK_HIGHLIGHT;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--highlight")
    .trim();
  return value || FALLBACK_HIGHLIGHT;
}

/**
 * Rule titles are plain English, but some carry a fragment of LaTeX, such as
 * "Move \frac{1}{2} outside the integral". Each token that holds a command
 * is set as math; the rest stays text. The raw title is kept for assistive
 * tech, which has no use for KaTeX's layout spans.
 */
function renderTitle(title: string): JSX.Element {
  if (!title.includes("\\")) return <span>{title}</span>;
  return (
    <span>
      <span class="visually-hidden">{title}</span>
      <span aria-hidden="true">
        {title.split(" ").map((token, i) => (
          <span key={i}>
            {i > 0 ? " " : ""}
            {token.includes("\\")
              ? <span dangerouslySetInnerHTML={{ __html: renderLatex(token) }} />
              : token}
          </span>
        ))}
      </span>
    </span>
  );
}

export function StepCard({
  step, index, solutionId, speed, reducedMotion, register,
}: StepCardProps) {
  const mathRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);

  const prefix = stepIdPrefix(solutionId, index);
  const animatable = !step.display && !!step.afterNode;

  const drawResting = useCallback(() => {
    const el = mathRef.current;
    if (!el) return;
    el.innerHTML = step.afterNode
      ? renderNode(step.afterNode, prefix)
      : renderLatex(step.after);
  }, [step, prefix]);

  useEffect(() => {
    drawResting();
    return () => abortRef.current?.abort();
  }, [drawResting]);

  const play = useCallback(async () => {
    const el = mathRef.current;
    if (!el || !animatable || !step.afterNode) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPlaying(true);
    try {
      await playStep(step, {
        container: el,
        idPrefix: prefix,
        speed,
        reducedMotion,
        highlightColor: highlightColor(),
        signal: controller.signal,
        renderBefore: () => {
          el.innerHTML = renderNode(step.beforeNode, prefix);
        },
        renderAfter: () => {
          el.innerHTML = renderNode(step.afterNode!, prefix);
        },
      });
    } finally {
      if (!controller.signal.aborted) drawResting();
      setPlaying(false);
    }
  }, [animatable, drawResting, prefix, reducedMotion, speed, step]);

  useEffect(() => {
    register?.(index, play);
  }, [index, play, register]);

  return (
    <li class={`step${playing ? " is-playing" : ""}`}>
      <span class="step__number eyebrow" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <button
        type="button"
        class="step__title"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {renderTitle(step.title)}
        <Icon name={expanded ? "chevronUp" : "chevronDown"} size={16} />
      </button>
      {animatable ? (
        <button
          type="button"
          class="step__play"
          onClick={() => void play()}
          aria-label={`Replay step ${index + 1}: ${step.title}`}
          disabled={playing}
        >
          <Icon name={playing ? "pause" : "play"} size={16} filled={!playing} />
        </button>
      ) : null}

      <div class="step__math math-scroll" ref={mathRef} />

      {expanded && step.explanation ? (
        <p class="step__explanation">{step.explanation}</p>
      ) : null}

      {step.unverified ? (
        <p class="step__warning">
          <Icon name="alert" size={15} />
          This step could not be checked automatically.
        </p>
      ) : null}
    </li>
  );
}
