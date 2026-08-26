/**
 * OWNER: DEV B — ROADMAP-B.md Task 2.2 + 2.4.
 * Interactive canvas: zoom click interaction, focal dot dragging, rAF playback loop.
 * Keyboard undo/redo (Cmd+Z / Cmd+Shift+Z).
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useProjectStore } from "@/stores/projectStore";
import { engine } from "@/lib/engineProvider";
import {
  hitTestFocal,
  normalizeClick,
} from "@/lib/zoomGeometry";

const ASPECT_RATIOS: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
};

type FrameRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function computeFrameRect(
  canvasW: number,
  canvasH: number,
  clipW: number,
  clipH: number,
  preset: string,
): FrameRect {
  const target = ASPECT_RATIOS[preset] ?? canvasW / canvasH;
  const boxW = Math.min(canvasW, canvasH * target);
  const boxH = boxW / target;
  const s = Math.min(boxW / clipW, boxH / clipH);
  const w = clipW * s;
  const h = clipH * s;
  return {
    x: (canvasW - w) / 2,
    y: (canvasH - h) / 2,
    w,
    h,
  };
}

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const {
    project,
    isPlaying,
    currentTime,
    setCurrentTime,
    play,
    pause,
    addZoomPoint,
    updateZoomPoint,
    commitDrag,
    markMoment,
    undo,
    redo,
  } = useProjectStore();

  // Dragging state
  const [dragging, setDragging] = useState<{
    id: string;
    startX: number;
    startY: number;
  } | null>(null);

  // Toast state (moment mark feedback)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // ── Frame rect computation ──
  const getFrameRect = useCallback((): FrameRect | null => {
    const canvas = canvasRef.current;
    if (!canvas || !project) return null;
    return computeFrameRect(
      canvas.width,
      canvas.height,
      project.clip.width,
      project.clip.height,
      project.aspectPreset,
    );
  }, [project]);

  // ── Render loop ──
  useEffect(() => {
    if (!project || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const loop = (now: number) => {
      const dt = lastTimeRef.current
        ? (now - lastTimeRef.current) / 1000
        : 0;
      lastTimeRef.current = now;

      const state = useProjectStore.getState();
      if (state.isPlaying) {
        const newTime = state.currentTime + dt;
        if (newTime >= state.project!.clip.duration) {
          state.pause();
          state.setCurrentTime(state.project!.clip.duration);
        } else {
          state.setCurrentTime(newTime);
        }
      }

      // Delegate all drawing to engine
      engine.renderFrame(ctx, state.project!, state.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [project]);

  // ── Keyboard undo/redo + moment mark (Phase 2.4 + 3.3) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if (mod && e.key === "y") {
        e.preventDefault();
        redo();
      }
      // M key during playback → mark moment
      if (
        e.key === "m" &&
        !mod &&
        !e.altKey &&
        !e.shiftKey &&
        (e.target as HTMLElement).tagName !== "INPUT"
      ) {
        const st = useProjectStore.getState();
        if (st.project && st.isPlaying) {
          st.markMoment(st.currentTime);
          // Show toast
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast(`Moment marked at ${st.currentTime.toFixed(1)}s`);
          toastTimerRef.current = setTimeout(() => setToast(null), 1500);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // ── Click → zoom interaction ──
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const state = useProjectStore.getState();
      if (!state.project || state.isPlaying) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const frame = getFrameRect();
      if (!frame) return;

      const { x, y } = normalizeClick(
        e.clientX,
        e.clientY,
        rect,
        frame,
      );

      // Check if clicking near an existing zoom focal point
      const nearby = state.project.zoomPoints.find(
        (zp) =>
          Math.abs(zp.t - state.currentTime) < 0.5 &&
          hitTestFocal(x, y, zp, frame.w),
      );

      if (nearby) {
        // Zoom out — add identity keyframe
        addZoomPoint({
          t: state.currentTime,
          to: { scale: 1, x: 0.5, y: 0.5 },
          dur: 0.6,
          ease: "easeInOutCubic",
        });
      } else {
        // Zoom in to clicked point
        addZoomPoint({
          t: state.currentTime,
          to: { scale: 2.2, x, y },
          dur: 0.7,
          ease: "easeInOutCubic",
        });
      }
    },
    [addZoomPoint, getFrameRect],
  );

  // ── Focal dot dragging ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const state = useProjectStore.getState();
      if (!state.project || state.isPlaying) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const frame = getFrameRect();
      if (!frame) return;

      const { x, y } = normalizeClick(
        e.clientX,
        e.clientY,
        rect,
        frame,
      );

      // Find nearest committed zoom focal within grab radius
      const nearest = state.project.zoomPoints.find((zp) =>
        hitTestFocal(x, y, zp, frame.w),
      );

      if (nearest) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        setDragging({
          id: nearest.id,
          startX: e.clientX,
          startY: e.clientY,
        });
      }
    },
    [getFrameRect],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragging) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const frame = getFrameRect();
      if (!frame) return;

      const { x, y } = normalizeClick(
        e.clientX,
        e.clientY,
        rect,
        frame,
      );
      updateZoomPoint(dragging.id, {
        to: { scale: 2.2, x, y },
      });
    },
    [dragging, updateZoomPoint, getFrameRect],
  );

  const handlePointerUp = useCallback(() => {
    if (dragging) {
      commitDrag();
    }
    setDragging(null);
  }, [dragging, commitDrag]);

  // ── Canvas sizing ──
  const [canvasSize, setCanvasSize] = useState({
    w: 1920,
    h: 1080,
  });

  useEffect(() => {
    if (project) {
      setCanvasSize({
        w: project.clip.width,
        h: project.clip.height,
      });
    }
  }, [project]);

  // ── Drop handler ──
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("video/")) {
        const proj = await engine.loadClip(file);
        useProjectStore.getState().setProject(proj);
      }
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  if (!project) {
    return (
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="rounded-2xl border-2 border-dashed border-gray-600 p-16 text-center">
          <p className="text-lg text-gray-400">
            Drop a video file here
          </p>
          <p className="mt-2 text-sm text-gray-600">
            or use the Import button in the toolbar
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center bg-black"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="max-h-full max-w-full cursor-crosshair"
        onClick={handleCanvasClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-900 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
