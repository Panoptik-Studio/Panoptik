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
// Debug throttling — logs once per second when enabled via localStorage
const FACECAM_DEBUG = typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugFacecam") === "1";
let facecamStats = { frames: 0, draws: 0, skipsReady: 0, seeks: 0, lastLog: 0 };
let lastFacecamT = 0;

function getFacecamVideo(src: string): HTMLVideoElement | null {
  if (typeof document === "undefined") return null;
  const cached = facecamCache.get(src);
  if (cached) return cached;
  const v = document.createElement("video");
  v.muted = true;
  (v as unknown as { playsInline: boolean }).playsInline = true;
  v.preload = "auto";
  // No crossOrigin: the source is a same-origin blob: URL, and setting it puts
  // the element into a CORS fetch that a blob URL does not answer.
  v.src = src;
  // Chrome will not reliably decode a detached element, and we only ever read
  // it through drawImage — so park it in the document, invisible and inert.
  v.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  v.setAttribute("aria-hidden", "true");
  try {
    document.body.appendChild(v);
  } catch { /* no body yet — the element still loads */ }
  try { v.load(); } catch { /* ignore */ }
  // Muted autoplay is permitted and forces a decoded first frame; we pause
  // immediately because the timeline, not the element, drives playback.
  v.play().then(() => v.pause()).catch(() => { /* seeking still works */ });
  facecamCache.set(src, v);
  return v;
}

/** Drop cached facecam elements — call when the project's recording changes. */
export function clearFacecamCache(): void {
  for (const v of facecamCache.values()) {
    try {
      v.pause();
      v.removeAttribute("src");
      v.load();
      v.remove();
    } catch { /* already gone */ }
  }
  facecamCache.clear();
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
  facecamStats.frames++;
  // Detect playback vs scrub/pause: small dt (~1/60) → playing, else seeking.
  const dt = t - lastFacecamT;
  const isPlaying = Math.abs(dt) > 0.001 && Math.abs(dt) < 0.3;
  lastFacecamT = t;

  // During playback, let the video play at 1x and only re-sync on large drift.
  // Seeking every frame (0.05 threshold) caused 94% skips: each seek drops
  // readyState to 1 for ~300ms → blank → flicker.
  if (isPlaying) {
    if (video.paused) video.play().catch(() => {});
    // Only seek if drift is large (e.g. timeline jump or scrub)
    if (!video.seeking && Math.abs(video.currentTime - t) > 0.5) {
      try {
        const dur = video.duration;
        const target = Number.isFinite(dur) && dur > 0 ? Math.min(t, dur - 1e-3) : t;
        video.currentTime = target;
        facecamStats.seeks++;
      } catch { /* ignore */ }
    }
  } else {
    // Paused / scrubbing: precise seek to t, pause the element
    if (!video.paused) video.pause();
    try {
      const dur = video.duration;
      const target = Number.isFinite(dur) && dur > 0 ? Math.min(t, dur - 1e-3) : t;
      if (Math.abs(video.currentTime - target) > 0.05) {
        video.currentTime = target;
        facecamStats.seeks++;
      }
    } catch { /* ignore */ }
    if (video.readyState < 2) {
      facecamStats.skipsReady++;
      if (FACECAM_DEBUG && performance.now() - facecamStats.lastLog > 1000) {
        console.log("[Facecam] skip readyState (paused)", { readyState: video.readyState, seeking: video.seeking, currentTime: video.currentTime.toFixed(2), t: t.toFixed(2), duration: video.duration });
        facecamStats.lastLog = performance.now();
      }
      return;
    }
  }
  // For playing, draw even if readyState is 1 — we have a frame to show (old), don't blank
  if (video.readyState < 1) {
    facecamStats.skipsReady++;
    return;
  }

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
    facecamStats.draws++;
    if (FACECAM_DEBUG && performance.now() - facecamStats.lastLog > 1000) {
      console.log("[Facecam] draw", { draws: facecamStats.draws, seeks: facecamStats.seeks, skips: facecamStats.skipsReady, frames: facecamStats.frames, readyState: video.readyState, seeking: video.seeking, currentTime: video.currentTime.toFixed(2), t: t.toFixed(2), pip: `${pipW}x${pipH}@${clampedX},${clampedY}`, cache: facecamCache.size });
      facecamStats.lastLog = performance.now();
      facecamStats.frames = facecamStats.draws = facecamStats.skipsReady = facecamStats.seeks = 0;
    }
  } catch (e) {
    if (FACECAM_DEBUG) console.warn("[Facecam] drawImage failed", e);
  }
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
