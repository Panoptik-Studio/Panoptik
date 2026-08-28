/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.3 + 2.1.
 * getCameraTransform (sequential fold, ignores staged points) + renderFrame
 * composition pipeline (background → letterboxed zoomed frame → facecam PiP →
 * text overlays → captions; staged text/captions drawn amber #f59e0b).
 * Keyframe semantics: at k.t ease FROM current state TO k.to over k.dur, then hold.
 */
import { EASINGS, easeInOutCubic, easeOutCubic, lerp } from "@panoptik/utils";
import type {
  Background,
  Facecam,
  Project,
  Segment,
  ZoomPoint,
} from "@panoptik/schema";
import { frameRect } from "./layout";
import { resolveSegment, segmentDuration } from "./timeline";

export type Transform = { scale: number; x: number; y: number };
export const IDENTITY: Transform = { scale: 1, x: 0.5, y: 0.5 };

function evalZoomPoint(k: ZoomPoint, startState: Transform, tau: number): Transform {
  const dur = Math.max(k.dur, 0.001);
  const hold = k.hold ?? 2.0;
  const inEnd = k.t + dur;
  const holdEnd = inEnd + hold;
  const ease = EASINGS[k.ease] ?? easeInOutCubic;

  if (tau <= k.t) return startState;
  if (tau < inEnd) {
    const p = Math.max(0, Math.min(1, (tau - k.t) / dur));
    const e = ease(p);
    return {
      scale: lerp(startState.scale, k.to.scale, e),
      x: lerp(startState.x, k.to.x, e),
      y: lerp(startState.y, k.to.y, e),
    };
  }
  if (tau < holdEnd) {
    return k.to;
  }
  // ease out towards IDENTITY
  const p = Math.max(0, Math.min(1, (tau - holdEnd) / dur));
  const e = ease(p);
  return {
    scale: lerp(k.to.scale, IDENTITY.scale, e),
    x: lerp(k.to.x, IDENTITY.x, e),
    y: lerp(k.to.y, IDENTITY.y, e),
  };
}

export function getCameraTransform(points: ZoomPoint[], t: number): Transform {
  const active = points
    .filter((p) => !p.staged)
    .slice()
    .sort((a, b) => a.t - b.t);

  if (active.length === 0) return IDENTITY;

  // Compute the seamless starting transform for each active keyframe
  // (if keyframe k_i starts while k_{i-1} is still active in its zone, k_i starts from k_{i-1}'s state)
  const startStates: Transform[] = [];
  const outEnds: number[] = [];

  for (let i = 0; i < active.length; i++) {
    const k = active[i]!;
    const dur = Math.max(k.dur, 0.001);
    const hold = k.hold ?? 2.0;
    const outEnd = k.t + dur * 2 + hold;
    outEnds.push(outEnd);

    if (i === 0) {
      startStates.push(IDENTITY);
    } else {
      const prevOutEnd = outEnds[i - 1]!;
      if (k.t < prevOutEnd) {
        // Overlapping with previous zoom zone: transition smoothly from previous state
        const stateAtKStart = evalZoomPoint(active[i - 1]!, startStates[i - 1]!, k.t);
        startStates.push(stateAtKStart);
      } else {
        startStates.push(IDENTITY);
      }
    }
  }

  // Find the active zoom point governing time t
  // If multiple points overlap, the latest point that has already begun (k.t <= t) takes precedence
  let chosenIdx = -1;
  for (let i = active.length - 1; i >= 0; i--) {
    const k = active[i]!;
    if (t >= k.t && t < outEnds[i]!) {
      chosenIdx = i;
      break;
    }
  }

  if (chosenIdx === -1) {
    return IDENTITY;
  }

  const chosen = active[chosenIdx]!;
  const startState = startStates[chosenIdx]!;
  return evalZoomPoint(chosen, startState, t);
}

// Alias for spec naming — same deterministic function
export const getCameraStateAtTime = getCameraTransform;

/**
 * Resolves camera zoom & pan transforms globally across the entire project timeline.
 * Converts segment-relative source keyframes into on-timeline time so that zooms spanning
 * or overlapping across multiple clip cuts continue smoothly across clip boundaries.
 */
export function getProjectCameraTransform(project: Project, timelineT: number): Transform {
  let segStart = 0;
  const allTimelinePoints: ZoomPoint[] = [];

  for (const seg of project.segments) {
    const d = segmentDuration(seg);
    for (const zp of seg.zoomPoints) {
      if (zp.staged) continue;
      const speed = Math.max(0.1, seg.speed);
      const durTimeline = Math.max(zp.dur, 0.001) / speed;
      const holdTimeline = (zp.hold ?? 2.0) / speed;
      const tTimeline = segStart + (zp.t - seg.srcStart) / speed;
      allTimelinePoints.push({
        ...zp,
        t: tTimeline,
        dur: durTimeline,
        hold: holdTimeline,
      });
    }
    segStart += d;
  }

  if (allTimelinePoints.length === 0) return IDENTITY;
  return getCameraTransform(allTimelinePoints, timelineT);
}

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

export type RenderOptions = {
  isPlaying?: boolean;
  cameraOverride?: Transform;
};

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
  options?: RenderOptions,
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
  const paddingPx = (seg.stagePadding ?? 0) * (h / 1080) * 1.5;
  const rect = frameRect(w, h, media, seg.aspectPreset, paddingPx);
  if (currentFrame) {
    const camTransform =
      options?.cameraOverride ??
      (options?.isPlaying === false
        ? IDENTITY
        : getProjectCameraTransform(project, timelineT));
    const view = cameraViewport(rect, camTransform);
    ctx.save();
    // Clip with rounded corners when padded, or standard rect
    ctx.beginPath();
    const cornerRadius = seg.stagePadding > 0 ? Math.min(24, Math.max(8, rect.w * 0.015)) : 0;
    if (cornerRadius > 0 && typeof ctx.roundRect === "function") {
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, cornerRadius);
    } else {
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
    }
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

  // ── Layer 3: Facecam PiP (screen space, smoothly animated across segment transitions) ──
  const resolvedFc = resolveInterpolatedFacecam(project, timelineT, seg);
  drawFacecam(ctx, seg.facecam, srcT, w, h, resolvedFc);

  // ── Layer 4: Text overlays ──
  drawTextOverlays(ctx, seg, srcT, w, h);

  // ── Layer 5: Captions ──
  drawCaptions(ctx, seg, srcT, w, h);
}

