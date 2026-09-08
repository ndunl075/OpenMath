import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export type CameraState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "ready"; hasTorch: boolean }
  | { status: "denied" }
  | { status: "unavailable"; reason: string };

/**
 * Rear camera preview. Every failure path lands on a state the UI can explain,
 * because "camera not working" with no reason is the fastest way to lose someone
 * on their first visit.
 */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({ status: "idle" });
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchOn(false);
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;

    const start = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState({
          status: "unavailable",
          reason: "This browser cannot open a camera. You can still type the problem in.",
        });
        return;
      }
      if (!window.isSecureContext) {
        setState({
          status: "unavailable",
          reason: "Cameras need a secure connection. Open this page over HTTPS.",
        });
        return;
      }

      setState({ status: "starting" });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        setState({ status: "ready", hasTorch: Boolean(capabilities?.torch) });
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setState({ status: "denied" });
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setState({
            status: "unavailable",
            reason: "No camera was found on this device.",
          });
        } else {
          setState({
            status: "unavailable",
            reason: "The camera could not be started.",
          });
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, stop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Torch is best-effort; plenty of devices report it and then refuse.
    }
  }, [torchOn]);

  /** Grab the current frame at the video's native resolution. */
  const capture = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas;
  }, []);

  return { videoRef, state, torchOn, toggleTorch, capture };
}
