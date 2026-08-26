/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.3 + 2.1.
 * getCameraTransform (sequential fold, ignores staged points) + renderFrame
 * composition pipeline (background → letterboxed zoomed frame → facecam PiP →
 * text overlays → captions; staged text/captions drawn amber #f59e0b).
 * Keyframe semantics: at k.t ease FROM current state TO k.to over k.dur, then hold.
 */
import { EASINGS, easeInOutCubic, lerp } from "@panoptik/utils";
import type { Project, ZoomPoint } from "@panoptik/schema";
import { frameRect } from "./layout";

export type Transform = { scale: number; x: number; y: number };
export const IDENTITY: Transform = { scale: 1, x: 0.5, y: 0.5 };

export function getCameraTransform(points: ZoomPoint[], t: number): Transform {
  // Pure, timestamp-based, no allocations in hot path beyond filter/sort (points are small).
  // Sequential fold: each keyframe eases from previous state → k.to over k.dur, then holds.
  // This naturally glides between consecutive zooms without snapping to 1x.
  let state = IDENTITY;
  // Filter staged and sort once — zoomPoints are typically <20, so sort is cheap.
  // Avoid extra spread by filtering then sorting in place.
  const active = points.filter((p) => !p.staged);
  active.sort((a, b) => a.t - b.t);
  for (const k of active) {
    if (k.t > t) break;
    const progress = Math.min(1, (t - k.t) / Math.max(k.dur, 0.001));
    const eased = (EASINGS[k.ease] ?? easeInOutCubic)(progress);
    state = {
      scale: lerp(state.scale, k.to.scale, eased),
      x: lerp(state.x, k.to.x, eased),
      y: lerp(state.y, k.to.y, eased),
    };
  }
  return state;
}

// Alias for spec naming — same deterministic function
export const getCameraStateAtTime = getCameraTransform;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export type Viewport = {
  /** Magnification actually applied, never below 1. */
  scale: number;
  /** Focal point in FRAME space, clamped so the view never leaves the frame. */
  cx: number;
  cy: number;
};

/**
 * Resolve a camera transform against a frame rect: the focal point lands at the
 * centre of the frame magnified by `scale`, pulled back just far enough that the
 * visible window stays inside the frame (no empty edges).
 */
export function cameraViewport(
  rect: { w: number; h: number },
  cam: Transform,
): Viewport {
  const scale = Math.max(1, cam.scale);
  const viewW = rect.w / scale;
  const viewH = rect.h / scale;
  return {
    scale,
    cx: clamp(cam.x * rect.w, viewW / 2, rect.w - viewW / 2),
    cy: clamp(cam.y * rect.h, viewH / 2, rect.h - viewH / 2),
  };
}

/** Frame-space point → canvas x, under the camera. Inverse of {@link canvasToFrame}. */
export function frameToCanvas(
  rect: { x: number; y: number; w: number; h: number },
  view: Viewport,
  fx: number,
  fy: number,
): { x: number; y: number } {
  return {
    x: rect.x + rect.w / 2 + (fx - view.cx) * view.scale,
    y: rect.y + rect.h / 2 + (fy - view.cy) * view.scale,
  };
}

/** Canvas point → frame-space, under the camera. Inverse of {@link frameToCanvas}. */
export function canvasToFrame(
  rect: { x: number; y: number; w: number; h: number },
  view: Viewport,
  px: number,
  py: number,
): { x: number; y: number } {
  return {
    x: view.cx + (px - rect.x - rect.w / 2) / view.scale,
    y: view.cy + (py - rect.y - rect.h / 2) / view.scale,
  };
}

// ── Decoded frame cache (set by decode.ts via setCurrentFrame) ──
let currentFrame: CanvasImageSource | null = null;

export function setCurrentFrame(frame: CanvasImageSource | null) {
  currentFrame = frame;
}

export function getCurrentFrame(): CanvasImageSource | null {
  return currentFrame;
}

/**
 * 5-layer synchronous composition. Preview and export share this exact codepath.
 * Layer order: background → frame (zoomed) → facecam PiP → text → captions.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // ── Layer 1: Background ──
  drawBackground(ctx, project, w, h);

  // ── Layer 2: Letterboxed frame with camera zoom (virtual camera, clamped, aspect-aware) ──
  const rect = frameRect(w, h, project.clip.width, project.clip.height, project.aspectPreset);
  if (currentFrame) {
    const view = cameraViewport(rect, getCameraTransform(project.zoomPoints, t));
    ctx.save();
    // Clip first: at a non-native aspect preset the magnified frame would
    // otherwise spill out of the letterbox and cover the background.
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    // Put the focal point at the centre of the frame, magnified by scale.
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale(view.scale, view.scale);
    ctx.translate(-(rect.x + view.cx), -(rect.y + view.cy));
    ctx.drawImage(currentFrame, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  } else {
    // No decoded frame yet — draw a dark placeholder inside the frame rect
    ctx.fillStyle = "#000";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // ── Layer 3: Facecam PiP (screen space, never zoomed) ──
  drawFacecam(ctx, project, t, w, h);

  // ── Layer 4: Text overlays ──
  drawTextOverlays(ctx, project, t, w, h);

  // ── Layer 5: Captions ──
  drawCaptions(ctx, project, t, w, h);
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  project: Project,
  w: number,
  h: number,
): void {
  const bg = project.background;
  if (bg.kind === "solid") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.kind === "gradient") {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, bg.stops[0]);
    g.addColorStop(1, bg.stops[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    // blur — solid dark for now (real blur needs decoded frame)
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, w, h);
  }
}

function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  w: number,
  h: number,
): void {
  const all = [...project.textOverlays, ...project.stagedTextOverlays];
  for (const to of all) {
    if (t >= to.timestamp && t <= to.timestamp + 3) {
      ctx.fillStyle = to.staged ? "#f59e0b" : "#ffffff";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      const y = to.position === "top" ? 60 : to.position === "bottom" ? h - 60 : h / 2;
      ctx.fillText(to.text, w / 2, y);
    }
  }
}

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  w: number,
  h: number,
): void {
  const all = [...project.captions, ...project.stagedCaptions];
  for (const c of all) {
    if (t >= c.start && t <= c.end) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(c.text, w / 2, h - 40);
    }
  }
}

// ── Facecam PiP ──────────────────────────────────────────────────────────────
// Private Map<url, HTMLVideoElement>; lazy <video muted playsinline>; seek
// currentTime = t % duration pre-draw; rounded-corner PiP at facecam.x/y/size
// in screen space (never zoomed). Spec.md: x/y = top-left 0-1, size = 0-1 of canvas width.
const facecamCache = new Map<string, HTMLVideoElement>();

function getFacecamVideo(src: string): HTMLVideoElement | null {
  if (typeof document === "undefined") return null;
  const cached = facecamCache.get(src);
  if (cached) return cached;
  const v = document.createElement("video");
  v.src = src;
  v.muted = true;
  (v as unknown as { playsInline: boolean }).playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  // Do not autoplay; we manually seek. Keep element off-DOM — still decodable.
  try { v.load(); } catch { /* ignore */ }
  facecamCache.set(src, v);
  return v;
}