export function resolveInterpolatedFacecam(
  project: Project,
  timelineT: number,
  seg: Segment,
): {
  x: number;
  y: number;
  size: number;
  shape: "circle" | "square";
  shapeProgress: number;
  opacity: number;
} {
  const current = seg.facecam;
  const shape = current.shape === "circle" ? "circle" : "square";
  const defaultProgress = shape === "circle" ? 1 : 0;
  if (!current.src) {
    return { x: current.x, y: current.y, size: 0, shape, shapeProgress: defaultProgress, opacity: 0 };
  }

  const segIdx = project.segments.findIndex((s) => s.id === seg.id);
  if (segIdx <= 0) {
    return { x: current.x, y: current.y, size: current.size, shape, shapeProgress: defaultProgress, opacity: 1 };
  }

  const prevSeg = project.segments[segIdx - 1]!;
  let segStartT = 0;
  for (let i = 0; i < segIdx; i++) {
    segStartT += segmentDuration(project.segments[i]!);
  }

  const transitionType = current.transition ?? "smooth";
  const dur = Math.max(0.05, current.transitionDuration ?? 0.45);
  const timeInSeg = timelineT - segStartT;

  if (transitionType === "cut" || timeInSeg >= dur || timeInSeg < 0) {
    return { x: current.x, y: current.y, size: current.size, shape, shapeProgress: defaultProgress, opacity: 1 };
  }

  const tFrac = Math.max(0, Math.min(1, timeInSeg / dur));

  if (!prevSeg.facecam.src) {
    // Facecam entering: scale up from 0 and fade in
    const eased = easeOutCubic(tFrac);
    return {
      x: current.x,
      y: current.y,
      size: current.size * eased,
      shape,
      shapeProgress: defaultProgress,
      opacity: eased,
    };
  }

  // Smooth ease between previous segment facecam and current segment facecam
  let eased = easeInOutCubic(tFrac);
  if (transitionType === "spring") {
    // Punchy spring overshoot
    eased = 1 + Math.sin(tFrac * Math.PI * 1.5) * Math.pow(1 - tFrac, 2) * 0.35;
  } else if (transitionType === "slide") {
    eased = easeOutCubic(tFrac);
  }

  const prev = prevSeg.facecam;
  const prevProgress = (prev.shape ?? "square") === "circle" ? 1 : 0;
  const currProgress = (current.shape ?? "square") === "circle" ? 1 : 0;
  const shapeProgress = Math.max(0, Math.min(1, prevProgress + (currProgress - prevProgress) * eased));

  const x = prev.x + (current.x - prev.x) * eased;
  const y = prev.y + (current.y - prev.y) * eased;
  const size = prev.size + (current.size - prev.size) * eased;

  return {
    x,
    y,
    size: Math.max(0.01, size),
    shape,
    shapeProgress,
    opacity: transitionType === "fade" ? 0.3 + 0.7 * eased : 1,
  };
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
      const scale = Math.max(w / Math.max(texW, 1), h / Math.max(texH, 1));
      const dw = texW * scale;
      const dh = texH * scale;
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
  resolved?: {
    x: number;
    y: number;
    size: number;
    shape: "circle" | "square";
    shapeProgress?: number;
    opacity: number;
  },
): void {
  if (!fc.src) return;
  const effectiveSize = resolved ? resolved.size : fc.size;
  const effectiveX = resolved ? resolved.x : fc.x;
  const effectiveY = resolved ? resolved.y : fc.y;
  const opacity = resolved ? resolved.opacity : 1;

  if (effectiveSize <= 0.001 || opacity <= 0.01) return;

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

  const pipW = Math.round(canvasW * effectiveSize);
  const pipH = Math.round(pipW / aspect);
  const x = Math.round(canvasW * effectiveX);
  const y = Math.round(canvasH * effectiveY);
  // Clamp inside canvas
  const clampedX = clamp(x, 0, Math.max(0, canvasW - pipW));
  const clampedY = clamp(y, 0, Math.max(0, canvasH - pipH));

  const shapeProgress = resolved?.shapeProgress ?? (fc.shape === "circle" ? 1 : 0);
  const minDim = Math.min(pipW, pipH);
  const curW = pipW + (minDim - pipW) * shapeProgress;
  const curH = pipH + (minDim - pipH) * shapeProgress;
  const rSquare = 12;
  const rCircle = minDim / 2;
  const curR = Math.min(Math.min(curW, curH) / 2, rSquare + (rCircle - rSquare) * shapeProgress);

  const cX = clampedX + pipW / 2;
  const cY = clampedY + pipH / 2;
  const bX = cX - curW / 2;
  const bY = cY - curH / 2;

  const buildPath = () => {
    ctx.beginPath();
    if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
      (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(
        bX,
        bY,
        curW,
        curH,
        curR,
      );
    } else {
      const r = Math.min(curR, curW / 2, curH / 2);
      ctx.moveTo(bX + r, bY);
      ctx.arcTo(bX + curW, bY, bX + curW, bY + curH, r);
      ctx.arcTo(bX + curW, bY + curH, bX, bY + curH, r);
      ctx.arcTo(bX, bY + curH, bX, bY, r);
      ctx.arcTo(bX, bY, bX + curW, bY, r);
      ctx.closePath();
    }
  };

  ctx.save();
  ctx.globalAlpha = opacity;
  // Smoothly morphed rounded rect / circle clip
  buildPath();
  ctx.clip();
  try {
    ctx.drawImage(source, clampedX, clampedY, pipW, pipH);
  } catch { /* video frame not ready */ }
  ctx.restore();

  // Subtle border — matches smoothly morphed clip shape
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  buildPath();
  ctx.stroke();
  ctx.restore();
}
