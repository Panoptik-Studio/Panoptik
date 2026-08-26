/**
 * Hook for Document Picture-in-Picture (desktop-visible camera).
 * Falls back to null when unsupported.
 */
"use client";

import { useCallback, useRef, useState } from "react";

export function usePiPWindow() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  const requestPipWindow = useCallback(async (): Promise<Window | null> => {
    const w = window as unknown as { documentPictureInPicture?: { requestWindow: (opts: { width: number; height: number }) => Promise<Window> } };
    if (!w.documentPictureInPicture) return null;
    try {
      const pw = await w.documentPictureInPicture.requestWindow({ width: 340, height: 340 });
      // Copy styles for Tailwind + globals
      try {
        const allCSS = [...document.styleSheets]
          .map((ss) => {
            try {
              return [...ss.cssRules].map((r) => r.cssText).join("");
            } catch {
              // cross-origin sheet
              const el = ss.ownerNode as HTMLLinkElement | null;
              if (el?.outerHTML) return el.outerHTML;
              return "";
            }
          })
          .join("\n");
        const style = pw.document.createElement("style");
        style.textContent = allCSS;
        pw.document.head.appendChild(style);
        // Also copy <style> and <link> tags directly for Tailwind
        document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
          try { pw.document.head.appendChild(node.cloneNode(true)); } catch {}
        });
      } catch {}
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
