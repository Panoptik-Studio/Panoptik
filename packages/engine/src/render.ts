/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.3 + 2.1.
 * getCameraTransform (sequential fold, ignores staged points) + renderFrame
 * composition pipeline (background → letterboxed zoomed frame → facecam PiP →
 * text overlays → captions; staged text/captions drawn amber #f59e0b).
 * Keyframe semantics: at k.t ease FROM current state TO k.to over k.dur, then hold.
 */
import { EASINGS, easeInOutCubic, lerp } from "@panoptik/utils";
import type {
  Background,
  Facecam,
  Project,
  Segment,
  ZoomPoint,
} from "@panoptik/schema";
import { frameRect } from "./layout";
import { resolveSegment } from "./timeline";

export type Transform = { scale: number; x: number; y: number };
export const IDENTITY: Transform = { scale: 1, x: 0.5, y: 0.5 };

export function getCameraTransform(points: ZoomPoint[], t: number): Transform {
  // Non-compounding, windowed: each zoom is independent from 1×.
  // For k at k.t with k.dur (zoom-in/out time) and k.hold (stay zoomed):
  //   [k.t, k.t+k.dur)              → ease 1× → k.to
  //   [k.t+k.dur, k.t+k.dur+k.hold)  → hold at k.to
  //   [k.t+k.dur+k.hold, k.t+2*k.dur+k.hold) → ease k.to → 1×
  // If windows overlap, the latest k wins — no stacking on previous scale.
  const active = points.filter((p) => !p.staged);
  // Find the latest starting zoom whose window contains t
  let chosen: ZoomPoint | null = null;
  for (const k of active) {
    const dur = Math.max(k.dur, 0.001);
    const hold = k.hold ?? 2.0;
    const outEnd = k.t + dur * 2 + hold;
    if (t >= k.t && t < outEnd) {
      if (!chosen || k.t > chosen.t) chosen = k;
    }
  }
  if (!chosen) return IDENTITY;
  const dur = Math.max(chosen.dur, 0.001);
  const hold = chosen.hold ?? 2.0;
  const inEnd = chosen.t + dur;
  const holdEnd = inEnd + hold;
  const outEnd = holdEnd + dur;
  const ease = EASINGS[chosen.ease] ?? easeInOutCubic;
  if (t < inEnd) {
    const p = (t - chosen.t) / dur;
    const e = ease(Math.min(1, p));
    return {
      scale: lerp(IDENTITY.scale, chosen.to.scale, e),
      x: lerp(IDENTITY.x, chosen.to.x, e),
      y: lerp(IDENTITY.y, chosen.to.y, e),
    };
  }
  if (t < holdEnd) return chosen.to;
  // ease out
  const p = (t - holdEnd) / dur;
  const e = ease(Math.min(1, p));
  return {
    scale: lerp(chosen.to.scale, IDENTITY.scale, e),
    x: lerp(chosen.to.x, IDENTITY.x, e),
    y: lerp(chosen.to.y, IDENTITY.y, e),
  };
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

// Screen debug — enable via localStorage.setItem("panoptik:debugScreen","1")
let screenRenderFrames = 0;
let screenRenderLastLog = 0;
let screenRenderNoFrame = 0;

export function getCurrentFrame(): CanvasImageSource | null {
  return currentFrame;
}

/**
 * 5-layer synchronous composition. Preview and export share this exact codepath.
 * Layer order: background → frame (zoomed) → facecam PiP → text → captions.
 * `timelineT` is ON-TIMELINE time: it is resolved to the active segment and its
 * source time, falling back to the last segment at media.duration when out of range.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  timelineT: number,
): void {
  const r = resolveSegment(project, timelineT);
  const seg = r?.segment ?? project.segments[project.segments.length - 1];
  const srcT = r ? r.srcT : project.media.duration;
  if (!seg) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  screenRenderFrames++;
  if (typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugScreen") === "1" && performance.now() - screenRenderLastLog > 1000) {
    const isOffscreen = typeof OffscreenCanvas !== "undefined" && ctx.canvas instanceof OffscreenCanvas;
    console.log(`[Screen] renderFrame ${isOffscreen ? "export" : "canvas"}`, { t: timelineT.toFixed(3), seg: seg.id, hasFrame: !!currentFrame, canvas: `${w}x${h}`, draws: screenRenderFrames, noFrame: screenRenderNoFrame });
    screenRenderLastLog = performance.now();
    screenRenderFrames = 0;
    screenRenderNoFrame = 0;
  }
  if (!currentFrame) screenRenderNoFrame++;

  // ── Layer 1: Background ──
  drawBackground(ctx, seg.background, w, h);

  // ── Layer 2: Letterboxed frame with camera zoom (virtual camera, clamped, aspect-aware) ──
  const media = project.media;
  const rect = frameRect(w, h, media, seg.aspectPreset);
  if (currentFrame) {
    const view = cameraViewport(rect, getCameraTransform(seg.zoomPoints, srcT));
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
  drawFacecam(ctx, seg.facecam, srcT, w, h);

  // ── Layer 4: Text overlays ──
  drawTextOverlays(ctx, seg, srcT, w, h);

  // ── Layer 5: Captions ──
  drawCaptions(ctx, seg, srcT, w, h);
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  w: number,
  h: number,
): void {
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
    // blur: stretched + blurred current frame fills the letterbox padding
    if (currentFrame) {
      ctx.save();
      // @ts-ignore — filter is supported in Canvas2D
      ctx.filter = "blur(24px) brightness(0.85)";
      // Cover: scale to fill canvas, centered
      const texW = (currentFrame as { width?: number }).width ?? w;
      const texH = (currentFrame as { height?: number }).height ?? h;
      // Fallback when CanvasImageSource is an OffscreenCanvas without width/height props read differently
      const cw = (currentFrame as HTMLCanvasElement).width || w;
      const ch = (currentFrame as HTMLCanvasElement).height || h;
      const scale = Math.max(w / cw, h / ch);
      const dw = cw * scale;
      const dh = ch * scale;
      ctx.drawImage(currentFrame, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
      // Darken a bit so zooms remain readable
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  t: number,
  w: number,
  h: number,
): void {
  const all = [...seg.textOverlays, ...seg.stagedTextOverlays];
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
  seg: Segment,
  t: number,
  w: number,
  h: number,
): void {
  const all = [...seg.captions, ...seg.stagedCaptions];
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

// Injected by decode.ts. Kept as callbacks because decode.ts already imports
// this module, and importing it back would be circular.
let decodedFacecam: (() => CanvasImageSource | null) | null = null;
let decodedFacecamAspect: (() => number) | null = null;

export function setFacecamFrameSource(
  frame: (() => CanvasImageSource | null) | null,
  aspect: (() => number) | null,
): void {
  decodedFacecam = frame;
  decodedFacecamAspect = aspect;
}
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
  fc: Facecam,
  t: number,
  canvasW: number,
  canvasH: number,
): void {
  if (!fc.src) return;

  // Prefer the decoded camera frame. It is stepped in lockstep with the clip,
  // so it stays in sync; the <video> fallback below only exists for projects
  // reloaded from storage, where we hold a URL but never saw the blob.
  let source: CanvasImageSource | null = decodedFacecam?.() ?? null;
  let aspect = source ? decodedFacecamAspect?.() ?? 16 / 9 : 16 / 9;

  if (!source) {
    const video = getFacecamVideo(fc.src);
    if (!video) return;
    try {
      const dur = video.duration;
      const target = Number.isFinite(dur) && dur > 0 ? Math.min(t, dur - 1e-3) : t;
      // Assigning currentTime starts an async seek, so this frame may be a
      // little behind. Acceptable for the fallback; the decoded path is exact.
      if (!video.seeking && Math.abs(video.currentTime - target) > 0.05) {
        video.currentTime = target;
      }
    } catch { /* ignore seek errors */ }
    if (video.readyState < 2) return;
    source = video;
    aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  }

  const pipW = Math.round(canvasW * fc.size);
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
    ctx.drawImage(source, clampedX, clampedY, pipW, pipH);
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
