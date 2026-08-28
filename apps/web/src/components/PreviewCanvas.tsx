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
  cameraViewport,
  canvasToFrame,
  frameRect,
  frameToCanvas,
  getCameraTransform,
  outputSize,
} from "@panoptik/engine";
import type { Project, ZoomPoint } from "@panoptik/schema";

/** Preview compositing cap — matches the decode cap in the engine. */
const MAX_CANVAS_WIDTH = 1920;
/** Seconds either side of the playhead where a zoom's focal handle is editable. */
const MARKER_WINDOW = 2;
/** Depth a click-to-add zoom starts at. */
const DEFAULT_ZOOM_SCALE = 2.2;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Everything needed to place a focal handle: the letterboxed frame, the camera
 * resolved at `t`, and the marker radius. All in canvas backing pixels, which is
 * the space renderFrame draws in.
 */
function canvasGeometry(
  canvas: HTMLCanvasElement,
  project: Project,
  t: number,
) {
  const rect = frameRect(
    canvas.width,
    canvas.height,
    project.clip.width,
    project.clip.height,
    project.aspectPreset,
  );
  const view = cameraViewport(rect, getCameraTransform(project.zoomPoints, t));
  return { rect, view, radius: Math.max(10, rect.w * 0.014) };
}

/** Pointer position in canvas backing pixels. */
function pointerToCanvas(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((clientX - box.left) / box.width) * canvas.width,
    y: ((clientY - box.top) / box.height) * canvas.height,
  };
}

/** Zooms whose handle is on screen: near the playhead, plus the selected one. */
function editableZooms(project: Project, t: number, selectedId: string | null): ZoomPoint[] {
  return [...project.zoomPoints, ...project.stagedZoomPoints].filter(
    (z) => z.id === selectedId || Math.abs(z.t - t) <= MARKER_WINDOW,
  );
}

/** The zoom handle under a canvas-space point, topmost (latest) first. */
function hitTestHandle(
  canvas: HTMLCanvasElement,
  project: Project,
  t: number,
  selectedId: string | null,
  px: number,
  py: number,
): ZoomPoint | null {
  const { rect, view, radius } = canvasGeometry(canvas, project, t);
  const grab = radius * 1.8;
  const candidates = editableZooms(project, t, selectedId);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const z = candidates[i]!;
    const p = frameToCanvas(rect, view, z.to.x * rect.w, z.to.y * rect.h);
    if (Math.hypot(px - p.x, py - p.y) <= grab) return z;
  }
  return null;
}

