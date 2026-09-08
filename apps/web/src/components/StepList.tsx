import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Solution } from "@openmath/steps";
import { Icon } from "./Icon.js";
import { StepCard } from "./StepCard.js";

export interface StepListProps {
  solution: Solution;
  solutionId: string;
  speed: number;
  onSpeedChange: (speed: number) => void;
  reducedMotion: boolean;
}

const SPEEDS = [0.5, 1, 1.5, 2];

export function StepList({
  solution, solutionId, speed, onSpeedChange, reducedMotion,
}: StepListProps) {
  const players = useRef(new Map<number, () => Promise<void>>());
  const [playingAll, setPlayingAll] = useState(false);
  const cancelled = useRef(false);

  const register = useCallback((index: number, play: () => Promise<void>) => {
    players.current.set(index, play);
  }, []);

  useEffect(() => {
    players.current.clear();
    return () => {
      cancelled.current = true;
    };
  }, [solutionId]);

  const playAll = async () => {
    if (playingAll) {
      cancelled.current = true;
      setPlayingAll(false);
      return;
    }
    cancelled.current = false;
    setPlayingAll(true);
    for (let i = 0; i < solution.steps.length; i++) {
      if (cancelled.current) break;
      await players.current.get(i)?.();
    }
    setPlayingAll(false);
  };

  if (solution.steps.length === 0) {
    return (
      <p class="steps__empty">
        This one is already in its simplest form, so there is nothing to work through.
      </p>
    );
  }

  return (
    <section class="steps" aria-label="Solving steps">
      <div class="steps__toolbar">
        <button type="button" class="button button--ghost" onClick={() => void playAll()}>
          <Icon name={playingAll ? "pause" : "play"} size={16} filled={!playingAll} />
          {playingAll ? "Stop" : "Play all"}
        </button>
        <div class="speed" role="group" aria-label="Animation speed">
          <Icon name="gauge" size={15} />
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              class={`speed__option ${s === speed ? "is-active" : ""}`}
              aria-pressed={s === speed}
              onClick={() => onSpeedChange(s)}
            >
              {s}&times;
            </button>
          ))}
        </div>
      </div>

      <ol class="steps__list">
        {solution.steps.map((step, index) => (
          <StepCard
            key={`${solutionId}-${index}`}
            step={step}
            index={index}
            solutionId={solutionId}
            speed={speed}
            reducedMotion={reducedMotion}
            register={register}
          />
        ))}
      </ol>
    </section>
  );
}
