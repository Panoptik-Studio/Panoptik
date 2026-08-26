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

  // Ensure body styling in PiP window
  useEffect(() => {
    if (!pipWindow) return;
    pipWindow.document.body.style.margin = "0";
    pipWindow.document.body.style.background = "#000";
    pipWindow.document.documentElement.style.background = "#000";
  }, [pipWindow]);

  if (!pipWindow) return null;

  return createPortal(
    <div style={{ width: "100%", height: "100%", background: "#000", display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#000" }}>
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
            borderRadius: shape === "circle" ? "50%" : 12,
            border: shape === "circle" ? "none" : "1.5px solid rgba(255,255,255,0.12)",
          }}
        />
        {!stream && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", borderRadius: shape === "circle" ? "50%" : 12 }}>
            <span style={{ fontSize: 12, color: "#888" }}>No camera</span>
          </div>
        )}
      </div>
      <div style={{ height: 56, background: "#0F1012", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", color: "white" }}>
        <span style={{ fontFamily: "Geist Mono, JetBrains Mono, monospace", fontSize: 12, color: "#4d4d4d" }}>{isRecording ? fmt(elapsed) : "Preview"}</span>
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
