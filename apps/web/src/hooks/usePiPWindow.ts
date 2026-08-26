/**
 * Hook for Document Picture-in-Picture (desktop-visible camera).
 * Falls back to null when unsupported.
 */
"use client";

import { useCallback, useRef, useState } from "react";

/** The camera fills the window and the controls float over it, so it stays square. */
const MIN_EDGE = 200;
const MAX_EDGE = 460;

/** Document Picture-in-Picture is Chromium-only and needs a secure context. */
export function isPipSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window
  );
}

export function usePiPWindow() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  /** `size` is the camera bubble's edge in px; the window adds room for the control bar. */
  const requestPipWindow = useCallback(async (size = 300): Promise<Window | null> => {
    const w = window as unknown as { documentPictureInPicture?: { requestWindow: (opts: { width: number; height: number }) => Promise<Window> } };
    if (!w.documentPictureInPicture) return null;
    // Reuse an open bubble rather than stacking a second one.
    if (pipWindowRef.current && !pipWindowRef.current.closed) return pipWindowRef.current;
    try {
      const edge = Math.round(Math.max(MIN_EDGE, Math.min(MAX_EDGE, size)));
      const pw = await w.documentPictureInPicture.requestWindow({
        width: edge,
        height: edge,
      });
      // No stylesheet copying: the bubble is entirely inline-styled, so cloning
      // the app's CSS would only add weight and let page rules fight it.
      // Close handler
      pw.addEventListener("pagehide", () => {
        setPipWindow(null);
        pipWindowRef.current = null;
      });
      setPipWindow(pw);
      pipWindowRef.current = pw;
      return pw;
    } catch {
      return null;
    }
  }, []);

  const closePipWindow = useCallback(() => {
    try { pipWindowRef.current?.close(); } catch {}
    setPipWindow(null);
    pipWindowRef.current = null;
  }, []);

  return { pipWindow, requestPipWindow, closePipWindow };
}
