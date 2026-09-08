import { useCallback, useRef, useState } from "preact/hooks";
import type { Rect } from "@openmath/ocr";
import { useCamera } from "../hooks/useCamera.js";
import type { OcrStatus } from "../hooks/useOcr.js";
import { Icon } from "./Icon.js";

export interface ScannerProps {
  active: boolean;
  status: OcrStatus;
  providerLabel: string;
  providerBytes: number;
  onCapture: (source: HTMLCanvasElement | Blob, crop?: Rect) => void;
  onTypeIn: () => void;
  onOpenHistory: () => void;
}

/** Viewfinder position as a fraction of the preview, so it survives rotation. */
interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const INITIAL_FRAME: Frame = { x: 0.08, y: 0.36, width: 0.84, height: 0.2 };
const MIN_SIZE = 0.08;

type DragMode = "move" | "nw" | "ne" | "sw" | "se" | null;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Maps a rectangle drawn over a `object-fit: cover` preview back onto the
 * camera's native frame. Without this the crop is silently offset on any phone
 * whose sensor aspect ratio differs from the screen, which is most of them.
 */
function frameToVideoRect(
  frame: Frame,
  display: { width: number; height: number },
  video: { width: number; height: number },
): Rect {
  const scale = Math.max(display.width / video.width, display.height / video.height);
  const renderedWidth = video.width * scale;
  const renderedHeight = video.height * scale;
  const offsetX = (renderedWidth - display.width) / 2;
  const offsetY = (renderedHeight - display.height) / 2;

  const left = (frame.x * display.width + offsetX) / scale;
  const top = (frame.y * display.height + offsetY) / scale;
  const width = (frame.width * display.width) / scale;
  const height = (frame.height * display.height) / scale;

  return {
    x: clamp(left, 0, video.width),
    y: clamp(top, 0, video.height),
    width: clamp(width, 1, video.width),
    height: clamp(height, 1, video.height),
  };
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function Scanner({
  active, status, providerLabel, providerBytes, onCapture, onTypeIn, onOpenHistory,
}: ScannerProps) {
  const { videoRef, state, torchOn, toggleTorch, capture } = useCamera(active);
  const stageRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Frame>(INITIAL_FRAME);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; start: Frame } | null>(null);

  const busy = status.phase === "loading" || status.phase === "recognising";

  const onPointerDown = (mode: DragMode) => (event: PointerEvent) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, start: frame };
  };

  const onPointerMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) / bounds.width;
    const dy = (event.clientY - drag.startY) / bounds.height;
    const s = drag.start;

    if (drag.mode === "move") {
      setFrame({
        ...s,
        x: clamp(s.x + dx, 0, 1 - s.width),
        y: clamp(s.y + dy, 0, 1 - s.height),
      });
      return;
    }

    const west = drag.mode === "nw" || drag.mode === "sw";
    const north = drag.mode === "nw" || drag.mode === "ne";
    let { x, y, width, height } = s;

    if (west) {
      const nextX = clamp(s.x + dx, 0, s.x + s.width - MIN_SIZE);
      width = s.width + (s.x - nextX);
      x = nextX;
    } else {
      width = clamp(s.width + dx, MIN_SIZE, 1 - s.x);
    }
    if (north) {
      const nextY = clamp(s.y + dy, 0, s.y + s.height - MIN_SIZE);
      height = s.height + (s.y - nextY);
      y = nextY;
    } else {
      height = clamp(s.height + dy, MIN_SIZE, 1 - s.y);
    }
    setFrame({ x, y, width, height });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const takePhoto = useCallback(() => {
    const canvas = capture();
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const crop = frameToVideoRect(
      frame,
      { width: bounds.width, height: bounds.height },
      { width: canvas.width, height: canvas.height },
    );
    onCapture(canvas, crop);
  }, [capture, frame, onCapture]);

  const onPickFile = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) onCapture(file);
    input.value = "";
  };

  const showPreview = state.status === "ready" || state.status === "starting";

  return (
    <div class="scanner">
      <div class="scanner__stage" ref={stageRef}>
        <video
          ref={videoRef}
          class={`scanner__video ${showPreview ? "is-live" : ""}`}
          playsInline
          muted
          autoPlay
        />

        {showPreview ? (
          <>
            <div
              class="scanner__scrim"
              style={{
                clipPath: `polygon(0% 0%, 0% 100%, ${frame.x * 100}% 100%, ${frame.x * 100}% ${frame.y * 100}%, ${(frame.x + frame.width) * 100}% ${frame.y * 100}%, ${(frame.x + frame.width) * 100}% ${(frame.y + frame.height) * 100}%, ${frame.x * 100}% ${(frame.y + frame.height) * 100}%, ${frame.x * 100}% 100%, 100% 100%, 100% 0%)`,
              }}
            />
            <div
              class="viewfinder"
              style={{
                left: `${frame.x * 100}%`,
                top: `${frame.y * 100}%`,
                width: `${frame.width * 100}%`,
                height: `${frame.height * 100}%`,
              }}
              onPointerDown={onPointerDown("move")}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="application"
              aria-label="Viewfinder. Drag to move, drag a corner to resize."
            >
              {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                <span
                  key={corner}
                  class={`viewfinder__handle viewfinder__handle--${corner}`}
                  onPointerDown={onPointerDown(corner)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              ))}
              {busy ? <span class="viewfinder__sweep" /> : null}
            </div>
          </>
        ) : (
          <div class="scanner__fallback">
            {state.status === "denied" ? (
              <>
                <Icon name="camera" size={34} />
                <h2>Camera access is off</h2>
                <p>
                  Allow camera access in your browser settings to scan, or type the problem
                  in instead. Nothing you scan ever leaves this device.
                </p>
              </>
            ) : state.status === "unavailable" ? (
              <>
                <Icon name="camera" size={34} />
                <h2>No camera here</h2>
                <p>{state.reason}</p>
              </>
            ) : (
              <>
                <Icon name="camera" size={34} />
                <h2>Starting the camera</h2>
              </>
            )}
            <button type="button" class="button button--primary" onClick={onTypeIn}>
              <Icon name="keyboard" size={18} />
              Type it in
            </button>
          </div>
        )}

        <header class="scanner__top">
          <button type="button" class="icon-button" onClick={onOpenHistory} aria-label="History">
            <Icon name="history" size={22} />
          </button>
          <span class="scanner__brand">OpenMath</span>
          {state.status === "ready" && state.hasTorch ? (
            <button
              type="button"
              class={`icon-button ${torchOn ? "is-active" : ""}`}
              onClick={() => void toggleTorch()}
              aria-label={torchOn ? "Turn the light off" : "Turn the light on"}
              aria-pressed={torchOn}
            >
              <Icon name={torchOn ? "flash" : "flashOff"} size={22} />
            </button>
          ) : (
            <span class="icon-button icon-button--placeholder" aria-hidden="true" />
          )}
        </header>

        {status.phase === "loading" ? (
          <div class="scanner__progress" role="status">
            <p>
              Getting the {providerLabel} recogniser ready
              {status.progress.fraction === null
                ? ` (about ${formatBytes(providerBytes)}, one time)`
                : ` ${Math.round(status.progress.fraction * 100)}%`}
            </p>
            <div class="progress">
              <div
                class="progress__bar"
                style={{
                  width: status.progress.fraction === null
                    ? "35%"
                    : `${status.progress.fraction * 100}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {status.phase === "error" ? (
          <div class="scanner__progress scanner__progress--error" role="alert">
            <p>{status.message}</p>
          </div>
        ) : null}
      </div>

      <footer class="scanner__controls">
        <label class="icon-button icon-button--large" aria-label="Choose a photo">
          <Icon name="image" size={24} />
          <input type="file" accept="image/*" hidden onChange={onPickFile} />
        </label>

        <button
          type="button"
          class="shutter"
          onClick={takePhoto}
          disabled={state.status !== "ready" || busy}
          aria-label="Scan the problem"
        >
          <span class="shutter__ring" />
        </button>

        <button
          type="button"
          class="icon-button icon-button--large"
          onClick={onTypeIn}
          aria-label="Type the problem in"
        >
          <Icon name="keyboard" size={24} />
        </button>
      </footer>
    </div>
  );
}