function drawFacecam(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  canvasW: number,
  canvasH: number,
): void {
  const fc = project.facecam;
  if (!fc.src) return;
  const video = getFacecamVideo(fc.src);
  if (!video) return;
  // Need at least HAVE_CURRENT_DATA to show a frame
  if (video.readyState < 2) return;
  // Follow the timeline. Past the camera track's end we hold its last frame —
  // wrapping would replay the take's opening over its ending.
  try {
    const dur = video.duration;
    if (isFinite(dur) && dur > 0) {
      const target = Math.min(t, dur - 1e-3);
      // Only seek if far enough to avoid thrashing (16ms ~ 1 frame)
      if (Math.abs(video.currentTime - target) > 0.05) {
        video.currentTime = target;
      }
    }
  } catch { /* ignore seek errors */ }
  if (video.readyState < 2) return;

  const pipW = Math.round(canvasW * fc.size);
  // Preserve ~16:9; fallback to square if no video dimensions yet
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  const pipH = Math.round(pipW / aspect);
  const x = Math.round(canvasW * fc.x);
  const y = Math.round(canvasH * fc.y);
  // Clamp inside canvas
  const clampedX = clamp(x, 0, Math.max(0, canvasW - pipW));
  const clampedY = clamp(y, 0, Math.max(0, canvasH - pipH));

  const shape = (fc as { shape?: string }).shape === "circle" ? "circle" : "square";
  const radius = shape === "circle" ? Math.min(pipW, pipH) / 2 : 12;
  ctx.save();
  // Rounded rect / circle clip — matches preview PiP (circle 50% vs square 12px)
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(clampedX + pipW / 2, clampedY + pipH / 2, Math.min(pipW, pipH) / 2, 0, Math.PI * 2);
  } else if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
    (ctx as unknown as { roundRect: (x:number,y:number,w:number,h:number,r:number)=>void }).roundRect(clampedX, clampedY, pipW, pipH, radius);
  } else {
    const r = Math.min(radius, pipW / 2, pipH / 2);
    ctx.moveTo(clampedX + r, clampedY);
    ctx.arcTo(clampedX + pipW, clampedY, clampedX + pipW, clampedY + pipH, r);
    ctx.arcTo(clampedX + pipW, clampedY + pipH, clampedX, clampedY + pipH, r);
    ctx.arcTo(clampedX, clampedY + pipH, clampedX, clampedY, r);
    ctx.arcTo(clampedX, clampedY, clampedX + pipW, clampedY, r);
    ctx.closePath();
  }
  ctx.clip();
  try {
    ctx.drawImage(video, clampedX, clampedY, pipW, pipH);
  } catch { /* video frame not ready */ }
  ctx.restore();
  // Subtle border — matches clip shape
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(clampedX + pipW / 2, clampedY + pipH / 2, Math.min(pipW, pipH) / 2, 0, Math.PI * 2);
  } else if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
    (ctx as unknown as { roundRect: (x:number,y:number,w:number,h:number,r:number)=>void }).roundRect(clampedX, clampedY, pipW, pipH, radius);
  } else {
    const r = Math.min(radius, pipW / 2, pipH / 2);
    ctx.moveTo(clampedX + r, clampedY);
    ctx.arcTo(clampedX + pipW, clampedY, clampedX + pipW, clampedY + pipH, r);
    ctx.arcTo(clampedX + pipW, clampedY + pipH, clampedX, clampedY + pipH, r);
    ctx.arcTo(clampedX, clampedY + pipH, clampedX, clampedY, r);
    ctx.arcTo(clampedX, clampedY, clampedX + pipW, clampedY, r);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}
