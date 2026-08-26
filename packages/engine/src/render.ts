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
  let state = IDENTITY;
  for (const k of [...points].filter((p) => !p.staged).sort((a, b) => a.t - b.t)) {
    if (k.t > t) break;
    const p = Math.min(1, (t - k.t) / Math.max(k.dur, 0.001));
    const e = (EASINGS[k.ease] ?? easeInOutCubic)(p);
    state = {
      scale: lerp(state.scale, k.to.scale, e),
      x: lerp(state.x, k.to.x, e),
      y: lerp(state.y, k.to.y, e),
    };
  }
  return state;
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

  // ── Layer 2: Letterboxed frame with camera zoom ──
  const rect = frameRect(w, h, project.clip.width, project.clip.height, project.aspectPreset);
  if (currentFrame) {
    const tr = getCameraTransform(project.zoomPoints, t);
    const fx = rect.x + tr.x * rect.w;
    const fy = rect.y + tr.y * rect.h;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(tr.scale, tr.scale);
    ctx.translate(-fx, -fy);
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
  // Seek to time within duration (loop)
  try {
    const dur = video.duration;
    if (isFinite(dur) && dur > 0) {
      const target = t % dur;
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
  const clampedX = Math.min(x, canvasW - pipW);
  const clampedY = Math.min(y, canvasH - pipH);

  const radius = 12;
  ctx.save();
  // Rounded rect clip
  ctx.beginPath();
  if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
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
  // Subtle border
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
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
