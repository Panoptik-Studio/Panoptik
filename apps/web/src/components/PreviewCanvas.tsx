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

/** Preview compositing cap — matches the decode cap in the engine. */
const MAX_CANVAS_WIDTH = 1920;

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

  // Selectors only — a full-store subscription would re-render this component
  // on every currentTime tick during playback.
  const project = useProjectStore((s) => s.project);
  const addZoomPoint = useProjectStore((s) => s.addZoomPoint);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const commitDrag = useProjectStore((s) => s.commitDrag);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

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
  // In CSS pixels, matching the space that clientX/clientY arrive in — the
  // canvas backing store is a different size than its on-screen box.
  const getFrameRect = useCallback((): FrameRect | null => {
    const canvas = canvasRef.current;
    if (!canvas || !project) return null;
    const box = canvas.getBoundingClientRect();
    return computeFrameRect(
      box.width,
      box.height,
      project.clip.width,
      project.clip.height,
      project.aspectPreset,
    );
  }, [project]);

  // ── Render loop ──
  // Keyed on whether a clip exists, not on project identity: the loop reads
  // fresh state every tick, so rebuilding it on each edit only churns the rAF.
  const hasProject = project !== null;
  useEffect(() => {
    if (!hasProject || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    let disposed = false;
    // Any store write (edit, seek, playhead tick) or a newly decoded frame
    // means the composite is stale. Idle ticks skip drawing entirely.
    let dirty = true;
    let requestedTime = NaN;
    let decodePending = false;
    const markDirty = () => {
      dirty = true;
    };
    const unsubscribe = useProjectStore.subscribe(markDirty);

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = now;

      const state = useProjectStore.getState();
      if (!state.project) return;

      if (state.isPlaying) {
        const newTime = state.currentTime + dt;
        if (newTime >= state.project.clip.duration) {
          state.pause();
          state.setCurrentTime(state.project.clip.duration);
        } else {
          state.setCurrentTime(newTime);
        }
      } else if (!dirty) {
        return;
      }

      dirty = false;
      const t = useProjectStore.getState().currentTime;

      // Only ask for a decode when the playhead actually moved, so an idle
      // preview settles instead of re-arming itself every frame.
      if (t !== requestedTime) {
        requestedTime = t;
        // Coalesced inside the engine — repeat calls only move the decode target.
        const pending = engine.prepareFrame(t);
        // One handler per in-flight decode; during playback the engine hands
        // back the same promise every tick and these would otherwise pile up.
        if (!decodePending) {
          decodePending = true;
          pending.then(
            () => {
              decodePending = false;
              if (!disposed) markDirty();
            },
            (err) => {
              decodePending = false;
              console.error("decode failed", err);
            },
          );
        }
      }
      engine.renderFrame(ctx, state.project, t);
    };

    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      unsubscribe();
      cancelAnimationFrame(rafRef.current);
    };
  }, [hasProject]);

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
      // Space → play/pause (when not typing in an input)
      if (e.key === " " && !mod && !e.altKey && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        useProjectStore.getState().togglePlay();
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
    if (!project) return;
    const scale = Math.min(1, MAX_CANVAS_WIDTH / project.clip.width);
    setCanvasSize({
      w: Math.round(project.clip.width * scale),
      h: Math.round(project.clip.height * scale),
    });
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
