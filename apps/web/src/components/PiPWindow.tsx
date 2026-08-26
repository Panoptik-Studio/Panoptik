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
    if (!videoRef.current || !stream) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

  // Keep playing when visible
  useEffect(() => {
    if (!pipWindow || !isRecording) return;
    const id = window.setInterval(() => {
      videoRef.current?.play().catch(() => {});
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
    <div style={{ width: "100%", height: "100%", background: "#000", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, background: "#000" }}>
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
            background: "#000",
            borderRadius: shape === "circle" ? "50%" : 14,
            boxShadow: "0 0 0 1.5px rgba(255,255,255,0.16)",
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
      <div style={{ height: 52, flexShrink: 0, background: "#0F1012", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", color: "white" }}>
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
