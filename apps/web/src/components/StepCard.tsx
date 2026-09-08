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

function highlightColor(): string {
  if (typeof window === "undefined") return "rgba(99, 102, 241, 0.28)";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--highlight")
    .trim();
  return value || "rgba(99, 102, 241, 0.28)";
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
    <li class="step-card">
      <div class="step-card__head">
        <span class="step-card__number" aria-hidden="true">
          {index + 1}
        </span>
        <button
          type="button"
          class="step-card__title"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span>{step.title}</span>
          <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} />
        </button>
        {animatable ? (
          <button
            type="button"
            class="step-card__play"
            onClick={() => void play()}
            aria-label={`Replay step ${index + 1}: ${step.title}`}
            disabled={playing}
          >
            <Icon name={playing ? "pause" : "play"} size={16} filled={!playing} />
          </button>
        ) : null}
      </div>

      <div class="step-card__math math-scroll" ref={mathRef} />

      {expanded && step.explanation ? (
        <p class="step-card__explanation">{step.explanation}</p>
      ) : null}

      {step.unverified ? (
        <p class="step-card__warning">
          <Icon name="alert" size={15} />
          This step could not be checked automatically.
        </p>
      ) : null}
    </li>
  );
}