/**
 * Focal handles, drawn on top of the composed frame. Editor-only chrome — it
 * lives here rather than in the engine so exports stay clean.
 */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  selectedId: string | null,
  draggingId: string | null,
): void {
  const { rect, view, radius } = canvasGeometry(ctx.canvas, project, t);
  ctx.save();
  for (const z of editableZooms(project, t, selectedId)) {
    const p = frameToCanvas(rect, view, z.to.x * rect.w, z.to.y * rect.h);
    const active = z.id === selectedId || z.id === draggingId;
    const color = z.staged ? "#f5a623" : "#0070f3";
    const r = active ? radius * 1.2 : radius;
    // Fade handles whose keyframe is further from the playhead.
    ctx.globalAlpha = active ? 1 : Math.max(0.35, 1 - Math.abs(z.t - t) / MARKER_WINDOW);

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = Math.max(4, r * 0.34);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5, r * 0.16), 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    if (active) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.75, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.globalAlpha = 0.5;
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Selectors only — a full-store subscription would re-render this component
  // on every currentTime tick during playback.
  const project = useProjectStore((s) => s.project);
  const stagePadding = useProjectStore((s) => s.stagePadding);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const currentTime = useProjectStore((s) => s.currentTime);
  const addZoomPoint = useProjectStore((s) => s.addZoomPoint);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const commitDrag = useProjectStore((s) => s.commitDrag);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  // Dragging state — `moved` separates a click-to-select from a real drag.
  const [dragging, setDragging] = useState<{
    id: string;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  // The rAF loop is built once per clip, so it reads the drag through a ref.
  const draggingIdRef = useRef<string | null>(null);
  draggingIdRef.current = dragging?.id ?? null;

  // Toast state (moment mark feedback)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

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

      // An export drives the same decoder frame by frame. Requesting preview
      // frames alongside it would move the decode target out from under the
      // encoder and put the wrong pictures in the file.
      if (state.exportProgress !== null) return;

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

      // Don't contend with export's pump — it drives desiredTime at 30fps
      const isExporting = typeof window !== "undefined" && (window as unknown as { __isExporting?: boolean }).__isExporting;
      if (!isExporting && t !== requestedTime) {
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
      // Editor chrome on top of the composed frame — hidden during playback so
      // the preview shows exactly what an export would.
      if (!state.isPlaying) {
        drawHandles(ctx, state.project, t, state.selectedZoomId, draggingIdRef.current);
      }
    };

    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      unsubscribe();
      cancelAnimationFrame(rafRef.current);
    };
  }, [hasProject]);

  // ── Preview audio — sync HTMLAudioElement to canvas time (hidden, no controls) ──
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !project) return;
    // A recording's audio is in a different file than its video: the screen is
    // captured silently and the mic rides with the camera take.
    const src = project.audioSrc ?? project.clip.src;
    if (audio.src !== src) {
      audio.src = src;
      audio.load();
    }
  }, [project?.audioSrc, project?.clip.src]);

  // Scrubbing while paused: follow the playhead.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !project || isPlaying) return;
    if (Math.abs(audio.currentTime - currentTime) > 0.15) audio.currentTime = currentTime;
  }, [currentTime, isPlaying, project]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isPlaying) {
      audio.pause();
      return;
    }

    // Line the element up with the playhead *before* starting. Pressing play
    // without this resumes from wherever the element happened to be left — and
    // if that was the end of the clip, it plays nothing at all, which is why
    // sound came and went between takes of play/pause.
    const target = useProjectStore.getState().currentTime;
    if (Math.abs(audio.currentTime - target) > 0.15) audio.currentTime = target;
    audio.play().catch(() => {});

    // The canvas runs off rAF and the audio off its own clock, so they drift
    // apart over a long clip unless they are pulled back together.
    const id = window.setInterval(() => {
      const now = useProjectStore.getState().currentTime;
      if (!audio.paused && Math.abs(audio.currentTime - now) > 0.3) {
        audio.currentTime = now;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying]);

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

  // A pending toast timer would call setToast after unmount.
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // ── Click → add a zoom at the playhead (or select the handle under the cursor) ──
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // A click always follows the pointerup that ended a drag — without this the
      // drag would also spawn a zoom point.
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const state = useProjectStore.getState();
      if (!state.project || state.isPlaying || state.exportProgress !== null) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
      const t = state.currentTime;

      const hit = hitTestHandle(canvas, state.project, t, state.selectedZoomId, px, py);
      if (hit) {
        setSelectedZoom(hit.id);
        return;
      }

      const { rect, view } = canvasGeometry(canvas, state.project, t);
      const f = canvasToFrame(rect, view, px, py);
      addZoomPoint({
        t,
        to: {
          scale: DEFAULT_ZOOM_SCALE,
          x: clamp01(f.x / rect.w),
          y: clamp01(f.y / rect.h),
        },
        dur: 0.7,
        hold: 2.0,
        ease: "easeInOutCubic",
      });
    },
    [addZoomPoint, setSelectedZoom],
  );

  // ── Facecam PiP dragging ──
  const [draggingFacecam, setDraggingFacecam] = useState(false);
  const facecamDragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const setFacecam = useProjectStore((s) => s.setFacecam);

  // ── Focal handle dragging ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const state = useProjectStore.getState();
      if (!state.project || state.isPlaying || state.exportProgress !== null) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);

      // Facecam hit test first — PiP is in screen space (full canvas), never zoomed
      const fc = state.project.facecam;
      if (fc.src) {
        const cw = canvas.width;
        const ch = canvas.height;
        const pipW = cw * fc.size;
        const pipH = pipW / (16 / 9);
        const fx = cw * fc.x;
        const fy = ch * fc.y;
        if (px >= fx && px <= fx + pipW && py >= fy && py <= fy + pipH) {
          e.preventDefault();
          canvas.setPointerCapture(e.pointerId);
          facecamDragOffset.current = { dx: px - fx, dy: py - fy };
          setDraggingFacecam(true);
          return;
        }
      }

      const hit = hitTestHandle(
        canvas,
        state.project,
        state.currentTime,
        state.selectedZoomId,
        px,
        py,
      );
      if (!hit) return;

      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      setSelectedZoom(hit.id);
      setDragging({ id: hit.id, moved: false });
    },
    [setSelectedZoom],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const state = useProjectStore.getState();
      if (!state.project) return;

      // Facecam drag — screen space, clamped to canvas edges
      if (draggingFacecam) {
        const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
        const cw = canvas.width;
        const ch = canvas.height;
        const fc = state.project.facecam;
        const pipW = cw * fc.size;
        const pipH = pipW / (16 / 9);
        const off = facecamDragOffset.current;
        if (!off) return;
        const fx = px - off.dx;
        const fy = py - off.dy;
        const clampedX = Math.max(0, Math.min(cw - pipW, fx));
        const clampedY = Math.max(0, Math.min(ch - pipH, fy));
        setFacecam({ x: clampedX / cw, y: clampedY / ch });
        return;
      }

      if (!dragging) {
        // Hover affordance: facecam grab beats zoom grab beats crosshair
        if (!state.isPlaying) {
          const { x: hx, y: hy } = pointerToCanvas(canvas, e.clientX, e.clientY);
          const fc = state.project.facecam;
          if (fc.src) {
            const cw = canvas.width;
            const ch = canvas.height;
            const pipW = cw * fc.size;
            const pipH = pipW / (16 / 9);
            const fx = cw * fc.x;
            const fy = ch * fc.y;
            if (hx >= fx && hx <= fx + pipW && hy >= fy && hy <= fy + pipH) {
              canvas.style.cursor = "grab";
              return;
            }
          }
          const over = hitTestHandle(
            canvas,
            state.project,
            state.currentTime,
            state.selectedZoomId,
            hx,
            hy,
          );
          canvas.style.cursor = over ? "grab" : "crosshair";
        }
        return;
      }

      const zoom =
        state.project.zoomPoints.find((z) => z.id === dragging.id) ??
        state.project.stagedZoomPoints.find((z) => z.id === dragging.id);
      if (!zoom) return;

      const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
      const { rect, view } = canvasGeometry(canvas, state.project, state.currentTime);
      const f = canvasToFrame(rect, view, px, py);
      // Keep the zoom's own depth — only the focal point moves.
      updateZoomPoint(dragging.id, {
        to: {
          scale: zoom.to.scale,
          x: clamp01(f.x / rect.w),
          y: clamp01(f.y / rect.h),
        },
      });
      if (!dragging.moved) setDragging({ ...dragging, moved: true });
    },
    [dragging, draggingFacecam, updateZoomPoint, setFacecam],
  );

  const handlePointerUp = useCallback(() => {
    if (draggingFacecam) {
      setDraggingFacecam(false);
      facecamDragOffset.current = null;
      commitDrag();
      suppressClickRef.current = true;
    }
    if (dragging) {
      if (dragging.moved) {
        commitDrag();
        suppressClickRef.current = true;
      }
      setDragging(null);
    }
  }, [dragging, draggingFacecam, commitDrag]);

  // ── Canvas sizing ──
  const [canvasSize, setCanvasSize] = useState({
    w: 1920,
    h: 1080,
  });

  useEffect(() => {
    if (!project) return;
    // Shared with the exporter so the preview is the same frame the encoder gets.
    const size = outputSize(project.clip.width, project.clip.height, project.aspectPreset, MAX_CANVAS_WIDTH);
    setCanvasSize({ w: size.width, h: size.height });
  }, [project?.clip.width, project?.clip.height, project?.aspectPreset]);

  // ── Drop + click-to-import ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
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
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleFilePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      const proj = await engine.loadClip(file);
      useProjectStore.getState().setProject(proj);
    }
    // reset so same file can be picked again
    e.target.value = "";
  }, []);

  if (!project) {
    return (
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center p-8 bg-vercel-mesh"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFilePick} />
        <div
          className="pk-card relative flex w-full max-w-[520px] flex-col items-center px-10 py-12 text-center transition-all"
          style={{
            borderColor: isDragOver ? "#0070f3" : "#ebebeb",
            borderStyle: isDragOver ? "solid" : "dashed",
            borderWidth: 2,
            transform: isDragOver ? "scale(1.01)" : undefined,
            boxShadow: isDragOver
              ? "0 12px 40px rgba(0,112,243,0.16)"
              : "0 2px 12px rgba(0,0,0,0.04)",
          }}
        >
          {/* Soft halo, echoing the homepage hero. */}
          <div
            className="pointer-events-none absolute -top-20 left-1/2 h-44 w-[420px] -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: "linear-gradient(90deg, #007cf0 0%, #7928ca 45%, #ff0080 85%)", opacity: isDragOver ? 0.16 : 0.07 }}
          />

          <div
            className="mb-6 flex h-14 w-14 items-center justify-center rounded-[16px] transition-colors"
            style={{ background: isDragOver ? "#0070f3" : "#1f1f1f", color: "#fff" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          <h3 className="pk-ui" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25, color: "#1a1a1a" }}>
            Drop a video to <span className="pk-accent">begin</span>
          </h3>
          <p className="pk-help mt-2.5 max-w-[38ch]" style={{ fontSize: 14, lineHeight: 1.55 }}>
            MP4, WebM or MOV. Everything renders in your browser — no upload, no server.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <button onClick={() => fileInputRef.current?.click()} className="pk-btn pk-btn-primary pk-btn-lg">
              <span className="flex h-5 w-5 items-center justify-center rounded-md text-[15px] leading-none" style={{ background: "rgba(255,255,255,0.16)" }}>+</span>
              Browse video
            </button>
            <button onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))} className="pk-btn pk-btn-ghost pk-btn-lg">
              <span className="h-2 w-2 rounded-full" style={{ background: "#e11d48" }} />
              Record instead
            </button>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-1.5">
            <span className="pk-chip">MP4</span>
            <span className="pk-chip">WebM</span>
            <span className="pk-chip">MOV</span>
            <span className="pk-chip" style={{ background: "transparent", borderColor: "transparent" }}>up to 4K</span>
          </div>
        </div>
      </div>
    );
  }

  const stageStyle = (() => {
    if (!project) return {};
    if (project.background.kind === "gradient") {
      const [a, b] = project.background.stops;
      return { background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` };
    }
    if (project.background.kind === "solid") return { background: project.background.color };
    return { background: "linear-gradient(135deg, #007cf0 0%, #7928ca 45%, #ff4d4d 100%)" };
  })();

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center p-6 bg-[#fafafa]"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Vercel mesh halo behind stage */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ background: "radial-gradient(700px 420px at 50% 38%, rgba(0,124,240,0.18) 0%, transparent 60%), radial-gradient(560px 360px at 82% 78%, rgba(255,0,128,0.12) 0%, transparent 62%)" }} />
      {/* Stage frame stays constant — padding shrinks the video inside, not the frame; stage locks to clip aspect so no crop/letterbox drift across viewports */}
      <div className="relative flex max-h-[56vh] max-w-[64vw] items-center justify-center overflow-hidden rounded-xl border bg-white shadow-vercel-4 lg:max-h-[62vh]" style={{ borderColor: "#ebebeb", padding: stagePadding, aspectRatio: project ? `${project.clip.width} / ${project.clip.height}` : undefined, width: project ? `min(64vw, calc(62vh * ${project.clip.width / project.clip.height}))` as unknown as string : undefined, ...stageStyle }}>
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black shadow-[0_12px_32px_rgba(0,0,0,0.18)] ring-1 ring-black/10">
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            className="block h-full w-full cursor-crosshair object-contain"
            onClick={handleCanvasClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </div>
      </div>
      {/* Hidden audio for preview — same blob URL as video, synced to canvas time */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="auto" className="hidden" crossOrigin="anonymous" />
      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border bg-[#171717] px-3.5 py-1.5 text-xs font-medium text-white shadow-vercel-5" style={{ borderColor: "#2a2a2a" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
