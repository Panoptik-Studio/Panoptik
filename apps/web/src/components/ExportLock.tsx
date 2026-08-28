/**
 * Blocks the editor while an export runs.
 *
 * The export re-renders every frame through the same decoder and canvas the
 * preview uses, so seeking, playing or editing mid-run would feed the encoder
 * the wrong frames. This covers the whole app and swallows pointer and key
 * input rather than relying on every control remembering to disable itself.
 */
"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/stores/projectStore";

export function ExportLock() {
  const progress = useProjectStore((s) => s.exportProgress);
  const active = progress !== null;

  // Shortcuts bypass an overlay, so they are stopped at the source. Capture
  // phase, so this runs before the editor's own listeners.
  useEffect(() => {
    if (!active) return;
    const swallow = (e: KeyboardEvent) => {
      // Leave the browser's own chrome alone (reload, devtools, tab switching).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", swallow, true);
    return () => window.removeEventListener("keydown", swallow, true);
  }, [active]);

  // Leaving mid-export loses the render; warn rather than silently discarding.
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  if (!active) return null;

  const pct = Math.round(progress * 100);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(248,248,248,0.72)", backdropFilter: "blur(3px)", cursor: "progress" }}
      // Swallow every pointer interaction underneath.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      role="alertdialog"
      aria-busy="true"
      aria-label="Exporting video"
    >
      <div className="pk-card flex w-full max-w-[380px] flex-col items-center px-8 py-9 text-center">
        <div
          className="mb-5 flex h-14 w-14 items-center justify-center rounded-[16px]"
          style={{ background: "#1f1f1f", color: "#fff" }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        <h3 className="pk-ui" style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a" }}>
          Exporting your <span className="pk-accent">video</span>
        </h3>
        <p className="pk-help mt-2 max-w-[32ch]">
          Every frame is rendered through the preview pipeline. Editing is paused
          until this finishes.
        </p>

        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#ebebeb" }}>
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ width: `${pct}%`, background: "#0070f3" }}
          />
        </div>
        <span className="pk-ui mt-2.5 tabular-nums" style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}
