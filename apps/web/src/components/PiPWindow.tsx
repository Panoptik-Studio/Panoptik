/**
 * PiPWindow — renders camera (mirrored, circle/square) into Document PiP window.
 * Stays visible over desktop when sharing screen, like the reference recorder.
 *
 * The <video> carries a class and a ref and nothing else: inline styles are new
 * objects on every render, so React re-applies transform/border-radius to the
 * element each time the timer ticks, and that shows up as flicker in the bubble.
 * All styling lives in a stylesheet injected into the PiP document once.
 */
"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type Props = {
  pipWindow: Window | null;
  stream: MediaStream | null;
  shape: "circle" | "square";
  elapsed: number;
  isRecording: boolean;
  onStop: () => void;
};

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Full-bleed camera with the controls floating over it, so the video's box
 * never changes size — a relayout of a playing video is a visible hitch.
 */
const PIP_CSS = `
  html, body { height: 100%; margin: 0; background: #0B0C0E; overflow: hidden; }
  .pip-root { position: fixed; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr); background: #0B0C0E; font-family: Inter, system-ui, sans-serif; }
  .pip-stage { grid-area: 1/1; display: grid; place-items: center; min-height: 0; }
  .pip-camera { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); background: #17181B; }
  /* A 50% radius on a non-square box is an ellipse, and the user can resize the
     window to any shape — so the circle is constrained to a square that fits. */
  .pip-camera.is-circle {
    aspect-ratio: 1 / 1;
    width: auto;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    border-radius: 50%;
  }
  .pip-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #888; font-size: 12px; background: #fafafa; }
  .pip-controls { grid-area: 1/1; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; padding: 14px 16px; background-image: linear-gradient(to top, rgb(0 0 0 / 62%), rgb(0 0 0 / 0%) 96px); }
  .pip-time { display: flex; align-items: center; gap: 7px; font-family: 'Geist Mono', 'SF Mono', monospace; font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.92); }
  .pip-dot { width: 8px; height: 8px; border-radius: 50%; background: #E11D48; box-shadow: 0 0 8px rgba(225,29,72,0.9); }
  .pip-stop { border: none; border-radius: 9999px; padding: 7px 14px; font-size: 12px; font-weight: 600; color: #fff; cursor: pointer; background: #E11D48; }
  .pip-stop.is-idle { background: #171717; }
`;

/**
 * Timer text only. Kept separate so a tick re-renders this span rather than the
 * subtree holding the <video>.
 */
const Readout = memo(function Readout({
  elapsed,
  isRecording,
}: {
  elapsed: number;
  isRecording: boolean;
}) {
  return (
    <span className="pip-time">
      {isRecording && <span className="pip-dot" />}
      {isRecording ? fmt(elapsed) : "Preview"}
    </span>
  );
});

export const PiPWindow = memo(function PiPWindow({
  pipWindow,
  stream,
  shape,
  elapsed,
  isRecording,
  onStop,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Attach through the ref callback rather than an effect: it fires exactly when
  // the element mounts or the stream changes, never on an unrelated re-render.
  const attachStream = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) {
        if (el.srcObject !== stream) el.srcObject = stream;
        el.play().catch(() => { /* autoplay policy; muted should allow it */ });
      } else if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      videoRef.current = el;
    },
    [stream],
  );

  // One stylesheet per PiP document.
  useEffect(() => {
    if (!pipWindow) return;
    const style = pipWindow.document.createElement("style");
    style.textContent = PIP_CSS;
    pipWindow.document.head.appendChild(style);
    return () => style.remove();
  }, [pipWindow]);

  // Recover only from an actual stall — play() on a playing element hitches.
  useEffect(() => {
    if (!pipWindow || !isRecording) return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (v && v.paused && v.srcObject) v.play().catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [pipWindow, isRecording]);

  if (!pipWindow) return null;

  return createPortal(
    <div className="pip-root">
      <div className="pip-stage">
        {stream ? (
          <video
            ref={attachStream}
            className={shape === "circle" ? "pip-camera is-circle" : "pip-camera"}
            autoPlay
            playsInline
            muted
            controls={false}
          />
        ) : (
          <div className="pip-empty">No camera</div>
        )}
      </div>
      <div className="pip-controls">
        <Readout elapsed={elapsed} isRecording={isRecording} />
        <button
          className={isRecording ? "pip-stop" : "pip-stop is-idle"}
          onClick={onStop}
        >
          {isRecording ? "Stop" : "Close"}
        </button>
      </div>
    </div>,
    pipWindow.document.body,
  );
});
