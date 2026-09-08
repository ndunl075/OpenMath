import { useEffect, useRef, useState } from "preact/hooks";
import type { Solution } from "@openmath/steps";
import { reportUrl } from "../lib/report.js";
import { Icon } from "./Icon.js";
import { MathView } from "./MathView.js";
import { StepList } from "./StepList.js";

export type SheetHeight = "peek" | "full";

export interface ResultOutcome {
  id: string;
  latex: string;
  raw?: string;
  solution?: Solution;
  error?: { reason: string; message: string };
}

export interface ResultSheetProps {
  outcome: ResultOutcome;
  height: SheetHeight;
  onHeightChange: (height: SheetHeight) => void;
  onDismiss: () => void;
  onEdit: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  reducedMotion: boolean;
}

const DRAG_THRESHOLD = 60;

export function ResultSheet({
  outcome, height, onHeightChange, onDismiss, onEdit, speed, onSpeedChange, reducedMotion,
}: ResultSheetProps) {
  const [showSteps, setShowSteps] = useState(false);
  const dragRef = useRef<{ startY: number; moved: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    setShowSteps(false);
  }, [outcome.id]);

  const solution = outcome.solution;
  const stepsAvailable = !!solution && solution.verified && solution.steps.length > 0;

  const openSteps = () => {
    setShowSteps(true);
    onHeightChange("full");
  };

  const onPointerDown = (event: PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { startY: event.clientY, moved: 0 };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragRef.current) return;
    const delta = event.clientY - dragRef.current.startY;
    dragRef.current.moved = delta;
    setDragOffset(height === "full" && delta < 0 ? 0 : delta);
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragOffset(0);
    if (!drag) return;
    if (drag.moved < -DRAG_THRESHOLD) onHeightChange("full");
    else if (drag.moved > DRAG_THRESHOLD) {
      if (height === "full") onHeightChange("peek");
      else onDismiss();
    }
  };

  return (
    <div class={`sheet sheet--${height}`} style={{ transform: `translateY(${dragOffset}px)` }}>
      <div
        class="sheet__grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="separator"
        aria-label="Drag to resize, or drag down to dismiss"
      >
        <span />
      </div>

      <div class="sheet__body">
        <div class="sheet__problem">
          <div class="sheet__problem-math">
            <MathView latex={outcome.latex} label={`Problem: ${outcome.latex}`} />
          </div>
          <button type="button" class="icon-button icon-button--subtle" onClick={onEdit} aria-label="Edit the problem">
            <Icon name="pencil" size={18} />
          </button>
          <button type="button" class="icon-button icon-button--subtle" onClick={onDismiss} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>

        {outcome.error ? (
          <div class="result result--error">
            <h2>
              <Icon name="alert" size={20} />
              {outcome.error.reason === "unsupported"
                ? "Not supported yet"
                : "Could not read that"}
            </h2>
            <p>{outcome.error.message}</p>
            <p class="result__scope">
              Right now OpenMath handles arithmetic, fractions, roots, expanding and
              simplifying, linear equations and inequalities, quadratics, exact
              trigonometric and logarithmic values, derivatives in a single variable,
              and limits.
            </p>
            <div class="result__actions">
              <button type="button" class="button button--primary" onClick={onEdit}>
                <Icon name="pencil" size={18} />
                Edit the problem
              </button>
              <a
                class="button button--ghost"
                href={reportUrl({
                  latex: outcome.latex,
                  ...(outcome.raw ? { raw: outcome.raw } : {}),
                  reason: outcome.error.message,
                })}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="external" size={18} />
                Report it
              </a>
            </div>
          </div>
        ) : solution ? (
          <div class="result">
            <p class="result__label">
              {solution.answers.length > 1 ? "Solutions" : "Answer"}
            </p>
            {/* Two roots stack rather than running off the edge of a phone. */}
            {solution.answers.length > 1 ? (
              <ul class="result__answers">
                {solution.answers.map((answer) => (
                  <li key={answer}>
                    <MathView latex={answer} display label={`Solution: ${answer}`} />
                  </li>
                ))}
              </ul>
            ) : (
              <div class="result__answer">
                <MathView latex={solution.answer} display label={`Answer: ${solution.answer}`} />
              </div>
            )}
            {solution.note ? <p class="result__note">{solution.note}</p> : null}

            {!solution.verified ? (
              <p class="result__unverified">
                <Icon name="alert" size={16} />
                Some steps could not be checked, so they are hidden. The answer above is
                still shown, but treat it with care and please report this.
              </p>
            ) : null}

            {stepsAvailable && !showSteps ? (
              <button type="button" class="button button--primary button--block" onClick={openSteps}>
                Show solving steps
                <Icon name="chevronUp" size={18} />
              </button>
            ) : null}

            {showSteps && solution ? (
              <StepList
                solution={solution}
                solutionId={outcome.id}
                speed={speed}
                onSpeedChange={onSpeedChange}
                reducedMotion={reducedMotion}
              />
            ) : null}

            {showSteps ? (
              <a
                class="result__report"
                href={reportUrl({
                  latex: outcome.latex,
                  ...(outcome.raw ? { raw: outcome.raw } : {}),
                  reason: "The steps or the answer look wrong.",
                })}
                target="_blank"
                rel="noreferrer noopener"
              >
                Something wrong here? Report it
              </a>
            ) : null}
          </div>
        ) : (
          <div class="result">
            <p class="result__label">Working it out…</p>
          </div>
        )}
      </div>
    </div>
  );
}
