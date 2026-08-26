/**
 * PiPWindow — renders camera (mirrored, circle/square) into Document PiP window.
 * Stays visible over desktop when sharing screen, like the reference recorder.
 */
"use client";

import { useEffect, useRef } from "react";
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

export function PiPWindow({ pipWindow, stream, shape, elapsed, isRecording, onStop }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    // Compare the track, not the MediaStream: handing over from preview to
    // recording wraps the *same* camera track in a new MediaStream, and
    // re-assigning srcObject restarts the element — a visible flicker.
    const attached = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (attached === stream.getVideoTracks()[0]) return;
    v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream]);

  // Recover only from an actual stall — play() on a playing element makes the
  // picture hitch, which reads as flicker in a small bubble.
  useEffect(() => {
    if (!pipWindow || !isRecording) return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (v && v.paused && v.srcObject) v.play().catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [pipWindow, isRecording, stream]);

  // Give the PiP document a full-height root. Without an explicit height on
  // <html>/<body>, the layout's `height: 100%` resolves against auto and
  // collapses to the video's intrinsic size, leaving dead space below.
  useEffect(() => {
    if (!pipWindow) return;
    const { documentElement: root, body } = pipWindow.document;
    for (const el of [root, body]) {
      el.style.height = "100%";
      el.style.margin = "0";
      el.style.background = "#000";
    }
    body.style.overflow = "hidden";
  }, [pipWindow]);

  if (!pipWindow) return null;

  return createPortal(
    <div style={{ width: "100%", height: "100%", background: "#0B0C0E", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 10, background: "#0B0C0E" }}>
        {/* Largest square that fits, whatever shape the user resizes the window
            to — a 50% radius on a non-square box renders as an ellipse. */}
        <div
          style={{
            position: "relative",
            aspectRatio: "1 / 1",
            height: "100%",
            maxHeight: "100%",
            maxWidth: "100%",
            overflow: "hidden",
            background: "#17181B",
            borderRadius: shape === "circle" ? "50%" : 16,
            boxShadow:
              "0 0 0 2px rgba(255,255,255,0.9), 0 8px 24px rgba(0,0,0,0.55)",
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)",
              display: "block",
            }}
          />
          {!stream && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa" }}>
              <span style={{ fontSize: 12, color: "#888" }}>No camera</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ height: 46, flexShrink: 0, background: "#0B0C0E", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", color: "white" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "Geist Mono, JetBrains Mono, monospace", fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
          {isRecording && (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E11D48", boxShadow: "0 0 8px rgba(225,29,72,0.9)" }} />
          )}
          {isRecording ? fmt(elapsed) : "Preview"}
        </span>
        <button
          onClick={onStop}
          style={{ background: isRecording ? "#E11D48" : "#171717", color: "white", border: "none", borderRadius: 9999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          {isRecording ? "Stop" : "Close"}
        </button>
      </div>
    </div>,
    pipWindow.document.body,
  );
}
